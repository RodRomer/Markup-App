// Every staff route used to be opened by one shared key. Now each is scoped to
// the team that signed in, and the failure this guards is the quiet one: a
// route that authenticates the caller correctly and then looks a project up by
// id alone, handing one team another team's work while looking perfectly
// correct in review.
//
// Structural, because the alternative is a live database with two teams in it.
// What it asserts is that the set of staff routes and the set of routes that
// scope by team stay the same set.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "..");
const STAFF_API = path.join(REPO, "src/app/api/projects");
const CLIENT_API = path.join(REPO, "src/app/api/markup");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === "route.ts" ? [full] : [];
  });
}

const verbs = (source: string) =>
  [...source.matchAll(/export async function ([A-Z]+)/g)].map((m) => m[1]);

test("every staff route makes the caller prove which team they are", () => {
  const files = routeFiles(STAFF_API);
  assert.ok(files.length >= 4, `only found ${files.length} staff routes -- did the tree move?`);

  const unguarded = files.filter((f) => !readFileSync(f, "utf8").includes("requireTeam("));
  assert.deepEqual(unguarded.map((f) => path.relative(REPO, f)), [],
    "these staff routes do not establish a team");
});

test("no staff route still opens on the old shared key", () => {
  // MARKUP_STAFF_KEY is the admin key now. If it ever guards a project route
  // again, one secret opens every team's work and teams are decorative.
  for (const file of routeFiles(STAFF_API)) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("requireStaff("), false,
      `${path.relative(REPO, file)} is still guarded by the admin key`);
  }
});

test("every staff route narrows to the team, not just to the id", () => {
  // The dangerous shape is a correct requireTeam followed by a lookup on id
  // alone. Signing in as any team would then reach every project.
  const missing: string[] = [];
  for (const file of routeFiles(STAFF_API)) {
    const source = readFileSync(file, "utf8");
    if (!/where: \{ id[,:]/.test(source) && !source.includes("findMany")) continue;
    if (!source.includes("teamId: who.teamId")) missing.push(path.relative(REPO, file));
  }
  assert.deepEqual(missing, [],
    "these look a project up without constraining it to the caller's team");
});

test("the only other staff route, blob upload, is scoped too", () => {
  // Not under /api/projects, so the sweep above does not reach it -- and it is
  // the one route that grants write access to storage. Open, anyone could fill
  // the blob store; on the admin key, a second credential would be doing
  // everyday work.
  const route = readFileSync(path.join(REPO, "src/app/api/blob-upload/route.ts"), "utf8");
  assert.ok(route.includes("requireTeam("), "the upload route does not establish a team");
  assert.equal(route.includes("requireStaff("), false,
    "the upload route is on the admin key");
});

test("the admin key still guards team management, and only that", () => {
  const teams = readFileSync(path.join(REPO, "src/app/api/teams/route.ts"), "utf8");
  assert.ok(teams.includes("requireStaff("),
    "creating a team must stay behind the admin key -- it is the bootstrap");
  assert.equal(teams.includes("passwordHash: true"), false,
    "a team's password hash must never be selected for return");
});

test("the client's routes are still open, and still only the token", () => {
  // The whole point of the decision: a client authenticates with nothing but
  // the link they were sent. If team auth ever spreads here, every client needs
  // an account.
  const files = routeFiles(CLIENT_API);
  assert.ok(files.length >= 5, `only found ${files.length} client routes`);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("requireTeam("), false,
      `${path.relative(REPO, file)} now demands a team sign-in from a client`);
    assert.equal(source.includes("requireStaff("), false,
      `${path.relative(REPO, file)} now demands the admin key from a client`);
  }
});

test("signing in is the one route that takes a password", () => {
  const login = readFileSync(path.join(REPO, "src/app/api/auth/login/route.ts"), "utf8");
  assert.deepEqual(verbs(login), ["POST"], "login should accept nothing but a POST");
  assert.ok(login.includes("verifyPassword("), "login no longer verifies anything");
  // A wrong team name and a wrong password must cost the same, or the response
  // time sorts real team names from invented ones.
  assert.match(login, /scrypt\$16384/,
    "login no longer verifies against a dummy hash when the team does not exist");
});
