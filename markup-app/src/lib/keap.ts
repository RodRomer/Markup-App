/**
 * Reading a project's stage out of Keap, from the server.
 *
 * Read-only by construction, not by intention. This module exposes one function
 * and it issues a GET; there is no update, no create, no delete, and nothing
 * here takes a method. The key this uses can change data in Keap, so the
 * guarantee that it will not needs to be a property of the code rather than a
 * promise about how it is called -- and a test asserts no other verb appears in
 * this file.
 */

const BASE_URL = "https://api.infusionsoft.com/crm/rest/v1";

/** How long to wait on Keap before giving up and showing nothing. Short: this
 *  is an extra column, and the project list has already loaded without it. */
const TIMEOUT_MS = 8000;

export type KeapOpportunity = {
  opportunity_title?: string | null;
  stage?: { name?: string | null } | null;
};

export class KeapUnavailable extends Error {}

/**
 * Opportunities matching a search term.
 *
 * Keap's own search, rather than a listing. The listing endpoint returns a
 * single page and this account holds more opportunities than fit in one, so
 * scanning it missed most projects while looking exactly like a project Keap
 * had never heard of. Waystone learned that the hard way; this starts where it
 * finished.
 */
export async function searchOpportunities(term: string): Promise<KeapOpportunity[]> {
  const key = process.env.KEAP_API_KEY;
  if (!key) throw new KeapUnavailable("No Keap key is configured on the server.");

  const url = new URL(`${BASE_URL}/opportunities`);
  url.searchParams.set("search_term", term);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // Stages change in Keap, not here, and a cached "Delivered" on a project
    // that has been reopened would be worse than no column at all.
    cache: "no-store",
  }).catch((cause) => {
    throw new KeapUnavailable(`Could not reach Keap: ${(cause as Error).message}`);
  });

  if (!response.ok) {
    throw new KeapUnavailable(`Keap answered ${response.status}.`);
  }

  const body = (await response.json()) as { opportunities?: KeapOpportunity[] };
  return body.opportunities ?? [];
}
