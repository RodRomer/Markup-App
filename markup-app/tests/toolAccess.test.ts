// Waystone is the shell and its tools are what sits inside it, so what appears
// in somebody's rail is decided here rather than on their machine. A team grants
// the tools its work needs; a person can be given one their team lacks, or
// refused one it has.
//
// The rule worth guarding hardest is the default: a team nobody has configured
// gets everything. Get that wrong and shipping this empties every existing rail
// on the day it arrives.
//
// This calls the real rule. It used to carry a hand-copied reimplementation of
// it, because the rule lived beside a Prisma query -- which meant every test
// below passed whether or not the shipped function still agreed with the copy.
// resolveToolGrants was split out into a module with no imports so that this
// file can simply call it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolveToolGrants } from "../src/lib/resolveToolGrants.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

// Still read as text: requireTool answers with a NextResponse built from a
// Prisma-backed lookup, so the status it chooses cannot be asserted here
// without a database. The rule it guards is tested by calling it, above.
const ACCESS = read("src/lib/toolAccess.ts");
const ROUTE = read("src/app/api/tools/route.ts");
const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read("prisma/migrations/20260918000000_add_tool_grants/migration.sql");

const team = (tool: string, allowed = true) => ({ tool, teamId: "t1", memberId: null, allowed });
const person = (tool: string, allowed = true) => ({ tool, teamId: null, memberId: "m1", allowed });

test("a team nobody has configured gets everything", () => {
  const access = resolveToolGrants([]);
  assert.equal(access.configured, false);
  assert.deepEqual(access.tools, []);
  assert.deepEqual(access.refused, []);
});

test("a configured team with no tools gets none, which is not the same thing", () => {
  // The same empty `tools` as above and the opposite meaning. Waystone reads
  // `configured` to tell them apart; collapsing the two would either empty
  // every unconfigured rail or make a deliberate refusal show everything.
  const access = resolveToolGrants([team("cache", false)]);
  assert.equal(access.configured, true);
  assert.deepEqual(access.tools, ["home", "settings"]);
});

test("a team gets what it was granted, plus the screens nobody can lose", () => {
  const access = resolveToolGrants([team("cache"), team("markup")]);
  assert.deepEqual(access.tools, ["home", "settings", "cache", "markup"]);
  assert.equal(access.configured, true);
});

test("a person can be given a tool their team does not have", () => {
  const access = resolveToolGrants([team("cache"), person("lookup")]);
  assert.ok(access.tools.includes("lookup"));
});

test("a person can be refused a tool their team has", () => {
  const access = resolveToolGrants([team("cache"), team("markup"), person("markup", false)]);
  assert.equal(access.tools.includes("markup"), false);
  assert.ok(access.tools.includes("cache"));
});

test("a refusal beats a grant whichever order the rows arrive in", () => {
  const forwards = resolveToolGrants([team("markup"), person("markup", false)]);
  const backwards = resolveToolGrants([person("markup", false), team("markup")]);
  assert.deepEqual(forwards.tools, backwards.tools);
  assert.equal(forwards.tools.includes("markup"), false);
});

test("a person's grant alone does not make an unconfigured team configured", () => {
  // Otherwise granting one person one tool would silently take every other tool
  // away from everybody else on their team.
  assert.equal(resolveToolGrants([person("lookup")]).configured, false);
});

test("a person's refusal bites even though their team was never configured", () => {
  // The bug this replaced: the unconfigured short-circuit ran before member
  // rows were looked at, so this refusal was written, acknowledged with a 200,
  // and then discarded. Keeping one person out of a tool would have meant first
  // granting their whole team everything it already implicitly had -- the exact
  // workflow the per-person override exists to avoid.
  const access = resolveToolGrants([person("markup", false)]);
  assert.equal(access.configured, false);
  assert.deepEqual(access.refused, ["markup"]);
});

test("a refusal does not take away anything else", () => {
  // `refused` names what is gone; it must not turn into a whitelist, or an
  // unconfigured team would lose every tool this server has never heard of.
  const access = resolveToolGrants([person("snip", false), person("markup", false)]);
  assert.deepEqual(access.refused, ["markup", "snip"]);
  assert.deepEqual(access.tools, []);
});

test("a refusal cannot lock somebody out of Home or Settings", () => {
  // However the row got written. With neither screen there is nowhere left to
  // put the refusal right from.
  assert.deepEqual(resolveToolGrants([person("settings", false)]).refused, []);
  const configured = resolveToolGrants([team("cache"), person("home", false)]);
  assert.ok(configured.tools.includes("home"));
  assert.ok(configured.tools.includes("settings"));
});

test("a configured team never carries refusals -- it already says what it has", () => {
  const access = resolveToolGrants([team("cache"), person("markup", false)]);
  assert.deepEqual(access.refused, []);
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
