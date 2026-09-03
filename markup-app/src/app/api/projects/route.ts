import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";
import { requireStaff } from "@/lib/staffAuth";

export async function GET(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      documents: {
        include: { pages: { include: { markers: { include: { directions: true } } } } },
      },
    },
  });

  return NextResponse.json(
    projects.map((project) => {
      const allMarkers = project.documents.flatMap((d) => d.pages).flatMap((p) => p.markers);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt.toISOString(),
        lastActivityAt: project.lastActivityAt.toISOString(),
        markerCount: allMarkers.length,
        ieCount: allMarkers.filter((m) => m.type === "IE").length,
        // Two different things have been called "IE". ieCount is the number of
        // markers placed; this is the number of view directions those markers
        // carry, which is what the client's running total multiplies by the
        // price. One marker with three arrows is three elevations to draw and
        // three to bill, so a staff screen showing only ieCount was showing a
        // third of what the client is charged for.
        ieViewCount: allMarkers
          .filter((m) => m.type === "IE")
          .reduce((total, m) => total + Math.max(1, m.directions.length), 0),
      };
    })
  );
}

type PageMeta = { width: number; height: number };
type UploadedPage = { imagePath: string; width: number; height: number };

async function createProjectAndDocument(
  name: string,
  kind: string,
  originalFilename: string,
  allowIE: boolean,
  pricePerIE: number | null,
  allowSection: boolean
) {
  const project = await prisma.project.create({
    data: { name: name.trim(), status: "sent", allowIE, allowSection, pricePerIE },
  });
  const document = await prisma.document.create({
    data: { projectId: project.id, originalFilename, kind },
  });
  return { project, document };
}

/** A create that could not be finished, carrying the status the caller should see. */
class CreateFailed extends Error {
  // Declared rather than a constructor parameter property: the tests run this
  // file's own text through Node's strip-only type stripping, which rejects
  // those outright.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Undo a half-made project.
 *
 * The project row, its document and its share token all exist before the first
 * page does, so every exit from the loops below used to leave a real, listable,
 * shareable project holding only the pages that got through. A three-page
 * remnant of a six-page set is indistinguishable from a genuine three-page
 * project: it lists as Sent with a working Copy Link, and a client sent that
 * link marks up an incomplete set with nothing anywhere saying so.
 *
 * Deletes the record first and the images afterwards -- the same order the two
 * delete routes use, so a cleanup that fails part-way can never leave a project
 * whose pages point at files that are gone. Cascade takes the document, pages
 * and markers with the project.
 *
 * Best-effort throughout: whatever happens in here must not replace the error
 * that caused the rollback, because that error is what the caller needs to see.
 */
async function rollbackProject(projectId: string, blobKeys: string[]) {
  try {
    await prisma.project.delete({ where: { id: projectId } });
  } catch {
    // Nothing better to do -- the caller is already being told the create failed.
  }
  await Promise.allSettled(blobKeys.map((key) => deleteFile(key)));
}

/** The blob key behind a stored page image, stripped the way the delete routes strip it. */
function blobKeyOf(imagePath: string): string {
  return imagePath.replace(/^\/uploads\//, "");
}

/** The other half of the guarantee: what is stored is what was asked for. */
async function assertEveryPageStored(documentId: string, expected: number) {
  const stored = await prisma.page.count({ where: { documentId } });
  if (stored !== expected) {
    throw new CreateFailed(`Only ${stored} of ${expected} pages could be stored.`, 500);
  }
}

function createFailureResponse(err: unknown) {
  if (err instanceof CreateFailed) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Could not create the project." },
    { status: 500 }
  );
}

// Pages already uploaded directly to Blob storage by the caller — this
// request only carries metadata + URLs, no file bytes, so it skips Vercel's
// serverless request-body size limit entirely.
async function handleJsonBody(request: Request) {
  const body = await request.json();
  const { name, kind, originalFilename, allowIE = true, allowSection = true,
          pricePerIE = null, pages } = body as {
    name?: string;
    kind?: string;
    originalFilename?: string;
    allowIE?: boolean;
    pricePerIE?: number | null;
    allowSection?: boolean;
    pages?: UploadedPage[];
  };

  if (
    typeof name !== "string" ||
    !name.trim() ||
    (kind !== "image" && kind !== "pdf") ||
    typeof originalFilename !== "string" ||
    !Array.isArray(pages) ||
    pages.length === 0
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { project, document } = await createProjectAndDocument(
    name,
    kind,
    originalFilename,
    allowIE,
    pricePerIE,
    allowSection
  );

  try {
    for (let i = 0; i < pages.length; i++) {
      await prisma.page.create({
        data: {
          documentId: document.id,
          pageNumber: i + 1,
          imagePath: pages[i].imagePath,
          width: Math.round(pages[i].width),
          height: Math.round(pages[i].height),
        },
      });
    }
    await assertEveryPageStored(document.id, pages.length);
  } catch (err) {
    // These images were uploaded for this project and nothing else refers to
    // them, so they go with it.
    await rollbackProject(project.id, pages.map((p) => blobKeyOf(p.imagePath)));
    return createFailureResponse(err);
  }

  return NextResponse.json({ id: project.id, shareToken: project.shareToken });
}

// Legacy path: raw file bytes proxied through this route and saved server-side
// (local filesystem in dev, Blob in production if no client-upload route is used).
async function handleFormDataBody(request: Request) {
  const formData = await request.formData();

  const name = formData.get("name");
  const kind = formData.get("kind");
  const originalFilename = formData.get("originalFilename");
  const metaRaw = formData.get("meta");
  const allowIE = formData.get("allowIE") !== "false";
  const allowSection = formData.get("allowSection") !== "false";
  // Absent, blank or unparseable all mean "this project shows no pricing".
  // Zero is a real answer and is kept, which is why this is not `|| null`.
  const priceRaw = formData.get("pricePerIE");
  const priceNum = typeof priceRaw === "string" && priceRaw.trim() !== "" ? Number(priceRaw) : NaN;
  const pricePerIE = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : null;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    (kind !== "image" && kind !== "pdf") ||
    typeof originalFilename !== "string" ||
    typeof metaRaw !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const meta: PageMeta[] = JSON.parse(metaRaw);
  if (!Array.isArray(meta) || meta.length === 0) {
    return NextResponse.json({ error: "No pages provided" }, { status: 400 });
  }

  const { project, document } = await createProjectAndDocument(
    name,
    kind,
    originalFilename,
    allowIE,
    pricePerIE,
    allowSection
  );

  // Only keys that actually reached storage, so a failed saveFile does not send
  // the rollback chasing a file that was never written.
  const uploaded: string[] = [];
  try {
    for (let i = 0; i < meta.length; i++) {
      const file = formData.get(`file-${i}`);
      if (!(file instanceof File)) {
        throw new CreateFailed(`Missing file for page ${i}`, 400);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = `${document.id}-${i}.png`;
      const imagePath = await saveFile(key, buffer);
      uploaded.push(key);

      await prisma.page.create({
        data: {
          documentId: document.id,
          pageNumber: i + 1,
          imagePath,
          width: Math.round(meta[i].width),
          height: Math.round(meta[i].height),
        },
      });
    }
    await assertEveryPageStored(document.id, meta.length);
  } catch (err) {
    await rollbackProject(project.id, uploaded);
    return createFailureResponse(err);
  }

  return NextResponse.json({ id: project.id, shareToken: project.shareToken });
}

export async function POST(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return handleJsonBody(request);
  }
  return handleFormDataBody(request);
}
