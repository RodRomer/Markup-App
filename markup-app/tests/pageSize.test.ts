// A page is stored as a pixel count and printed in points. Nothing in the
// stored row says which it is, and handing one straight to the other is what
// made every exported sheet 100 inches wide -- wider than any plotter, so the
// only way to print it was "fit to page", and nothing on it could be measured.
//
// These are stated in inches rather than in points, because inches are the
// thing that was wrong.
import assert from "node:assert/strict";
import test from "node:test";

import { DISPLAY_MAX_WIDTH, POINTS_PER_INCH, RASTER_DPI, pointsFromPixels } from "../src/lib/pageSize.ts";

const inches = (px: number) => pointsFromPixels(px) / POINTS_PER_INCH;

test("an ARCH D sheet comes out as an ARCH D sheet", () => {
  // 36 x 24 in at 200 DPI is 7200 x 4800 px, which is what every live page is.
  assert.equal(inches(7200), 36);
  assert.equal(inches(4800), 24);
  // And in points, which is what addPage is given.
  assert.equal(pointsFromPixels(7200), 2592);
  assert.equal(pointsFromPixels(4800), 1728);
});

test("the sheet is no longer a hundred inches wide", () => {
  // What it used to do: hand the pixel count over and let it be read as points.
  assert.equal(7200 / POINTS_PER_INCH, 100);
  assert.notEqual(inches(7200), 100);
  // The whole error, in one number.
  assert.equal(pointsFromPixels(7200) / 7200, POINTS_PER_INCH / RASTER_DPI);
});

test("other real sheet sizes survive the trip", () => {
  for (const [w, h, label] of [[1700, 2200, "ARCH B at 200"], [6800, 4400, "ARCH E"]] as const) {
    assert.equal(inches(w), w / RASTER_DPI, label);
    assert.equal(inches(h), h / RASTER_DPI, label);
  }
});

test("the conversion is proportional, which is why the markers survive it", () => {
  // Every marker is a fraction of page width, so if this is not proportional
  // the markers move relative to the drawing rather than scaling with it.
  const page = pointsFromPixels(7200);
  const marker = pointsFromPixels(7200 * 0.008);
  assert.ok(Math.abs(marker / page - 0.008) < 1e-12,
            "a marker is no longer the same fraction of the sheet");
});

test("zero and negatives do not produce a nonsense page", () => {
  assert.equal(pointsFromPixels(0), 0);
  // Not reachable from a real page, but a negative page size is the kind of
  // thing pdf-lib accepts and renders as nothing at all.
  assert.ok(pointsFromPixels(-100) < 0, "sign is not preserved");
});

test("the two numbers both rasterizers depend on are pinned here", () => {
  // Waystone's rasterize.py renders at RASTER_DPI too and cannot import this.
  // Changing one without the other has to be deliberate.
  assert.equal(RASTER_DPI, 200);
  assert.equal(DISPLAY_MAX_WIDTH, 2400);
  assert.equal(POINTS_PER_INCH, 72);
});
