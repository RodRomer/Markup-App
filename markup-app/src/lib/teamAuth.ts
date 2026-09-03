import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PASSWORD_MIN_LENGTH, hashPassword, newSessionToken, sessionExpiry, verifyPassword }
  from "./password";

// Re-exported so routes keep importing auth from one place.
export { PASSWORD_MIN_LENGTH, hashPassword, newSessionToken, sessionExpiry, verifyPassword };

/**
 * Team sign-in for the staff surfaces.
 *
 * One password per team, shared and kept in a password manager. Clients never
 * touch this: their share link remains the only thing they need, and the
 * /api/markup/[token]/* routes stay unauthenticated on purpose.
 *
 * MARKUP_STAFF_KEY has not gone away -- it is now the admin key, and the only
 * thing it can do is create and list teams. That keeps a bootstrap path that
 * does not depend on already having a team, without leaving one secret that
 * opens every team's work.
 */

const HEADER = "x-team-token";

export type TeamIdentity = { teamId: string; teamName: string };

/**
 * The team behind this request, or the response to send instead.
 *
 * Returns 401 for absent, unknown and expired alike: which of the three it was
 * is not the caller's business, and saying so would let someone sort real
 * tokens from invented ones.
 */
export async function requireTeam(request: Request): Promise<TeamIdentity | NextResponse> {
  const token = request.headers.get(HEADER);
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { team: { select: { id: true, name: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (session.expiresAt <= new Date()) {
    // Cleared on the way past rather than by a sweep: the row is in hand, and
    // an expired session that lingers is one an attacker could still present if
    // the clock or the check ever moved.
    await prisma.session.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ error: "Your sign-in has expired" }, { status: 401 });
  }

  return { teamId: session.team.id, teamName: session.team.name };
}

/** Narrowing helper, so routes read as `if (isDenied(who)) return who;`. */
export function isDenied(result: TeamIdentity | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
