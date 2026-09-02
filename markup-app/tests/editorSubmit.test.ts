// MarkupEditor's own patchMarker and handleSubmit, lifted out of the component
// and given stubs for the React state they close over. There is no DOM here, so
// what is under test is the two functions' real source text -- read from the
// file and checked to be the ones expected before being run.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const EDITOR = path.resolve(import.meta.dirname, "../src/components/MarkupEditor.tsx");

function lift(source: string, name: string, mustContain: string[]): string {
  const start = source.indexOf(`  async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found -- has it been renamed?`);
  const end = source.indexOf(LF + "  }" + LF, start);
  assert.notEqual(end, -1, `${name} has no end`);
  const body = source.slice(start, end + 5);
  for (const needle of mustContain) {
    assert.ok(body.includes(needle), `${name} lacks ${JSON.stringify(needle)} -- lifted the wrong text`);
  }
  return body.replace("  async function ", "async function ");
}

function buildFactory() {
  const source = readFileSync(EDITOR, "utf8").split(CR + LF).join(LF);
  const module_ = [
    "export function build(state) {",
    "  const { token, setError, setStatus, markSaved, setSubmitting, setSelectedMarkerId,",
    "          setSelectedTool, fetch, saveFailed, setSaveFailed, setConfirmingSubmit } = state;",
    lift(source, "patchMarker", ['method: "PATCH"', "catch"]),
    lift(source, "handleSubmit", ["/submit", 'setStatus("submitted")']),
    "  return { patchMarker, handleSubmit };",
    "}",
  ].join(LF);
  const file = path.join(mkdtempSync(path.join(tmpdir(), "editor-")), "lifted.ts");
  writeFileSync(file, module_, "utf8");
  return import(pathToFileURL(file).href);
}

async function dragThenSubmit(patchSucceeds: boolean) {
  const { build } = await buildFactory();
  let error: string | null = null;
  let status = "sent";
  let saidSaved = false;
  let patchReached = false;
  let failed = false;

  const state = {
    token: "tok",
    setError: (v: string | null) => { error = v; },
    setStatus: (v: string) => { status = v; },
    markSaved: () => { saidSaved = true; },
    setSubmitting: () => {},
    setSelectedMarkerId: () => {},
    setSelectedTool: () => {},
    setConfirmingSubmit: () => {},
    get saveFailed() { return failed; },
    setSaveFailed: (v: boolean) => { failed = v; },
    fetch: async (_url: string, init?: { method?: string }) => {
      if (init?.method === "PATCH") {
        patchReached = patchSucceeds;
        return patchSucceeds
          ? { ok: true, json: async () => ({}) }
          : { ok: false, json: async () => ({ error: "Service Unavailable" }) };
      }
      return { ok: true, json: async () => ({ status: "submitted" }) };
    },
  };

  // The client drags a marker; the editor has already moved it on screen.
  await build(state).patchMarker("marker_1", { x: 0.42, y: 0.31 });
  // Built again for the second action: these are closures over one render's
  // state, and React hands the Submit button a fresh one after any setState.
  // Reusing the first closure would freeze saveFailed at its old value and test
  // the model rather than the app.
  await build(state).handleSubmit();
  return { status, error, saidSaved, patchReached };
}

test("a markup whose changes all saved submits normally", async () => {
  // The control. If this stops passing the guard has become a wall.
  const run = await dragThenSubmit(true);
  assert.equal(run.patchReached, true);
  assert.equal(run.saidSaved, true);
  assert.equal(run.status, "submitted");
  assert.equal(run.error, null);
});

test("a change that never reached the server blocks submitting", async () => {
  // patchMarker leaves the marker where it was dragged, so the screen shows
  // something the server does not have. Submitting used to lock that in and
  // clear the only warning there was, ending exactly where a complete markup
  // ends -- the drafter would then read stale geometry with nothing saying so.
  const run = await dragThenSubmit(false);

  assert.equal(run.patchReached, false);
  assert.equal(run.status, "sent", "it locked a markup that does not match what was drawn");
  assert.ok(run.error, "it submitted with nothing said");
  assert.match(run.error!, /reload/i, "the message has to say how to find out what was saved");
});
