/**
 * The rule that turns grant rows into what one login may use.
 *
 * Deliberately in its own file with no imports at all. It used to live beside
 * the Prisma query that feeds it, which meant a test could not call it without
 * standing up a database -- so the test carried a hand-copied reimplementation
 * of the rule instead, and passed whether or not the real one still agreed with
 * it. A pure function with no dependencies can simply be called.
 */

/** Always available, to everyone. The shell's own screens are not tools you can
 *  be refused: with no Home and no Settings there is no way back in. */
export const ALWAYS_AVAILABLE = ["home", "settings"] as const;

export type ToolAccess = {
  /** The tools this login may use, the shell's own screens included. */
  tools: string[];
  /** Tools this person is refused although nobody has configured their team.
   *  Only meaningful while `configured` is false -- a configured team says what
   *  it has, so there is nothing left to subtract. It is a list of refusals
   *  rather than an inverted list of what remains because this server has never
   *  known what Waystone ships, and a list it had to keep complete would hide
   *  every tool added after it was written. */
  refused: string[];
  /** False when nobody has said anything about this team yet, and it therefore
   *  gets everything except anything in `refused`. */
  configured: boolean;
};

export type ToolGrantRow = {
  tool: string;
  teamId: string | null;
  memberId: string | null;
  allowed: boolean;
};

/** Home and Settings cannot be refused, however the row got written: with
 *  neither of them there is no screen left to put the refusal right from. */
export function isAlwaysAvailable(tool: string): boolean {
  return (ALWAYS_AVAILABLE as readonly string[]).includes(tool);
}

/** Never given by default. Everything else is open until a team is configured,
 *  because that is what let tool access ship without emptying anybody's rail;
 *  these are the opposite, because a tool that emails people or manages logins
 *  appearing for a whole company on the day it ships is the failure worth
 *  avoiding. Waystone keeps the same list -- see `restricted` in
 *  gui/tools/tool.py. */
export const RESTRICTED = ["admin"] as const;

export function isRestricted(tool: string): boolean {
  return (RESTRICTED as readonly string[]).includes(tool);
}

/** Restricted tools, resolved on their own: explicit grants only, a person's
 *  refusal beating their team's grant, and nothing implied by anything else. */
function restrictedGrants(teamGrants: ToolGrantRow[], memberGrants: ToolGrantRow[]): string[] {
  const allowed = new Set(
    teamGrants.filter((g) => g.allowed && isRestricted(g.tool)).map((g) => g.tool));
  for (const grant of memberGrants) {
    if (!isRestricted(grant.tool)) continue;
    if (grant.allowed) allowed.add(grant.tool);
    else allowed.delete(grant.tool);
  }
  return [...allowed].sort();
}

/**
 * The team's grants first, then the person's on top: an `allowed` row adds a
 * tool their team does not have, and a row with `allowed: false` takes one away
 * that it does. A refusal has to beat the team grant, or the only way to keep
 * one person out of a tool would be to take it from everyone and hand it back
 * one at a time.
 *
 * A team nobody has configured gets everything -- that is what let this ship
 * without emptying every existing rail on the day it arrived, and it means
 * `configured` has to travel with the answer: an empty list from an
 * unconfigured team means "all of them", and an empty list from a configured
 * one means none.
 */
export function resolveToolGrants(grants: ToolGrantRow[]): ToolAccess {
  const teamGrants = grants.filter((g) => g.teamId !== null);
  const memberGrants = grants.filter((g) => g.memberId !== null);
  const restricted = restrictedGrants(teamGrants, memberGrants);

  // A restricted grant must never be what makes a team "configured". Granting
  // a team Warden would otherwise turn it into a team configured with nothing
  // but Warden -- and every other tool would vanish from everyone on it.
  const openTeamGrants = teamGrants.filter((g) => !isRestricted(g.tool));
  const openMemberGrants = memberGrants.filter((g) => !isRestricted(g.tool));

  if (openTeamGrants.length === 0) {
    // Nobody has said what this team should have, so it still gets everything.
    // A refusal aimed at one person has to bite anyway: the alternative is that
    // keeping one person out of one tool means first granting their whole team
    // every tool it already implicitly had, which is the exact workflow the
    // per-person override exists to avoid. A refusal cannot empty anybody
    // else's rail, so it carries none of the risk that makes a lone *grant*
    // leave the team unconfigured.
    const refused = openMemberGrants
      .filter((g) => !g.allowed && !isAlwaysAvailable(g.tool))
      .map((g) => g.tool)
      .sort();
    // `tools` carries only the restricted tools this login was explicitly
    // given: an unconfigured team's open tools are "everything", which the
    // list cannot spell, but a restricted one is never implied.
    return { tools: restricted, refused, configured: false };
  }

  const allowed = new Set(openTeamGrants.filter((g) => g.allowed).map((g) => g.tool));
  for (const grant of openMemberGrants) {
    if (grant.allowed) allowed.add(grant.tool);
    else allowed.delete(grant.tool);
  }
  const tools = [...allowed, ...restricted].sort();
  return { tools: [...ALWAYS_AVAILABLE, ...tools], refused: [], configured: true };
}
