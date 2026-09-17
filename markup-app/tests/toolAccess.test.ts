// Waystone is the shell and its tools are what sits inside it, so what appears
// in somebody's rail is decided here rather than on their machine. A team grants
// the tools its work needs; a person can be given one their team lacks, or
// refused one it has.
//
// The rule worth guarding hardest is the default: a team nobody has configured
// gets everything. Get that wrong and shipping this empties every existing rail
// on the day it arrives.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const ACCESS = read("src/lib/toolAccess.ts");
const ROUTE = read("src/app/api/tools/route.ts");
const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read("prisma/migrations/20260918000000_add_tool_grants/migration.sql");

/** The resolution rule, lifted out of the module and run against fake rows.
 *  Imported by reading rather than by `import`: toolAccess pulls in Prisma. */
function resolve(
  grants: { tool: string; teamId: string | null; memberId: string | null; allowed: boolean }[]
) {
  const teamGrants = grants.filter((g) => g.teamId !== null);
  if (teamGrants.length === 0) return { tools: [], configured: false };
  const allowed = new Set(teamGrants.filter((g) => g.allowed).map((g) => g.tool));
  for (const grant of grants.filter((g) => g.memberId !== null)) {
    if (grant.allowed) allowed.add(grant.tool);
    else allowed.delete(grant.tool);
  }
  return { tools: ["home", "settings", ...[...allowed].sort()], configured: true };
}

const team = (tool: string, allowed = true) => ({ tool, teamId: "t1", memberId: null, allowed });
const person = (tool: string, allowed = true) => ({ tool, teamId: null, memberId: "m1", allowed });

test("the rule here is the one the module implements", () => {
  // The copy above is only worth having if it stays the same rule.
  assert.ok(ACCESS.includes("if (teamGrants.length === 0)"));
  assert.ok(ACCESS.includes('return { tools: [], configured: false };'));
  assert.ok(ACCESS.includes("if (grant.allowed) allowed.add(grant.tool);"));
  assert.ok(ACCESS.includes("else allowed.delete(grant.tool);"));
});

test("a team nobody has configured gets everything", () => {
  const access = resolve([]);
  assert.equal(access.configured, false);
  // Empty *and* unconfigured, which is why both travel together: an empty list
  // from a configured team means none, and these two must never be confused.
  assert.deepEqual(access.tools, []);
});

test("once a team is configured, the list is exactly what was granted", () => {
  const access = resolve([team("cache"), team("markup")]);
  assert.equal(access.configured, true);
  assert.deepEqual(access.tools, ["home", "settings", "cache", "markup"]);
  assert.equal(access.tools.includes("lookup"), false);
});

test("the shell's own screens cannot be taken away", () => {
  // With no Home and no Settings there is no way back in -- not even to fix the
  // sign-in that would put the rest right.
  const access = resolve([team("cache")]);
  assert.ok(access.tools.includes("home") && access.tools.includes("settings"));
  assert.match(ACCESS, /ALWAYS_AVAILABLE = \["home", "settings"\]/);
});

test("a person can be given a tool their team does not have", () => {
  const access = resolve([team("cache"), person("lookup")]);
  assert.deepEqual(access.tools, ["home", "settings", "cache", "lookup"]);
});

test("a person can be refused one their team does have", () => {
  // Without this the only way to keep one person out of a tool would be to take
  // it from the whole team and hand it back one at a time.
  const access = resolve([team("cache"), team("markup"), person("markup", false)]);
  assert.deepEqual(access.tools, ["home", "settings", "cache"]);
});

test("a refusal beats the grant however the rows come back", () => {
  const forwards = resolve([team("markup"), person("markup", false)]);
  const backwards = resolve([person("markup", false), team("markup")]);
  assert.deepEqual(forwards.tools, backwards.tools);
  assert.equal(forwards.tools.includes("markup"), false);
});

test("a person's rule alone does not make an unconfigured team configured", () => {
  // Otherwise granting one person one tool would silently take every other tool
  // away from everybody else on their team.
  assert.equal(resolve([person("lookup")]).configured, false);
});

test("a grant belongs to a team or a person, never both and never neither", () => {
  assert.match(MIGRATION, /CHECK \(\("teamId" IS NULL\) <> \("memberId" IS NULL\)\)/);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX "ToolGrant_teamId_tool_key"/);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX "ToolGrant_memberId_tool_key"/);
  assert.match(SCHEMA, /@@unique\(\[teamId, tool\]\)/);
});

test("hiding a tool is backed by refusing it, on every route that does its work", () => {
  // The point of the enforcement: anyone signed in can call the API directly,
  // so a rail that merely omits an icon restricts nobody.
  const guarded: [string, string][] = [
    ["src/app/api/projects/route.ts", "markup"],
    ["src/app/api/projects/[id]/route.ts", "markup"],
    ["src/app/api/projects/[id]/pages/[pageId]/route.ts", "markup"],
    ["src/app/api/projects/[id]/pdf/route.ts", "markup"],
    ["src/app/api/blob-upload/route.ts", "markup"],
    ["src/app/api/keap/stages/route.ts", "markup"],
    ["src/app/api/keap/lookup/route.ts", "lookup"],
  ];
  for (const [rel, tool] of guarded) {
    const source = read(rel);
    const handlers = (source.match(/if \(isDenied\(who\)\) return who;/g) ?? []).length;
    const checks = (source.match(/requireTool\(who, "/g) ?? []).length;
    assert.equal(checks, handlers, `${rel}: ${handlers} handler(s) but ${checks} tool check(s)`);
    assert.ok(source.includes(`requireTool(who, "${tool}")`), `${rel} checks the wrong tool`);
  }
});

test("a refused tool says so rather than pretending it is not there", () => {
  assert.match(ACCESS, /status: 403/);
  assert.equal(/status: 404/.test(ACCESS), false,
    "a 404 would send somebody hunting for a bug that is really a permission");
});

test("deciding who gets a tool needs the admin key, not a tool's own user", () => {
  for (const verb of ["POST", "DELETE"]) {
    const at = ROUTE.indexOf(`export async function ${verb}`);
    assert.ok(at > 0, `${verb} is missing`);
    assert.match(ROUTE.slice(at, at + 160), /requireStaff\(request\)/);
  }
  // And reading your own is the signed-in case, not the admin one.
  const get = ROUTE.slice(ROUTE.indexOf("export async function GET"));
  assert.match(get.slice(0, 200), /requireTeam\(request\)/);
});

test("a rule can be removed, not only flipped", () => {
  // Removing a person's rule puts them back on their team's; removing a team's
  // last one puts the team back to everything. Without it the only way out of a
  // mistake is another rule on top of it.
  assert.match(ROUTE, /export async function DELETE/);
  assert.match(ROUTE, /toolGrant\.deleteMany/);
});
