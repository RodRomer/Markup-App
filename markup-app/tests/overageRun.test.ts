// The overage run and Warden's routes.
//
// What a run changes is decided in plan.ts and what Warden is shown in view.ts,
// both pure, so those are tested by calling them. The routes are I/O around
// them and are held to their guarantees structurally -- who may call them, and
// that nothing but a claim ever marks an alert sent.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { cronAuthorized } from "../src/lib/cronAuth.ts";
import { localDay, planAlertChanges, reportRows, type AlertRow } from "../src/lib/overage/plan.ts";
import { drafterKey } from "../src/lib/overage/compose.ts";
import { type Alert, evaluate, MISSING_SF, OVER_SF, type Project } from "../src/lib/overage/rules.ts";
import { alertFromRow, pendingEmails, type StoredAlert, unmappedDrafters } from "../src/lib/overage/view.ts";
import { timingSafeEqual } from "../src/lib/timingSafe.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

function project(oppId: number, overrides: Partial<Project> = {}): Project {
  return { oppId, number: `${1000 + oppId}_XX`, drafter: "Jane Smith", pmEmail: "pm@example.com",
           overage: 2800, sfEst: 2500, notes: "", ...overrides };
}
const missing = (oppId: number): Alert =>
  ({ kind: MISSING_SF, project: project(oppId), notesSf: null, threshold: null, businessDays: 4 });

const T0 = "2026-09-14T12:00:00.000Z";
const NOW = "2026-09-15T12:00:00.000Z";
const row = (oppId: number, over: Partial<AlertRow> = {}): AlertRow =>
  ({ oppId, kind: MISSING_SF, firstSeenAt: T0, lastSeenAt: T0, resolvedAt: null, sentAt: null, ...over });

// --- what a run changes ---

test("a new problem becomes a new alert", () => {
  const changes = planAlertChanges([], [missing(1)], NOW);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].op, "create");
  assert.equal(changes[0].state.firstSeenAt, NOW);
});

test("a problem still there refreshes its alert, keeping when it was first seen", () => {
  const [change] = planAlertChanges([row(1)], [missing(1)], NOW);
  assert.equal(change.op, "update");
  assert.equal(change.state.firstSeenAt, T0);
  assert.equal(change.state.lastSeenAt, NOW);
  assert.ok(change.alert, "the figures are refreshed from what the run saw");
});

test("a problem the run no longer sees is resolved, figures left as last seen", () => {
  const [change] = planAlertChanges([row(1)], [], NOW);
  assert.equal(change.op, "update");
  assert.equal(change.state.resolvedAt, NOW);
  assert.equal(change.alert, null);
});

test("an alert already resolved and still gone is left alone", () => {
  assert.deepEqual(planAlertChanges([row(1, { resolvedAt: T0 })], [], NOW), []);
});

test("a project Keap listed twice is one alert", () => {
  assert.equal(planAlertChanges([], [missing(1), missing(1)], NOW).length, 1);
});

test("a run never changes sentAt -- only a claim does", () => {
  // The run reads, thinks and writes; a claim can land in between. Writing back
  // the sentAt it read would put a null over that claim and send twice.
  const sent = row(1, { sentAt: T0 });
  for (const change of [
    ...planAlertChanges([sent], [missing(1)], NOW),
    ...planAlertChanges([sent], [], NOW),
  ]) {
    assert.equal(change.state.sentAt, T0);
  }
  // And the writer: run.ts has to *read* sentAt to plan, but the loop that
  // writes the plan must never mention it. Comments are stripped first -- the
  // one there explains exactly this.
  const run = read("src/lib/overage/run.ts");
  const start = run.indexOf("for (const change of changes)");
  const end = run.indexOf("return tx.overageRun.create");
  assert.ok(start > 0 && end > start, "the write loop has moved; point this test at it");
  const writes = run.slice(start, end).replace(/\/\/[^\n]*/g, "");
  for (const field of ["sentAt", "sentByMemberId", "sentTo"]) {
    assert.equal(writes.includes(field), false, `run.ts writes ${field}`);
  }
});

test("the report lists every project, alert or not, in project order", () => {
  const today = "2026-09-14";
  const rows = reportRows([
    evaluate(project(2, { number: "2000_B" }), "2026-09-01", today),
    evaluate(project(1, { number: "1000_A", notes: "2000 sf" }), "2026-09-01", today),
  ]);
  assert.deepEqual(rows.map((r) => [r.number, r.status]), [["1000_A", "OK"], ["2000_B", "SF missing"]]);
});

test("today is PPM's day, not the server's", () => {
  // 7pm in Denver on the 14th is 1am UTC on the 15th. Counting from the 15th
  // would push a project over three business days a day early.
  assert.equal(localDay(new Date("2026-09-15T01:00:00Z"), "America/Denver"), "2026-09-14");
  assert.equal(localDay(new Date("2026-09-15T12:00:00Z"), "America/Denver"), "2026-09-15");
});

// --- what Warden is shown ---

const stored = (id: string, over: Partial<StoredAlert> = {}): StoredAlert => ({
  id, oppId: 1, kind: MISSING_SF, projectNumber: "1001_XX", drafter: "Jane Smith",
  pmEmail: "pm@example.com", overage: 2800, sfEst: 2500, notesSf: null, threshold: null,
  businessDays: 4, ...over,
});

test("sendable emails come first, then those waiting on an address", () => {
  const emails = new Map([[drafterKey("Jane Smith"), "jane@example.com"]]);
  const shown = pendingEmails([
    stored("a", { projectNumber: "1000_A", drafter: "Nobody Known" }),
    stored("b", { projectNumber: "2000_B" }),
  ], emails);
  assert.deepEqual(shown.map((p) => [p.id, p.email.sendable]), [["b", true], ["a", false]]);
});

test("adding an address makes a pending alert sendable at once", () => {
  // Composed when looked at, from the list as it is now -- not when the run
  // happened, which would leave it blocked until tomorrow.
  const alert = [stored("a", { drafter: "New Person" })];
  assert.equal(pendingEmails(alert, new Map())[0].email.sendable, false);
  const now = new Map([[drafterKey("New Person"), "new@example.com"]]);
  assert.equal(pendingEmails(alert, now)[0].email.sendable, true);
});

test("a stored over-threshold alert composes the PM's email", () => {
  const [p] = pendingEmails([stored("o", { kind: OVER_SF, notesSf: 3100, threshold: 3080 })], new Map());
  assert.deepEqual(p.email.to, ["pm@example.com"]);
});

test("an alert kind the rules never raise is an error, not a blank email", () => {
  assert.throws(() => alertFromRow(stored("x", { kind: "SOMETHING_ELSE" })), /Unknown alert kind/);
});

test("drafters without an address are listed once each, from the whole report", () => {
  const report = [
    { drafter: "Jane Smith, New Person" }, { drafter: "new person" }, { drafter: "" }, { drafter: "Another One" },
  ].map((r, i) => ({ oppId: i, number: String(i), entered: null, businessDays: null, notesSf: null,
                      overage: null, threshold: null, status: "", ...r }));
  const emails = new Map([[drafterKey("Jane Smith"), "jane@example.com"]]);
  assert.deepEqual(unmappedDrafters(report, emails), ["Another One", "New Person"]);
});

// --- the scheduler's secret ---

test("the cron route lets in only the configured secret", () => {
  assert.equal(cronAuthorized("Bearer s3cret", "s3cret"), true);
  assert.equal(cronAuthorized("Bearer wrong", "s3cret"), false);
  assert.equal(cronAuthorized("s3cret", "s3cret"), false, "the Bearer scheme is part of it");
  assert.equal(cronAuthorized(null, "s3cret"), false);
});

test("with no secret configured, nobody is let in -- Vercel included", () => {
  // Fails closed: a missed morning run shows in Warden as an old "last ran";
  // an open endpoint looks exactly like a working one.
  assert.equal(cronAuthorized("Bearer ", ""), false);
  assert.equal(cronAuthorized("Bearer undefined", undefined), false);
});

test("the shared comparison is still correct", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

// --- the routes ---

function routeFiles(dir: string): string[] {
  const full = path.join(REPO, dir);
  return readdirSync(full).flatMap((name) => {
    const p = path.join(full, name);
    return statSync(p).isDirectory() ? routeFiles(path.join(dir, name)) : name === "route.ts" ? [p] : [];
  });
}

test("every handler behind Warden checks for an admin before anything else", () => {
  const files = routeFiles("src/app/api/admin");
  assert.ok(files.length >= 4, "the admin routes have moved");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(request: Request\) \{\n([^\n]*)\n([^\n]*)/g)];
    assert.ok(handlers.length > 0, `${file} has no handlers`);
    for (const [, verb, first, second] of handlers) {
      assert.equal(first.trim(), "const who = await requireAdmin(request);", `${file} ${verb}`);
      assert.equal(second.trim(), "if (isAdminDenied(who)) return who;", `${file} ${verb}`);
    }
  }
});

test("an admin is a person holding the restricted tool, not a team", () => {
  const auth = read("src/lib/adminAuth.ts");
  assert.match(auth, /requireTeam\(request\)/);
  assert.match(auth, /!who\.memberId/);
  assert.match(auth, /requireTool\(who, "admin"\)/);
});

test("the cron route checks the secret before running anything", () => {
  const cron = read("src/app/api/cron/overage/route.ts");
  assert.ok(cron.indexOf("cronAuthorized(") < cron.indexOf("runOverageCheck("));
  assert.match(cron, /process\.env\.CRON_SECRET/);
});

test("claiming only takes an alert nobody has taken", () => {
  const claim = read("src/app/api/admin/overage/claim/route.ts");
  assert.match(claim, /updateMany\(\{\s*where: \{ id: row\.id, sentAt: null, resolvedAt: null \}/);
  assert.match(claim, /taken\.count === 1/);
});

test("a claim can only be handed back by whoever made it, and only soon after", () => {
  const release = read("src/app/api/admin/overage/release/route.ts");
  assert.match(release, /sentByMemberId: who\.memberId/);
  assert.match(release, /sentAt: \{ gte: new Date\(Date\.now\(\) - RELEASE_WINDOW_MS\) \}/);
});

test("nothing on the server sends email", () => {
  // Settled: an admin reviews and sends from their own Outlook. A mail library
  // or Graph call appearing here would be sending without that review.
  const server = [...routeFiles("src/app/api/admin"), ...routeFiles("src/app/api/cron")]
    .map((f) => readFileSync(f, "utf8")).join("\n") + read("src/lib/overage/run.ts");
  for (const sign of ["nodemailer", "graph.microsoft", "sendMail", "smtp", "resend"]) {
    assert.equal(server.toLowerCase().includes(sign.toLowerCase()), false, `${sign} appears`);
  }
});

test("the schedule is weekday mornings, at the route that checks the secret", () => {
  const vercel = JSON.parse(read("vercel.json"));
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/overage", schedule: "0 12 * * 1-5" }]);
});

test("the migration only adds tables", () => {
  const sql = read("prisma/migrations/20260919000000_add_overage/migration.sql");
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of statements) {
    assert.match(s, /^CREATE (TABLE|INDEX|UNIQUE INDEX) "/, `not a pure addition: ${s.slice(0, 60)}`);
  }
  assert.equal(statements.length, 7);
});
