// One password per team meant one credential everybody knew: no way to refuse
// one person without changing it for all of them, and no record of who did
// anything. A Member is the credential; the team is still the scope, so people
// get their own login and keep seeing the same projects.
//
// These read the routes rather than run them -- the routes need Prisma and a
// database, and what matters here is the shape of the decisions they make.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "../src/lib/password.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const LOGIN = read("src/app/api/auth/login/route.ts");
const MEMBERS = read("src/app/api/members/route.ts");
const AUTH = read("src/lib/teamAuth.ts");
const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read("prisma/migrations/20260917000000_add_members/migration.sql");

test("a person's login is a credential, and the team is still the scope", () => {
  // The whole point: had Member carried its own projects, two logins would mean
  // two separate sets of work, which is what having one shared password avoided.
  assert.match(SCHEMA, /model Member \{[\s\S]*?teamId\s+String[\s\S]*?\}/,
    "a member does not belong to a team");
  const member = SCHEMA.slice(SCHEMA.indexOf("model Member"), SCHEMA.indexOf("model Session"));
  assert.equal(/projects\s+Project\[\]/.test(member), false,
    "members own projects, so two logins would see different work");
  assert.match(SCHEMA, /model Session \{[\s\S]*?teamId\s+String\b/,
    "a session no longer carries the team that scopes it");
});

test("signing in tries the person first and the shared password second", () => {
  assert.ok(LOGIN.indexOf("prisma.member.findUnique") < LOGIN.indexOf("prisma.team.findUnique"),
    "the team password is checked before a person's own login");
  assert.match(LOGIN, /memberId: member\?\.id \?\? null/,
    "the session does not record who signed in");
});

test("the shared team password still works during the changeover", () => {
  // Removing it would sign everyone out at the moment of the change, including
  // machines nobody has got to yet.
  assert.match(LOGIN, /team\?\.passwordHash/);
  assert.match(SCHEMA, /memberId\s+String\?/, "a team-password session has no member to point at");
  assert.match(MIGRATION, /ADD COLUMN "memberId" TEXT;/);
  assert.equal(/ADD COLUMN "memberId" TEXT NOT NULL/.test(MIGRATION), false,
    "existing sessions would break the migration");
});

test("a disabled person is refused, and told nothing they did not already know", () => {
  assert.match(LOGIN, /member\?\.disabledAt/, "a disabled login still signs in");
  // One message for a wrong name, a wrong password and a switched-off account.
  const messages = [...LOGIN.matchAll(/error: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(messages)], ["Wrong name or password."],
    "the refusals are worded differently, which says which names are real");
});

test("disabling takes effect now, not whenever the session would have expired", () => {
  assert.match(MEMBERS, /disabledAt: body\.disabled \? new Date\(\) : null/);
  assert.match(MEMBERS, /session\.deleteMany\(\{ where: \{ memberId: member\.id \} \}\)/,
    "their open sessions survive being switched off");
  // And the gap between the two: a request already in flight.
  assert.match(AUTH, /session\.member\?\.disabledAt/,
    "a session opened moments before disabling keeps working");
});

test("changing a password ends the sessions it opened", () => {
  const patch = MEMBERS.slice(MEMBERS.indexOf("export async function PATCH"));
  const passwordBranch = patch.slice(0, patch.indexOf("if (typeof body?.disabled"));
  assert.match(passwordBranch, /deleteMany\(\{ where: \{ memberId: member\.id \} \}\)/,
    "a leaked password stays usable through an already-open session");
});

test("managing logins needs the admin key, and cannot read anyone's work", () => {
  for (const verb of ["GET", "POST", "PATCH"]) {
    const at = MEMBERS.indexOf(`export async function ${verb}`);
    assert.ok(at > 0, `${verb} is missing`);
    assert.match(MEMBERS.slice(at, at + 200), /requireStaff\(request\)/,
      `${verb} does not check the admin key`);
  }
  assert.equal(/prisma\.project\./.test(MEMBERS), false, "the admin route touches projects");
  assert.equal(/passwordHash: true/.test(MEMBERS), false, "it can read password hashes back out");
});

test("two people cannot answer to one name", () => {
  assert.match(SCHEMA, /name\s+String\s+@unique/);
  assert.match(MIGRATION, /CREATE UNIQUE INDEX "Member_name_key"/);
  // Including against a team name, since sign-in takes a name and nothing else.
  assert.match(MEMBERS, /prisma\.team\.findUnique\(\{ where: \{ name \} \}\)/,
    "a person could be created with a team's name, and neither could sign in");
});

test("a person's password is held to the same floor as a shared one", () => {
  assert.match(MEMBERS, /password\.length < PASSWORD_MIN_LENGTH/);
  assert.ok(PASSWORD_MIN_LENGTH >= 12);
  // And hashed the same way, per person: two people choosing the same password
  // must not end up with the same hash.
  const [a, b] = [hashPassword("correct horse battery"), hashPassword("correct horse battery")];
  assert.notEqual(a, b);
  assert.equal(verifyPassword("correct horse battery", a), true);
});

test("removing a person removes their sessions with them", () => {
  assert.match(MIGRATION, /"Member_teamId_fkey"[\s\S]*?ON DELETE CASCADE/);
  assert.match(MIGRATION, /"Session_memberId_fkey"[\s\S]*?ON DELETE CASCADE/);
});

test("who signed in is available to every guarded route", () => {
  assert.match(AUTH, /memberId: string \| null/);
  assert.match(AUTH, /memberName: string \| null/);
  // Without changing what a route is allowed to see, which is still the team.
  assert.match(AUTH, /teamId: session\.team\.id/);
});
