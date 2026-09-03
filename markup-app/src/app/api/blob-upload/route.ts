import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { isDenied, requireTeam } from "@/lib/teamAuth";

/**
 * Hands the browser a short-lived token so it can upload a page straight to
 * Blob storage.
 *
 * A five-page ARCH D set is several megabytes of PNG, and Vercel caps a
 * serverless request body at 4.5 MB -- so the bytes cannot come through a
 * route. They go to Blob directly and the create call carries only URLs, which
 * is what /api/projects' JSON path already expects.
 *
 * The team is established before a token is issued: this is the one place that
 * grants write access to storage, and an open one would let anyone fill the
 * store. Nothing about the token identifies a project, because none exists yet
 * -- the page is uploaded first and the project created from the URLs after.
 */
export async function POST(request: Request) {
  const who = await requireTeam(request);
  if (isDenied(who)) return who;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/png"],
        // Every page is written under its own name, so two uploads of the same
        // plan cannot land on top of each other.
        addRandomSuffix: true,
        // Enough for a large set on a slow connection, and short enough that a
        // leaked token is not a standing invitation.
        validUntil: Date.now() + 60 * 60 * 1000,
        tokenPayload: JSON.stringify({ teamId: who.teamId }),
      }),
      // Required by handleUpload, and there is genuinely nothing to do here:
      // the page is not part of a project until the create call names it, and
      // an upload that is never named is cleaned up as an orphan, not here.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload could not be authorised." },
      { status: 400 }
    );
  }
}
