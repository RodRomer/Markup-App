/**
 * Which Keap opportunity a project refers to, and whether Keap calls it done.
 *
 * The mirror of Waystone's keap_sync/delivery.py. The two cannot import from
 * each other -- one is Python in another repository -- so the rules are stated
 * twice and pinned by a test on each side. They have to agree: a project that
 * reads "Delivered" in Waystone and blank on the staff page is worse than
 * neither showing it, because it makes both untrustworthy.
 */

/** Keap's own words, and only this one. "Project Complete" sits before it in
 *  the pipeline and looks like it belongs; of 200 opportunities read from the
 *  live account, 116 were Delivered and not one was Complete. */
export const DELIVERED_STAGE = "Project Delivered";

const LEADING_NUMBER = /^\s*(\d{3,6})(?!\d)/;

/** The project number a name leads with, or null.
 *
 *  Anchored at the start: a street address or a suite number inside a name is
 *  not the project's number, and treating it as one matches an unrelated job. */
export function projectNumber(text: string | null | undefined): string | null {
  const match = LEADING_NUMBER.exec(text ?? "");
  return match ? match[1] : null;
}

export type ProjectLike = { name?: string | null; projectNumber?: string | null };

/** The number to look this project up by: the one it was given, or one read off
 *  its name for the projects that predate the field. */
export function numberFor(project: ProjectLike): string | null {
  const explicit = (project.projectNumber ?? "").trim();
  return explicit ? projectNumber(explicit) : projectNumber(project.name ?? "");
}

export function stageName(opportunity: KeapLike | null | undefined): string | null {
  return opportunity?.stage?.name ?? null;
}

export function isDelivered(opportunity: KeapLike | null | undefined): boolean {
  return stageName(opportunity) === DELIVERED_STAGE;
}

type KeapLike = { opportunity_title?: string | null; stage?: { name?: string | null } | null };

/**
 * The one opportunity this project refers to, or null.
 *
 * Two ways to match, in order: the whole title where one was given, because
 * 8704_BA and 8704_LA are different jobs sharing a number; then the leading
 * number, and only when exactly one candidate carries it -- 986 opportunities
 * on this account share the number 1490.
 *
 * Null where nothing was given, nothing matched, or more than one did. All
 * three should show the same thing, which is nothing.
 */
export async function findOpportunity(
  project: ProjectLike,
  search: (term: string) => Promise<KeapLike[]>
): Promise<KeapLike | null> {
  const given = (project.projectNumber ?? "").trim();
  const number = given ? projectNumber(given) : projectNumber(project.name ?? "");
  if (!given && !number) return null;

  const results = (await search(given || number!)) ?? [];

  if (given) {
    const wanted = given.toLowerCase();
    const exact = results.filter(
      (o) => (o.opportunity_title ?? "").trim().toLowerCase() === wanted
    );
    if (exact.length === 1) return exact[0];
  }

  if (!number) return null;
  const same = results.filter((o) => projectNumber(o.opportunity_title) === number);
  return same.length === 1 ? same[0] : null;
}
