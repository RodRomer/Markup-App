// Who an overage email goes to, and what becomes of an alert between runs.
//
// The email *text* is the prototype's, and was checked against it over 720
// generated alerts with no difference. What is tested here is what the
// prototype never decided: recipients (it wrote "(email TBD)") and the
// once-only lifecycle the user settled on.
import assert from "node:assert/strict";
import test from "node:test";

import { compose, drafterKey, drafterNames } from "../src/lib/overage/compose.ts";
import { isPending, observe } from "../src/lib/overage/lifecycle.ts";
import { type Alert, MISSING_SF, OVER_SF, type Project } from "../src/lib/overage/rules.ts";

function project(overrides: Partial<Project> = {}): Project {
  return {
    oppId: 1, number: "1234_XX", drafter: "Jane Smith", pmEmail: "pm@example.com",
    overage: 2800, sfEst: 2500, notes: "", ...overrides,
  };
}

const missing = (p: Project): Alert =>
  ({ kind: MISSING_SF, project: p, notesSf: null, threshold: null, businessDays: 4 });
const over = (p: Project): Alert =>
  ({ kind: OVER_SF, project: p, notesSf: 3100, threshold: 3080, businessDays: 2 });

const EMAILS = new Map([
  [drafterKey("Jane Smith"), "jane@example.com"],
  [drafterKey("Bob Jones"), "bob@example.com"],
]);

// --- the drafter's email ---

test("a missing-SF alert goes to the drafter, looked up in Warden's list", () => {
  const e = compose(missing(project()), EMAILS);
  assert.deepEqual(e.to, ["jane@example.com"]);
  assert.equal(e.sendable, true);
  assert.equal(e.reason, null);
});

test("a name typed differently in Warden still matches", () => {
  const typed = new Map([[drafterKey("  jane   SMITH "), "jane@example.com"]]);
  assert.deepEqual(compose(missing(project()), typed).to, ["jane@example.com"]);
});

test("several drafters all get it", () => {
  const e = compose(missing(project({ drafter: "Jane Smith, Bob Jones" })), EMAILS);
  assert.deepEqual(e.to, ["jane@example.com", "bob@example.com"]);
});

test("a drafter with no email makes the alert unsendable, and says who", () => {
  // Not dropped: from Warden, a dropped alert looks exactly like nothing wrong.
  const e = compose(missing(project({ drafter: "New Person" })), EMAILS);
  assert.equal(e.sendable, false);
  assert.match(e.reason ?? "", /'New Person'/);
  assert.deepEqual(e.to, []);
});

test("one unmapped drafter out of two holds the whole email back", () => {
  // Sending to the one we know would leave the other never hearing about it,
  // and once-only means there is no second chance to reach them.
  const e = compose(missing(project({ drafter: "Jane Smith, New Person" })), EMAILS);
  assert.equal(e.sendable, false);
  assert.deepEqual(e.to, []);
  assert.match(e.reason ?? "", /'New Person'/);
  assert.doesNotMatch(e.reason ?? "", /Jane/);
});

test("no drafter at all says so rather than naming nobody", () => {
  const e = compose(missing(project({ drafter: "" })), EMAILS);
  assert.equal(e.sendable, false);
  assert.equal(e.reason, "No drafter is set in Keap.");
});

test("drafter names split the way Keap stores several", () => {
  assert.deepEqual(drafterNames("A, B ,,C"), ["A", "B", "C"]);
  assert.deepEqual(drafterNames(""), []);
});

// --- the PM's email ---

test("an over-threshold alert goes to the PM", () => {
  const e = compose(over(project()), EMAILS);
  assert.deepEqual(e.to, ["pm@example.com"]);
  assert.equal(e.sendable, true);
});

test("no PM email makes it unsendable, with the reason", () => {
  const e = compose(over(project({ pmEmail: "" })), EMAILS);
  assert.equal(e.sendable, false);
  assert.equal(e.reason, "No Project Manager email in Keap.");
});

test("the email says what the prototype's said", () => {
  const e = compose(over(project()), EMAILS);
  assert.equal(e.subject, "1234_XX: Building SF over overage threshold");
  assert.match(e.body, /CAD\/Plot Notes SF: 3,100\n/);
  assert.match(e.body, /Threshold \(Overage x 1\.1\): 3,080\n/);
  assert.match(e.body, /Over the Overage field by 10\.7%/);
});

// --- once only ---

const T1 = "2026-09-14T12:00:00.000Z";
const T2 = "2026-09-15T12:00:00.000Z";
const T3 = "2026-09-16T12:00:00.000Z";

test("a problem seen for the first time is a pending alert", () => {
  const s = observe(null, true, T1);
  assert.ok(s && isPending(s));
  assert.equal(s?.firstSeenAt, T1);
});

test("a problem nobody has seen is not recorded", () => {
  assert.equal(observe(null, false, T1), null);
});

test("an unsent alert that clears is no longer offered", () => {
  // The drafter added the SF before anyone sent the reminder.
  const s = observe(observe(null, true, T1), false, T2);
  assert.ok(s);
  assert.equal(s.resolvedAt, T2);
  assert.equal(isPending(s), false);
});

test("an unsent alert that comes back is offered again", () => {
  // Nobody has been told about it yet, so there is nothing to protect.
  const cleared = observe(observe(null, true, T1), false, T2);
  const back = observe(cleared, true, T3);
  assert.ok(back && isPending(back));
  assert.equal(back.firstSeenAt, T1, "the history is kept, not restarted");
});

test("a sent alert is never offered again, even when the problem comes back", () => {
  const sent = { ...observe(null, true, T1)!, sentAt: T1 };
  const cleared = observe(sent, false, T2)!;
  const back = observe(cleared, true, T3)!;
  assert.equal(isPending(back), false);
  assert.equal(back.sentAt, T1, "a run must never clear who was told and when");
});

test("a run that still sees a problem does not move when it cleared", () => {
  const s = observe(observe(null, true, T1), false, T2)!;
  assert.equal(observe(s, false, T3)!.resolvedAt, T2);
});
