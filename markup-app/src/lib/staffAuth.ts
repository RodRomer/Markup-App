import { NextResponse } from "next/server";

/**
 * Guards the /api/projects/* routes, which are the staff surface: they can list
 * every project (including its share token), delete projects, and delete pages.
 * The client-facing /api/markup/[token]/* routes are deliberately NOT guarded --
 * there the unguessable share token in the URL is itself the credential.
 *
 * Waystone sends the shared secret as `x-waystone-key`. It is compared in
 * constant time so a wrong key can't be recovered by timing the response.
 *
 * Fails closed: if MARKUP_STAFF_KEY isn't configured the routes refuse rather
 * than silently serving unauthenticated, which is how this surface ended up
 * open in the first place.
 */
const HEADER = "x-waystone-key";

function timingSafeEqual(a: string, b: string): boolean {
  // Compare over a fixed length so the loop count never depends on the input.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Returns a 401/503 response when the caller isn't authorised, or null to continue. */
export function requireStaff(request: Request): NextResponse | null {
  const expected = process.env.MARKUP_STAFF_KEY;
  if (!expected) {
    return NextResponse.json(
      { error: "Server is missing MARKUP_STAFF_KEY; staff API is disabled." },
      { status: 503 }
    );
  }
  const provided = request.headers.get(HEADER);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  return null;
}
