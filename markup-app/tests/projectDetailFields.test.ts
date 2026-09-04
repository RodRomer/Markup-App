// Opening a project on the staff page showed "not linked" however many times
// the number had been set. Nothing was broken in the saving or the reading: the
// panel asked the loaded project for `projectNumber`, and the endpoint's
// mapper simply never put one in. TypeScript could not help, because the
// response is parsed straight out of `res.json()` and so is `any`.
//
// That is a whole class of silent bug rather than one field, so the check below
// is against the class: every field the detail panel reads off a loaded project
// must be one the mapper actually sends.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { toProjectData } from "../src/lib/types.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Bay Area Fit-out",
  projectNumber: "3524_BA",
  shareToken: "tok",
  status: "sent",
  allowIE: true,
  allowSection: true,
  pricePerIE: 40,
  documents: [],
  ...over,
});

test("the number a project was given survives the trip to the client", () => {
  assert.equal(toProjectData(project()).projectNumber, "3524_BA");
  // Null is the honest answer for everything made before the field existed,
  // and has to stay distinguishable from "" -- one is unlinked, the other is
  // a link to nothing.
  assert.equal(toProjectData(project({ projectNumber: null })).projectNumber, null);
});

test("the detail panel reads no field the detail endpoint fails to send", () => {
  const console = read("src/components/StaffConsole.tsx");
  const route = read("src/app/api/projects/[id]/route.ts");
  const types = read("src/lib/types.ts");

  // The premise: the panel is fed by that route, and that route answers with
  // this mapper. If either stops being true the check below proves nothing.
  assert.ok(
    /const res = await call\("\/api\/projects\/" \+ project\.id\);/.test(console),
    "the detail panel no longer loads from /api/projects/<id>"
  );
  assert.ok(route.includes("toProjectData("), "the detail route no longer answers with toProjectData");

  // What the mapper returns, taken from the return statement rather than the
  // type, because the type is what was already right when this broke.
  const returned = types.slice(types.lastIndexOf("return {"));
  const sent = new Set(
    [...returned.matchAll(/^\s{4}(\w+)[,:]/gm)].map((m) => m[1])
  );
  assert.ok(sent.has("projectNumber") && sent.has("pages"), "the mapper's fields did not parse");

  const asked = new Set(
    [...console.matchAll(/\b(?:loaded|detail)\.(\w+)/g)].map((m) => m[1])
  );
  const missing = [...asked].filter((field) => !sent.has(field));
  assert.deepEqual(
    missing,
    [],
    `the detail panel reads ${missing.join(", ")}, which toProjectData does not send`
  );
});
