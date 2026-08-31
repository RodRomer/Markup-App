import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { requireStaff } from "@/lib/staffAuth";

export async function GET(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { documents: { include: { pages: { include: { markers: true } } } } },
  });

  return NextResponse.json(
    projects.map((project) => {
      const allMarkers = project.documents.flatMap((d) => d.pages).flatMap((p) => p.markers);
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt.toISOString(),
        markerCount: allMarkers.length,
        ieCount: allMarkers.filter((m) => m.type === "IE").length,
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

  for (let i = 0; i < meta.length; i++) {
    const file = formData.get(`file-${i}`);
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: `Missing file for page ${i}` },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `${document.id}-${i}.png`;
    const imagePath = await saveFile(key, buffer);

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
