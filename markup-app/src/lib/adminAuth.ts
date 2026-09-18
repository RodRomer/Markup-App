import { NextResponse } from "next/server";
import { isDenied, requireTeam, type TeamIdentity } from "@/lib/teamAuth";
import { requireTool } from "@/lib/toolAccess";

/**
 * Who is using Warden, or the response to send instead.
 *
 * Signed in, holding the restricted `admin` tool, and signed in *as a person*.
 * The shared team password is refused even if the team was granted Warden:
 * Warden sends email on the company's behalf, and "sent by the PPM team" is not
 * an answer to "who sent this". Every claim records the person who made it.
 */
export type AdminIdentity = TeamIdentity & { memberId: string; memberName: string };

export async function requireAdmin(request: Request): Promise<AdminIdentity | NextResponse> {
  const who = await requireTeam(request);
  if (isDenied(who)) return who;
  if (!who.memberId || !who.memberName) {
    return NextResponse.json(
      { error: "Warden needs your own login, not the team's. Sign in as yourself in Settings." },
      { status: 403 });
  }
  const refused = await requireTool(who, "admin");
  if (refused) return refused;
  return who as AdminIdentity;
}

export function isAdminDenied(result: AdminIdentity | NextResponse): result is NextResponse {
  return result instanceof NextResponse;
}
