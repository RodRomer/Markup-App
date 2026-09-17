import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { TeamIdentity } from "@/lib/teamAuth";

/**
 * Which Waystone tools a login may use.
 *
 * Waystone is the shell; Vault, Oracle, Mirror and Rune are the tools inside it.
 * Some belong to one team's work and some will belong to one person, so what
 * appears in somebody's rail is decided here rather than on their machine.
 *
 * One rule, in one place, because it is read twice: once to tell Waystone what
 * to show, and once on the routes that actually do the work. Those two
 * disagreeing is the whole failure worth avoiding -- a rail that offers a tool
 * the server then refuses, or worse, hides one it would happily serve.
 */

/** Always available, to everyone. The shell's own screens are not tools you can
 *  be refused: with no Home and no Settings there is no way back in. */
export const ALWAYS_AVAILABLE = ["home", "settings"] as const;

export type ToolAccess = {
  /** The tools this login may use, the shell's own screens included. */
  tools: string[];
  /** False when nobody has said anything about this team yet, and it therefore
   *  gets everything. Waystone shows every tool it ships in that case. */
  configured: boolean;
};

/**
 * Resolve the grants for one signed-in login.
 *
 * The team's grants first, then the person's on top: an `allowed` row adds a
 * tool their team does not have, and a row with `allowed: false` takes one away
 * that it does. A refusal has to beat the team grant, or the only way to keep
 * one person out of a tool would be to take it from everyone and hand it back
 * one at a time.
 *
 * A team nobody has configured gets everything -- see the note on the model.
 * That is what let this ship without emptying every existing rail on the day it
 * arrived, and it means "configured" has to travel with the answer: an empty
 * list from an unconfigured team means "all of them", and an empty list from a
 * configured one means none.
 */
export async function toolsFor(who: TeamIdentity): Promise<ToolAccess> {
  const grants = await prisma.toolGrant.findMany({
    where: {
      OR: [
        { teamId: who.teamId },
        ...(who.memberId ? [{ memberId: who.memberId }] : []),
      ],
    },
    select: { tool: true, teamId: true, memberId: true, allowed: true },
  });

  const teamGrants = grants.filter((g) => g.teamId !== null);
  if (teamGrants.length === 0) {
    return { tools: [], configured: false };
  }

  const allowed = new Set(teamGrants.filter((g) => g.allowed).map((g) => g.tool));
  for (const grant of grants.filter((g) => g.memberId !== null)) {
    if (grant.allowed) allowed.add(grant.tool);
    else allowed.delete(grant.tool);
  }
  return { tools: [...ALWAYS_AVAILABLE, ...[...allowed].sort()], configured: true };
}

/**
 * Whether this login may use one tool, for the routes that do its work.
 *
 * Hiding an icon is a convenience, not a permission: anyone who can sign in can
 * call the API directly, so a tool that talks to this server has to be refused
 * here as well. Tools that only touch the machine they run on -- Mirror, and
 * Vault against the Egnyte drive -- have nothing to check here, and hiding them
 * restricts nobody who is determined.
 */
export async function mayUse(who: TeamIdentity, tool: string): Promise<boolean> {
  const access = await toolsFor(who);
  return !access.configured || access.tools.includes(tool);
}

/**
 * The response to send instead, when this login may not use this tool.
 *
 * Shaped like requireTeam so routes read the same way: get the team, then get
 * the tool, then do the work. 403 rather than 404 -- they are signed in and the
 * thing exists; they are simply not to use it. Pretending it is not there would
 * send somebody hunting for a bug.
 */
export async function requireTool(who: TeamIdentity, tool: string): Promise<NextResponse | null> {
  if (await mayUse(who, tool)) return null;
  return NextResponse.json(
    { error: `Your login does not have ${tool === "markup" ? "Rune" : tool}.` },
    { status: 403 }
  );
}
