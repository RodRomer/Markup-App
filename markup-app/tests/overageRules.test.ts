// The overage rules, ported from the prototype in VS Development\Overage.
//
// Every case in its tests/test_rules.py is here with the same input and the
// same answer: 25 for reading SF out of notes, one for business days, seven
// for evaluate. That parity is what lets the port be trusted, so this file
// should keep saying the same things as that one -- a case added there belongs
// here too.
import assert from "node:assert/strict";
import test from "node:test";

import {
  businessDaysSince,
  evaluate,
  MISSING_SF,
  OVER_SF,
  overageThreshold,
  parseSf,
  projectFromOpportunity,
  type Project,
} from "../src/lib/overage/rules.ts";

const PARSE_CASES: [string | null, number | null][] = [
  ["2802 sf", 2802],
  ["2,802 SF", 2802],
  ["2802 sq ft", 2802],
  ["2802 sq. ft.", 2802],
  ["measured 2802 square feet", 2802],
  ["2802sf", 2802],
  ["Revit 2023", null],
  ["-SCHEDULING - keep this one at C3 - no vendor", null],
  ["EDD must be &lt;25 business days from survey date", null],
  ["Client Markup Link: https://runemarks.vercel.app/markup/cmtu8ts4t000104l8s2so46mz", null],
  ["first pass 2500 sf&#013;updated 3100 sf", 3100],
  ["2802 sfr lot", null],
  ["SF 2802", 2802],
  ["SF: 2,802", 2802],
  ["sf=2802", 2802],
  ["Sq Ft - 2802", 2802],
  ["Square Feet: 2802", 2802],
  ["updated SF: 3100", 3100],
  ["SF 2500&#013;now 3100 sf", 3100],
  ["2500 sf&#013;SF: 3100", 3100],
  ["SFR 2802", null],
  ["transfer 2802", null],
  ["SF 25", null],
  ["", null],
  [null, null],
];

for (const [notes, expected] of PARSE_CASES) {
  test(`parseSf(${JSON.stringify(notes)}) is ${expected}`, () => {
    assert.equal(parseSf(notes), expected);
  });
}

test("business days across a weekend", () => {
  const friday = "2026-09-11";
  assert.equal(businessDaysSince(friday, friday), 0);
  assert.equal(businessDaysSince(friday, "2026-09-13"), 0); // Sunday
  assert.equal(businessDaysSince(friday, "2026-09-14"), 1); // Monday
  assert.equal(businessDaysSince(friday, "2026-09-16"), 3); // Wednesday
});

function project({ notes = "", overage = 2800 as number | null, pmEmail = "pm@example.com" } = {}): Project {
  return { oppId: 1, number: "1234_XX", drafter: "Some Drafter", pmEmail, overage, sfEst: 2500, notes };
}

const MON = "2026-09-14";

test("missing SF after three business days", () => {
  const r = evaluate(project(), "2026-09-09", MON); // Wed -> Mon = 3
  assert.deepEqual(r.alerts.map((a) => a.kind), [MISSING_SF]);
});

test("missing SF waits before three business days", () => {
  const r = evaluate(project(), "2026-09-10", MON); // Thu -> Mon = 2
  assert.deepEqual(r.alerts, []);
  assert.equal(r.status, "waiting on SF");
});

test("no stage history does not alert", () => {
  const r = evaluate(project(), null, MON);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.status, "no stage history");
});

test("over threshold alerts the PM", () => {
  const r = evaluate(project({ notes: "3081 sf" }), "2026-09-11", MON); // 2800 * 1.1 = 3080
  assert.deepEqual(r.alerts.map((a) => a.kind), [OVER_SF]);
});

test("exactly at the threshold is OK", () => {
  const r = evaluate(project({ notes: "3080 sf" }), "2026-09-11", MON);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.status, "OK");
});

test("a zero overage is skipped", () => {
  const r = evaluate(project({ notes: "9999 sf", overage: 0 }), "2026-09-01", MON);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.status, "no overage baseline");
});

test("a missing PM email is still flagged", () => {
  const r = evaluate(project({ notes: "5000 sf", pmEmail: "" }), "2026-09-01", MON);
  assert.deepEqual(r.alerts.map((a) => a.kind), [OVER_SF]);
  assert.ok(r.status.includes("no PM email"));
});

// --- beyond the prototype: what the port had to decide for itself ---

test("the threshold floors the same way Python's math.floor did", () => {
  // 2800 * 1.1 is 3080.0000000000005 in binary floating point in both
  // languages; flooring it is what makes 3080 "at" rather than "over".
  assert.equal(overageThreshold(2800), 3080);
  assert.equal(overageThreshold(null), null);
  assert.equal(overageThreshold(0), null);
});

test("business days do not drift with the server's timezone", () => {
  // The dates are plain days. A Date built from "2026-09-14" in a zone west of
  // UTC is the 13th locally, which would make Monday a Sunday.
  assert.equal(businessDaysSince("2026-09-11", "2026-09-14"), 1);
  assert.equal(businessDaysSince("2026-12-31", "2027-01-04"), 2); // across a year
});

test("a Keap record becomes a project, whatever shape its fields arrive in", () => {
  const p = projectFromOpportunity({
    id: 42,
    opportunity_title: "1234_XX",
    custom_fields: [
      { id: 520, content: "2800" }, // Keap sends whole numbers as strings sometimes
      { id: 226, content: "2802 sf" },
      { id: 311, content: "  pm@example.com " },
      { id: 680, content: "Some Drafter" },
      { id: 208, content: 2500.7 },
    ],
  });
  assert.deepEqual(p, {
    oppId: 42, number: "1234_XX", drafter: "Some Drafter", pmEmail: "pm@example.com",
    overage: 2800, sfEst: 2500, notes: "2802 sf",
  });
});

test("fields Keap leaves out read as empty, not as a crash", () => {
  const p = projectFromOpportunity({ id: 7 });
  assert.equal(p.number, "");
  assert.equal(p.overage, null);
  assert.equal(p.notes, "");
  assert.equal(evaluate(p, null, MON).status, "no stage history");
});
