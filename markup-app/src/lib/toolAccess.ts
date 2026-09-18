import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { TeamIdentity } from "@/lib/teamAuth";
import { isRestricted, resolveToolGrants } from "@/lib/resolveToolGrants";
import type { ToolAccess } from "@/lib/resolveToolGrants";

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

export { ALWAYS_AVAILABLE, RESTRICTED, resolveToolGrants } from "@/lib/resolveToolGrants";
export type { ToolAccess, ToolGrantRow } from "@/lib/resolveToolGrants";

/**
 * Resolve the grants for one signed-in login.
 *
 * The query only; the rule itself is resolveToolGrants, which lives on its own
 * with no imports so it can be called by a test without a database behind it.
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
  return resolveToolGrants(grants);
}

/** Waystone's names for the tools, for messages a person reads. */
const TOOL_NAMES: Record<string, string> = {
  cache: "Vault", lookup: "Oracle", snip: "Mirror", markup: "Rune", admin: "Warden",
};

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
  // Checked first: whether the team is configured says nothing about a
  // restricted tool, which is only ever had by being given.
  if (isRestricted(tool)) return access.tools.includes(tool);
  if (!access.configured) return !access.refused.includes(tool);
  return access.tools.includes(tool);
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
    { error: `Your login does not have ${TOOL_NAMES[tool] ?? tool}.` },
    { status: 403 }
  );
}
