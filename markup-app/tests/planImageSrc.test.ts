// A page is stored twice: the 200 DPI original the PDF export needs, and a
// display render the editor shows. Picking the wrong one is invisible either
// way -- both are the same drawing, and the only difference is whether the
// linework survives. Showing the original at fit is what washed plans out;
// showing the display render zoomed right in would be soft where it used to be
// sharp. Neither looks like a bug, which is why this is worth pinning down.
import assert from "node:assert/strict";
import test from "node:test";

import { planImageSrc } from "../src/lib/markerTypes.ts";

const FULL = "https://blob/page-0.png";
const DISPLAY = "https://blob/page-0-display.png";

const page = { imagePath: FULL, displayPath: DISPLAY, displayWidth: 2400 };

test("at fit, the display render is what gets shown", () => {
  // A 36-inch sheet fitted into ~1200 CSS px. This is the case that was washing
  // out: 7200px averaged down to 1200 loses 85% of the ink.
  assert.equal(planImageSrc(page, 1200, 1, 1), DISPLAY);
  assert.equal(planImageSrc(page, 1200, 1, 2), DISPLAY, "retina at fit still fits in 2400");
});

test("zoomed past its resolution, the full-size original takes over", () => {
  // Beyond 2400 device pixels the display render is being enlarged, and the
  // original genuinely has more to show.
  assert.equal(planImageSrc(page, 1200, 4, 1), FULL);
  assert.equal(planImageSrc(page, 1200, 2.01, 2), FULL, "retina crosses over at half the zoom");
});

test("the crossover is where the display render runs out, not a guessed zoom", () => {
  // Exactly its own width is still the display render: at 1:1 it has a real
  // pixel for every device pixel and nothing is being invented.
  assert.equal(planImageSrc(page, 2400, 1, 1), DISPLAY, "1:1 should still be the display render");
  assert.equal(planImageSrc(page, 2401, 1, 1), FULL, "one pixel past 1:1 should switch");
});

test("a retina screen crosses over at half the zoom a 1x screen does", () => {
  // The comparison is in device pixels on purpose. Doing it in CSS pixels would
  // leave every retina client looking at an upscaled image and calling it blurry.
  assert.equal(planImageSrc(page, 1500, 1, 1), DISPLAY);
  assert.equal(planImageSrc(page, 1500, 1, 2), FULL, "3000 device pixels exceeds 2400");
});

test("a page with no display render just uses the original", () => {
  // Everything uploaded before this existed, and any page small enough that a
  // second copy would be the same picture twice.
  const old = { imagePath: FULL, displayPath: null, displayWidth: null };
  assert.equal(planImageSrc(old, 1200, 1, 1), FULL);
  assert.equal(planImageSrc(old, 1200, 8, 2), FULL);
  assert.equal(planImageSrc({ imagePath: FULL }, 1200, 1, 1), FULL, "absent fields, not just null");
});

test("a half-stored display render is not trusted", () => {
  // A path with no width cannot be compared against anything, so it must fall
  // back rather than be shown at whatever size happens to be asked for.
  assert.equal(planImageSrc({ imagePath: FULL, displayPath: DISPLAY }, 1200, 1, 1), FULL);
  assert.equal(planImageSrc({ imagePath: FULL, displayWidth: 2400 }, 1200, 1, 1), FULL);
});

test("no page at all is not an image", () => {
  assert.equal(planImageSrc(null, 1200, 1, 1), undefined);
  assert.equal(planImageSrc(undefined, 1200, 1, 1), undefined);
});

test("a missing devicePixelRatio counts as 1 rather than as zero", () => {
  // window.devicePixelRatio is undefined on the server and 0 in some headless
  // contexts. Zero would make every comparison 0 > 2400 and pin the editor to
  // the display render at every zoom.
  assert.equal(planImageSrc(page, 1200, 4, 0), FULL, "a zero ratio must not disable the swap");
  assert.equal(planImageSrc(page, 1200, 4), FULL, "an omitted ratio must not either");
});
