// The overage check's reads from Keap.
//
// The stage listing is a GET in keap.ts and inherits that file's guard (see
// keapDelivery.test.ts, which still passes over it). Stage history is the one
// POST, so it lives in its own file and is held to its own, narrower promise:
// it can ask Keap one question -- when did this opportunity change stage -- and
// nothing else. The responses below are synthetic, shaped like Keap's; no
// client data is in this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { retryWaitMs } from "../src/lib/keap.ts";
import { lastEntered, parseStageMoves, stageMoveQuery } from "../src/lib/keapStageHistory.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const SOURCE = readFileSync(path.join(REPO, "src/lib/keapStageHistory.ts"), "utf8");

// --- it can only ever ask the one question ---

test("the method and the table are constants, and the only ones", () => {
  assert.match(SOURCE, /const METHOD = "DataService\.query";/);
  assert.match(SOURCE, /const TABLE = "StageMove";/);
  // Any other XML-RPC service or verb -- update, add, delete, a contact
  // service -- would mean this file can do more than read one table.
  const services = [...SOURCE.matchAll(/"([A-Za-z]+Service\.[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(services, ["DataService.query"]);
  for (const verb of ["update", "add", "delete", "dsUpdate", "dsAdd", "dsDelete", "save"]) {
    assert.equal(new RegExp(`Service\\.${verb}\\b`).test(SOURCE), false, `${verb} appears`);
  }
});

test("the one request it makes is a POST to the XML-RPC endpoint and nowhere else", () => {
  assert.equal([...SOURCE.matchAll(/method\s*:/g)].length, 1, "more than one request shape");
  assert.match(SOURCE, /method: "POST"/);
  assert.equal([...SOURCE.matchAll(/fetch\(/g)].length, 1, "more than one place calls out");
  assert.match(SOURCE, /fetch\(XMLRPC_URL,/);
});

test("the query takes an id and a key, and nothing that could steer it", () => {
  const xml = stageMoveQuery("key", 42);
  assert.match(xml, /<methodName>DataService\.query<\/methodName>/);
  assert.match(xml, /<string>StageMove<\/string>/);
  assert.match(xml, /<name>OpportunityId<\/name><value><int>42<\/int><\/value>/);
  assert.match(xml, /<string>MoveDate<\/string><\/value><value><string>MoveToStage<\/string>/);
});

test("an id that is not a whole number is refused before anything is sent", () => {
  for (const bad of [1.5, -1, 0, NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => stageMoveQuery("key", bad), /Not an opportunity id/);
  }
});

test("the key is escaped, so it cannot close a tag and add to the query", () => {
  const xml = stageMoveQuery(`k</string></value></param><param>&"'`, 1);
  assert.equal(xml.includes("</string></value></param><param>&"), false);
  assert.match(xml, /k&lt;\/string&gt;&lt;\/value&gt;&lt;\/param&gt;&lt;param&gt;&amp;&quot;&apos;/);
});

// --- reading what comes back ---

const move = (date: string, stage: string) =>
  `<value><struct>` +
  `<member><name>MoveDate</name><value><dateTime.iso8601>${date}</dateTime.iso8601></value></member>` +
  `<member><name>MoveToStage</name><value>${stage}</value></member>` +
  `</struct></value>`;
const response = (...moves: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><methodResponse><params><param><value><array><data>` +
  moves.join("\n") +
  `</data></array></value></param></params></methodResponse>`;

test("moves are read out of Keap's response, whatever the number is wrapped in", () => {
  const moves = parseStageMoves(response(
    move("20260909T13:04:41", "<i4>61</i4>"),
    move("20260801T09:00:00", "<int>12</int>"),
    move("20260915T08:30:00", "61"), // untyped values are strings in XML-RPC
  ));
  assert.deepEqual(moves, [
    { day: "2026-09-09", toStage: 61 },
    { day: "2026-08-01", toStage: 12 },
    { day: "2026-09-15", toStage: 61 },
  ]);
});

test("the last entry into the stage wins, as it did in the prototype", () => {
  // A project that left CAD Live and came back is counted from its return.
  const moves = parseStageMoves(response(
    move("20260915T08:30:00", "<i4>61</i4>"),
    move("20260909T13:04:41", "<i4>61</i4>"),
    move("20260920T10:00:00", "<i4>70</i4>"),
  ));
  assert.equal(lastEntered(moves, 61), "2026-09-15");
});

test("a project that never entered the stage has no date", () => {
  assert.equal(lastEntered(parseStageMoves(response(move("20260909T13:04:41", "<i4>12</i4>"))), 61), null);
  assert.equal(lastEntered(parseStageMoves(response()), 61), null);
});

test("a row missing its date is skipped, not read as a date", () => {
  const broken = `<value><struct><member><name>MoveToStage</name><value><i4>61</i4></value></member></struct></value>`;
  assert.deepEqual(parseStageMoves(response(broken)), []);
});

test("a fault is Keap saying no, and is raised rather than read as no moves", () => {
  // Read as "no moves", a rejected key would quietly give every project
  // "no stage history" and clear every missing-SF alert in Warden.
  const fault =
    `<?xml version="1.0"?><methodResponse><fault><value><struct>` +
    `<member><name>faultCode</name><value><i4>2</i4></value></member>` +
    `<member><name>faultString</name><value>[InvalidKey]Invalid Key</value></member>` +
    `</struct></value></fault></methodResponse>`;
  assert.throws(() => parseStageMoves(fault), /Invalid Key/);
});

// --- slowing down when Keap asks ---

test("Retry-After is honoured, but never for longer than a function can wait", () => {
  assert.equal(retryWaitMs("2", 1000), 2000);
  assert.equal(retryWaitMs("99999", 1000), 10_000);
  assert.equal(retryWaitMs("not a number", 1500), 1500);
  assert.equal(retryWaitMs(null, 40_000), 10_000);
  const soon = new Date(Date.now() + 3000).toUTCString();
  const waited = retryWaitMs(soon, 1000);
  assert.ok(waited > 1000 && waited <= 3000, `an HTTP date gave ${waited}`);
});
