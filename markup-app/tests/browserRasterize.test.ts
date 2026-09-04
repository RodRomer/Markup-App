// A project made from the staff page and one made from Waystone have to be the
// same project. The two rasterizers are separate implementations in separate
// languages -- pdf.js here, PyMuPDF there -- and nothing connects them but two
// numbers. If they drift, a set exports at a different size or shows paler
// depending on which machine happened to make it, and neither one looks wrong
// on its own.
//
// The rendering itself needs a canvas and cannot run here. These are the parts
// that can: the numbers, and the naming.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Read from pageSize rather than from the rasterizer that re-exports them:
// the rasterizer loads pdf.js, and this only needs the two numbers.
import { DISPLAY_MAX_WIDTH, RASTER_DPI } from "../src/lib/pageSize.ts";
import { safeStem } from "../src/lib/blobKeys.ts";

const REPO = path.resolve(import.meta.dirname, "..");

test("the browser renders at the same two numbers Waystone does", () => {
  // Pinned rather than derived, because the other half of this pair lives in
  // another repository and cannot be imported. Changing either without the
  // other is the failure; this makes it a deliberate act instead of a typo.
  assert.equal(RASTER_DPI, 200, "200 DPI is what makes the export plottable at size");
  assert.equal(DISPLAY_MAX_WIDTH, 2400, "2400 is what stops the editor washing plans out");
});

test("uploading a page cannot happen without a team", () => {
  // This is the one route that grants write access to storage. Open, it would
  // let anyone fill the blob store; guarded by the admin key it would be a
  // second credential doing day-to-day work.
  const route = readFileSync(path.join(REPO, "src/app/api/blob-upload/route.ts"), "utf8");
  assert.ok(route.includes("requireTeam("), "the upload route no longer establishes a team");
  assert.equal(route.includes("requireStaff("), false,
    "the upload route is guarded by the admin key rather than a team");
  assert.match(route, /allowedContentTypes: \["image\/png"\]/,
    "the upload token no longer restricts what can be written");
});

test("a plan's filename does not decide what a storage path looks like", () => {
  assert.equal(safeStem("2830 Lawton St. (rev B).pdf"), "2830-lawton-st-rev-b");
  assert.equal(safeStem("plans.pdf"), "plans");
  // A backslash written into this file directly does not survive being
  // written; built from its code point so the test means what it says.
  const BACKSLASH = String.fromCharCode(92);
  assert.equal(safeStem("A/B" + BACKSLASH + "C.pdf"), "a-b-c",
               "separators must not survive into a key");
  assert.equal(safeStem("../../etc/passwd.pdf"), "etc-passwd", "no traversal out of the store");
  assert.equal(safeStem(".pdf"), "plan", "a name that reduces to nothing still needs a key");
  assert.equal(safeStem("____.pdf"), "plan");
});
