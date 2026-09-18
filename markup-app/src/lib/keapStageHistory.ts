/**
 * When a project moved into a stage -- the one thing the overage check needs
 * that Keap's REST API does not have.
 *
 * REST has no "moved into this stage on" date, and `last_updated` is bumped by
 * bulk edits, so the prototype read the StageMove table through Keap's legacy
 * XML-RPC API, which accepts the same key. That is a POST, and keap.ts promises
 * it never makes one; so it lives here instead, apart, and read-only by
 * construction in its own way:
 *
 * - The method, the table and the fields are constants, not parameters. Nothing
 *   can call this to reach any other part of Keap, and a test holds this file
 *   to that.
 * - The query is a fixed document with exactly two holes: the key, escaped, and
 *   an opportunity id, which must be a whole number.
 *
 * If Keap ever retires XML-RPC, every project reads as having no stage history.
 * The check then raises no missing-SF alerts and says "no stage history" on every
 * row in Warden -- loudly visible, never silently wrong.
 */
import { KeapUnavailable, retryWaitMs } from "./keap.ts";

const XMLRPC_URL = "https://api.infusionsoft.com/crm/xmlrpc/v1";
const METHOD = "DataService.query";
const TABLE = "StageMove";

const TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

/** Keap allows 10 calls a second and 240 a minute; a CAD Live run is about
 *  fifty. Three at once, never started closer than this apart, is at most
 *  eight a second with room for the listing calls around it. */
const CONCURRENCY = 3;
const SPACING_MS = 125;

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** The whole request. Exported for the test that holds it to its shape. */
export function stageMoveQuery(key: string, opportunityId: number): string {
  if (!Number.isSafeInteger(opportunityId) || opportunityId <= 0) {
    throw new Error(`Not an opportunity id: ${opportunityId}`);
  }
  return (
    `<?xml version="1.0"?>` +
    `<methodCall><methodName>${METHOD}</methodName><params>` +
    `<param><value><string>${escapeXml(key)}</string></value></param>` +
    `<param><value><string>${TABLE}</string></value></param>` +
    `<param><value><int>1000</int></value></param>` +
    `<param><value><int>0</int></value></param>` +
    `<param><value><struct><member><name>OpportunityId</name>` +
    `<value><int>${opportunityId}</int></value></member></struct></value></param>` +
    `<param><value><array><data>` +
    `<value><string>MoveDate</string></value>` +
    `<value><string>MoveToStage</string></value>` +
    `</data></array></value></param>` +
    `</params></methodCall>`
  );
}

export type StageMove = { day: string; toStage: number };

/** The inside of a <value>, whatever type tag wraps it (or none). */
function scalar(inner: string): string {
  return inner.replace(/<[^>]+>/g, "").trim();
}

/**
 * The moves out of an XML-RPC response.
 *
 * A small reader for the one shape Keap sends back -- an array of structs --
 * rather than a general XML-RPC parser. A fault is Keap saying no, and is
 * raised as such rather than read as "no moves", which would silently turn a
 * rejected key into every project lacking stage history.
 */
export function parseStageMoves(xml: string): StageMove[] {
  if (/<fault>/.test(xml)) {
    const message = /<name>faultString<\/name>\s*<value>([\s\S]*?)<\/value>/.exec(xml);
    throw new KeapUnavailable(`Keap refused the stage history query: ${message ? scalar(message[1]) : "fault"}`);
  }
  const moves: StageMove[] = [];
  for (const [, struct] of xml.matchAll(/<struct>([\s\S]*?)<\/struct>/g)) {
    const fields = new Map<string, string>();
    for (const [, name, value] of struct.matchAll(
      /<member>\s*<name>([^<]*)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g)) {
      fields.set(name.trim(), scalar(value));
    }
    // 20260909T13:04:41 -- the day is the first eight characters.
    const date = /^(\d{4})(\d{2})(\d{2})T/.exec(fields.get("MoveDate") ?? "");
    const toStage = Number(fields.get("MoveToStage"));
    if (!date || !Number.isInteger(toStage)) continue;
    moves.push({ day: `${date[1]}-${date[2]}-${date[3]}`, toStage });
  }
  return moves;
}

/** The last day the project moved into `stageId`, or null if Keap has none. */
export function lastEntered(moves: StageMove[], stageId: number): string | null {
  const days = moves.filter((m) => m.toStage === stageId).map((m) => m.day);
  return days.length ? days.sort()[days.length - 1] : null;
}

async function queryMoves(key: string, opportunityId: number): Promise<StageMove[]> {
  const body = stageMoveQuery(key, opportunityId);
  let fallback = 1000;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(XMLRPC_URL, {
      method: "POST",
      headers: { "X-Keap-API-Key": key, "Content-Type": "text/xml" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    }).catch((cause) => {
      throw new KeapUnavailable(`Could not reach Keap: ${(cause as Error).message}`);
    });
    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, retryWaitMs(response.headers.get("Retry-After"), fallback)));
      fallback *= 2;
      continue;
    }
    if (!response.ok) throw new KeapUnavailable(`Keap answered ${response.status} to the stage history query.`);
    return parseStageMoves(await response.text());
  }
}

/**
 * When each project last entered `stageId`, keyed by opportunity id.
 *
 * All or nothing: one failure fails the lot. A project whose history could not
 * be read would otherwise evaluate as "no stage history", which clears any
 * missing-SF alert it had -- and an unsent alert that clears and comes back is
 * offered again, so a flaky minute at Keap would reshuffle what Warden shows.
 * A run that failed is better recorded as failed.
 */
export async function enteredStageDates(
  opportunityIds: number[],
  stageId: number,
): Promise<Map<number, string | null>> {
  const key = process.env.KEAP_API_KEY;
  if (!key) throw new KeapUnavailable("No Keap key is configured on the server.");

  const result = new Map<number, string | null>();
  const queue = [...opportunityIds];
  let nextStart = 0;

  async function worker() {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const wait = nextStart - Date.now();
      nextStart = Math.max(nextStart, Date.now()) + SPACING_MS;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        result.set(id, lastEntered(await queryMoves(key!, id), stageId));
      } catch (error) {
        // The run is lost; stop the other workers asking Keap for the rest of
        // it rather than spending the rate limit on answers nobody will read.
        queue.length = 0;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return result;
}
