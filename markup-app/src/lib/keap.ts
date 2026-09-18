/**
 * Reading a project's stage out of Keap, from the server.
 *
 * Read-only by construction, not by intention. Every call in this module is a
 * GET; there is no update, no create, no delete, and nothing here takes a
 * method. (The one POST the overage check needs -- an XML-RPC query for stage
 * history -- lives apart in keapStageHistory.ts, under its own guard, so that
 * this file's guarantee stays a one-line check.) The key this uses can change data in Keap, so the
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
export async function searchOpportunities(
  term: string,
  { withCustomFields = false } = {}
): Promise<KeapOpportunity[]> {
  const key = process.env.KEAP_API_KEY;
  if (!key) throw new KeapUnavailable("No Keap key is configured on the server.");

  const url = new URL(`${BASE_URL}/opportunities`);
  url.searchParams.set("search_term", term);
  // Oracle needs the custom fields, and Keap will put them in the search result
  // rather than making us fetch the record separately -- one slow call instead
  // of two. The stage column does not need them and does not ask: it searches
  // once per project, and the extra payload would be paid every time.
  if (withCustomFields) url.searchParams.set("optional_properties", "custom_fields");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(withCustomFields ? LOOKUP_TIMEOUT_MS : TIMEOUT_MS),
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

/** A page of the listing. Keap's own limit is 1000, but a page of CAD Live
 *  with every custom field is large, and 200 is what the prototype used. */
const PAGE_SIZE = 200;

/** Keap allows 10 calls a second. A 429 says to slow down, and Retry-After
 *  says how much -- clamped, because a function that sleeps for the minute
 *  Keap sometimes asks for would be killed by Vercel before it woke. */
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 10_000;

export type KeapStageOpportunity = {
  id: number;
  opportunity_title?: string | null;
  stage?: { id?: number | null; name?: string | null } | null;
  custom_fields?: { id: number; content?: unknown }[];
};

/** Retry-After is seconds or an HTTP date. Anything unreadable gets the
 *  fallback; anything huge gets the clamp. */
export function retryWaitMs(header: string | null, fallbackMs: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_WAIT_MS);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), MAX_RETRY_WAIT_MS);
  }
  return Math.min(fallbackMs, MAX_RETRY_WAIT_MS);
}

/**
 * Every opportunity in one stage, custom fields and all -- for the overage
 * check, which has to see all of CAD Live rather than one project somebody
 * searched for.
 *
 * Paged, which is what searchOpportunities notes the plain listing was not:
 * this account holds more opportunities than fit in one page. It stops when a
 * page comes back empty or Keap's own `count` is reached, whichever is first.
 *
 * The stage filter is trusted, but not blindly -- a project in the wrong stage
 * would draw an alert it should not, so each result is checked again here, as
 * the prototype did.
 */
export async function listOpportunitiesInStage(stageId: number): Promise<KeapStageOpportunity[]> {
  const key = process.env.KEAP_API_KEY;
  if (!key) throw new KeapUnavailable("No Keap key is configured on the server.");

  const found: KeapStageOpportunity[] = [];
  for (;;) {
    const url = new URL(`${BASE_URL}/opportunities`);
    url.searchParams.set("stage_id", String(stageId));
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(found.length));
    url.searchParams.set("optional_properties", "custom_fields");

    const page = await getWithRetry(url, key);
    const batch = page.opportunities ?? [];
    found.push(...batch);
    if (batch.length === 0 || found.length >= (page.count ?? 0)) break;
  }
  return found.filter((o) => o.stage?.id === stageId);
}

async function getWithRetry(
  url: URL,
  key: string,
): Promise<{ opportunities?: KeapStageOpportunity[]; count?: number }> {
  let fallback = 1000;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      cache: "no-store",
    }).catch((cause) => {
      throw new KeapUnavailable(`Could not reach Keap: ${(cause as Error).message}`);
    });
    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, retryWaitMs(response.headers.get("Retry-After"), fallback)));
      fallback *= 2;
      continue;
    }
    if (!response.ok) throw new KeapUnavailable(`Keap answered ${response.status}.`);
    return (await response.json()) as { opportunities?: KeapStageOpportunity[]; count?: number };
  }
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
