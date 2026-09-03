// Staff decide whether to look at a project from one number: when it last
// moved. That number is only worth trusting if every route a client can reach
// reports in -- one that forgets leaves a project looking untouched while the
// client works on it, which is the exact opposite of what the badge is for.
//
// Structural on purpose. There is no DOM and no database here; what this
// guards is that the set of client-facing mutations and the set of routes that
// record activity stay the same set.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const CLIENT_API = path.join(REPO, "src/app/api/markup");

/** Every route file under the client-facing (token-addressed) API. */
function clientRoutes(dir = CLIENT_API): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return clientRoutes(full);
    return entry === "route.ts" ? [full] : [];
  });
}

/** The HTTP verbs a file exports. GET changes nothing and is not activity. */
function mutatingVerbs(source: string): string[] {
  return [...source.matchAll(/export async function ([A-Z]+)/g)]
    .map((m) => m[1])
    .filter((verb) => verb !== "GET" && verb !== "HEAD");
}

const recordsActivity = (source: string) =>
  source.includes("touchProject(") || source.includes("lastActivityAt:");

test("every client route that changes something records that it did", () => {
  const routes = clientRoutes();
  assert.ok(routes.length >= 5, `only found ${routes.length} client routes -- did the tree move?`);

  const missing: string[] = [];
  let checked = 0;
  for (const file of routes) {
    const source = readFileSync(file, "utf8");
    if (mutatingVerbs(source).length === 0) continue;
    checked++;
    if (!recordsActivity(source)) missing.push(path.relative(REPO, file));
  }

  // The control: if this ever drops to nothing, the test above is vacuous and
  // would pass no matter how many routes forgot.
  assert.ok(checked >= 5, `only ${checked} mutating client routes were examined`);
  assert.deepEqual(missing, [],
    `these change a client's work without recording it: ${missing.join(", ")}`);
});

test("a read-only route is not expected to record anything", () => {
  // Otherwise the rule above would be satisfied by sprinkling touchProject
  // everywhere, which would make "last activity" mean "last looked at".
  const pdf = readFileSync(path.join(CLIENT_API, "[token]/pdf/route.ts"), "utf8");
  assert.deepEqual(mutatingVerbs(pdf), [], "the PDF route is supposed to be read-only");
  assert.equal(recordsActivity(pdf), false,
    "downloading a PDF is staff looking, not a client working");
});

test("submit and reopen carry it in the write they already do", () => {
  // Both already update the row, so a second query would be waste. If either
  // ever stops setting it inline, the rule above still catches it -- this says
  // which shape was chosen and why.
  for (const name of ["submit", "reopen"]) {
    const source = readFileSync(path.join(CLIENT_API, `[token]/${name}/route.ts`), "utf8");
    assert.match(source, /lastActivityAt: new Date\(\)/,
      `${name} should set the timestamp in its existing update`);
    assert.equal(source.includes("touchProject("), false,
      `${name} does not need a second write`);
  }
});
