// The staff page now reads a project's stage out of Keap, using a key that
// lives on the server. Two things have to hold, and neither is obvious from
// looking at the feature working.
//
// It must only ever read. The key can change data in Keap, and "we only call it
// for searches" is a promise about how code is used rather than a property of
// the code.
//
// And it must agree with Waystone. The rules are stated twice, in two languages
// that cannot import from each other, so a project reading "Delivered" on one
// surface and blank on the other is a live possibility -- and that is worse than
// neither showing it, because it makes both untrustworthy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DELIVERED_STAGE,
  findOpportunity,
  isDelivered,
  numberFor,
  projectNumber,
  stageName,
} from "../src/lib/keapDelivery.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const opportunity = (title: string, stage = "CAD Live") => ({
  opportunity_title: title,
  stage: { name: stage },
});
const searching = (...opportunities: ReturnType<typeof opportunity>[]) => async () => opportunities;

// --- read-only, structurally ---

test("the Keap client cannot write, whatever it is asked to do", () => {
  const client = readFileSync(path.join(REPO, "src/lib/keap.ts"), "utf8");

  for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(client.includes(`"${verb}"`), false, `${verb} appears in the Keap client`);
    assert.equal(client.includes(`'${verb}'`), false, `${verb} appears in the Keap client`);
  }
  assert.equal(/method\s*:/.test(client), false,
    "the Keap client takes a method, so it is no longer read-only by construction");
  // The control: it really does still call Keap, so the check above cannot pass
  // by the whole thing having been emptied out.
  assert.ok(client.includes("fetch("), "the Keap client no longer calls anything");
  assert.ok(client.includes("Authorization"), "the Keap client no longer authenticates");
});

test("the stages route reads project numbers from the database, not the caller", () => {
  // A number taken from the request body would let anyone signed in ask Keap
  // about any project they cared to name, using the server's key. That is a
  // Keap search endpoint with extra steps.
  const route = readFileSync(path.join(REPO, "src/app/api/keap/stages/route.ts"), "utf8");
  assert.ok(route.includes("requireTeam("), "the stages route does not establish a team");
  assert.ok(route.includes("teamId: who.teamId"), "the stages route is not scoped to the team");
  assert.ok(route.includes("prisma.project.findMany"), "it no longer reads projects from the database");
  assert.equal(/request\.json\(\)/.test(route), false,
    "the stages route reads the request body, which is where a caller-supplied number would arrive");
});

// --- the same rules Waystone applies ---

test("the whole title wins over a number two jobs share", () => {
  const search = searching(
    opportunity("8704_BA", "Project Delivered"),
    opportunity("8704_LA", "CAD Live")
  );
  return findOpportunity({ name: "Bay Area job", projectNumber: "8704_BA" }, search).then((found) => {
    assert.equal(found?.opportunity_title, "8704_BA");
    assert.equal(isDelivered(found), true);
  });
});

test("the bare number refuses when more than one candidate carries it", async () => {
  const search = searching(
    opportunity("8704_BA", "Project Delivered"),
    opportunity("8704_LA", "CAD Live")
  );
  assert.equal(await findOpportunity({ name: "x", projectNumber: "8704" }, search), null);
});

test("a project with nothing to look up asks Keap nothing at all", async () => {
  let asked = false;
  const search = async () => {
    asked = true;
    return [];
  };
  assert.equal(await findOpportunity({ name: "Bay Area Fit-out" }, search), null);
  assert.equal(asked, false, "it searched Keap for a project with no number");
});

test("the term searched is the one given", async () => {
  const seen: string[] = [];
  const search = async (term: string) => {
    seen.push(term);
    return [opportunity("8704_BA", "Project Delivered")];
  };
  await findOpportunity({ name: "Bay Area job", projectNumber: "8704_BA" }, search);
  await findOpportunity({ name: "2830 Lawton Street" }, search);
  assert.deepEqual(seen, ["8704_BA", "2830"]);
});

test("the number given wins over one sitting in the name", () => {
  assert.equal(numberFor({ name: "9999 Old Road", projectNumber: "3524" }), "3524");
  assert.equal(numberFor({ name: "2830 Lawton Street" }), "2830");
  assert.equal(numberFor({ name: "Bay Area Fit-out" }), null);
  // Something that is not a number links to nothing rather than falling back to
  // the name, which could link this project to a different job entirely.
  assert.equal(numberFor({ name: "2830 Lawton Street", projectNumber: "TBC" }), null);
});

test("a number inside a name is not the project's number", () => {
  assert.equal(projectNumber("Suite 1070 Building"), null);
  assert.equal(projectNumber("28301_XX"), "28301", "a longer number is a different project");
});

test("Delivered is the only stage that counts, and a broken payload is not one", () => {
  assert.equal(DELIVERED_STAGE, "Project Delivered");
  assert.equal(isDelivered(opportunity("1_XX", "Project Complete")), false);
  assert.equal(isDelivered(opportunity("1_XX", "Project Delivered")), true);
  for (const broken of [null, undefined, {}, { stage: null }, { stage: {} }]) {
    assert.equal(isDelivered(broken), false);
    assert.equal(stageName(broken), null);
  }
});
