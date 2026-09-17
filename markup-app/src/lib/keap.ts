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

/** For a lookup somebody asked for and is waiting on. Keap's own search takes
 *  about a second from anywhere, so this has room for a slow one rather than
 *  failing a lookup that was going to arrive. */
const LOOKUP_TIMEOUT_MS = 20000;

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

/**
 * One opportunity in full, custom fields and all.
 *
 * What Oracle used to fetch with a Keap key of its own, on every machine that
 * had one. Fetching it here instead means the key stays on the server: no
 * laptop holds a token that can read -- or write -- the CRM, and taking away
 * somebody's login takes away their Keap access in the same moment. With the
 * key on their machine it would carry on working until the key itself was
 * rotated.
 *
 * Longer than the stage lookup's timeout, deliberately. That one decorates a
 * list that has already loaded and is better skipped than waited for; this one
 * is the answer somebody clicked for and is watching an empty form for.
 */
export async function getOpportunity(id: number): Promise<Record<string, unknown> | null> {
  const key = process.env.KEAP_API_KEY;
  if (!key) throw new KeapUnavailable("No Keap key is configured on the server.");

  const url = new URL(`${BASE_URL}/opportunities/${encodeURIComponent(String(id))}`);
  url.searchParams.set("optional_properties", "custom_fields");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    cache: "no-store",
  }).catch((cause) => {
    throw new KeapUnavailable(`Could not reach Keap: ${(cause as Error).message}`);
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new KeapUnavailable(`Keap answered ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Where a person can read this opportunity, or null if we cannot know.
 *
 * Classic Keap serves records from the account's own subdomain, which is not
 * derivable from the REST host -- api.infusionsoft.com is shared by every
 * account. The server knows the subdomain, so it hands back the link rather
 * than making every machine keep its own copy of the account name.
 */
export function opportunityUrl(id: number): string | null {
  const account = (process.env.KEAP_ACCOUNT ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(".")[0];
  if (!account) return null;
  return `https://${account}.infusionsoft.com/Opportunity/manageOpportunity.jsp?view=edit&ID=${id}`;
}
