// The tool palette draws a miniature of each marker, and it kept drifting from
// the marker it places -- because it was drawn from a description of the real
// thing rather than from the real thing. Twice now: the revision icon ran its
// leader to the tip, so the line showed through the arrowhead, which is the
// exact bug the real callout had already fixed; and the section icon never got
// the black casing every other part of a marker carries.
//
// Both now come from the same geometry the markers use. These pin that: the
// behaviour of the shared function, and the fact that the icons call it instead
// of restating it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { MARKER_OUTLINE_RATIO, revisionLeader } from "../src/lib/markerGeometry.ts";

const REPO = path.resolve(import.meta.dirname, "..");
const BOX = { x: 100, y: 100, width: 80, height: 40 };
const TIP = { x: 20, y: 200 };
const ARROW = 12;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("the leader stops short of the tip, at the arrowhead's base", () => {
  const { end, arrow } = revisionLeader(TIP, BOX, ARROW);

  // This is the whole bug. A line drawn to the tip runs the length of the
  // arrowhead underneath it and shows around the sides.
  assert.ok(distance(end, TIP) > 0, "the leader still runs all the way to the tip");
  // cos(0.42) is how far back the barbs meet the axis; the line ends exactly there.
  assert.ok(Math.abs(distance(end, TIP) - ARROW * Math.cos(0.42)) < 1e-9,
            "the leader does not end at the arrowhead's base");
  // And the head itself still points at the thing.
  assert.deepEqual(arrow[0], TIP, "the arrowhead's tip moved off the point it marks");
});

test("the leader leaves the box at its edge, not its centre", () => {
  const { start } = revisionLeader(TIP, BOX, ARROW);
  const centre = { x: BOX.x + BOX.width / 2, y: BOX.y + BOX.height / 2 };

  assert.ok(distance(start, centre) > 0, "the leader starts at the box's centre");
  // On the boundary: one of the two coordinates sits exactly on an edge.
  const onVertical = Math.abs(Math.abs(start.x - centre.x) - BOX.width / 2) < 1e-9;
  const onHorizontal = Math.abs(Math.abs(start.y - centre.y) - BOX.height / 2) < 1e-9;
  assert.ok(onVertical || onHorizontal, `start ${JSON.stringify(start)} is not on the box edge`);
});

test("the arrowhead is a wedge, not a spike or a line", () => {
  const { arrow } = revisionLeader(TIP, BOX, ARROW);
  assert.equal(arrow.length, 3);
  const [tip, a, b] = arrow;
  assert.ok(distance(a, b) > 1, "the two barbs are on top of each other");
  assert.ok(Math.abs(distance(tip, a) - distance(tip, b)) < 1e-9, "the head is lopsided");
});

test("a tip inside the box does not produce a leader pointing backwards", () => {
  // Degenerate but reachable: a callout dragged over the thing it points at.
  const inside = { x: BOX.x + 10, y: BOX.y + 10 };
  const { start, end, arrow } = revisionLeader(inside, BOX, ARROW);
  for (const p of [start, end, ...arrow]) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y),
              `produced a non-finite point: ${JSON.stringify(p)}`);
  }
});

test("the icons draw from that geometry rather than restating it", () => {
  const editor = readFileSync(path.join(REPO, "src/components/MarkupEditor.tsx"), "utf8");
  const icon = editor.slice(
    editor.indexOf("function ToolIcon("),
    editor.indexOf("export default function MarkupEditor")
  );
  assert.ok(icon.length > 0, "could not find the tool icons");

  assert.ok(icon.includes("revisionLeader("),
    "the revision icon is drawing its own leader again");
  assert.ok(icon.includes("sectionFlagPolygonPoints("),
    "the section icon is drawing its own flags again");
  assert.ok(icon.includes("arrowWedgePoints("),
    "the IE icon is drawing its own wedges again");

  // Hand-written coordinates are how it drifted last time.
  assert.equal(/points="[\d.,\s]+"/.test(icon), false,
    "an icon has a literal points= list rather than computed geometry");
});

test("every icon is cased in black, like the marker it stands for", () => {
  const editor = readFileSync(path.join(REPO, "src/components/MarkupEditor.tsx"), "utf8");
  const icon = editor.slice(
    editor.indexOf("function ToolIcon("),
    editor.indexOf("export default function MarkupEditor")
  );

  // The section line was the one that never got this: a coloured line with
  // nothing under it, where the real marker draws black first.
  const casings = icon.match(/stroke="black" strokeWidth=\{ICON_CASING_W\}/g) ?? [];
  assert.ok(casings.length >= 3,
    `only ${casings.length} cased strokes among the icons; the section line and the ` +
    "revision leader and its box each need one");

  assert.ok(icon.includes("MARKER_OUTLINE_RATIO") || editor.includes("MARKER_OUTLINE_RATIO"),
    "the icons pick their outline weight independently of the markers");
});

test("the outline ratio is a real proportion", () => {
  assert.ok(MARKER_OUTLINE_RATIO > 0 && MARKER_OUTLINE_RATIO < 1,
            `an outline ${MARKER_OUTLINE_RATIO}x its line is not a casing`);
});

test("the leader is worked out in exactly one place", () => {
  // It used to live in three: the editor, the export, and the icon. All three
  // agreed on the day each was written, and the icon was still running its line
  // through the arrowhead long after the other two had stopped -- because a
  // copy does not get fixed when the thing it copied does.
  //
  // The tell is the arithmetic: the half-angle the barbs sweep back, and the
  // step back from the tip to the head's base.
  const files = [
    "src/components/MarkupEditor.tsx",
    "src/lib/exportPdf.ts",
    "src/lib/markerGeometry.ts",
  ];
  const restating = files.filter((f) => {
    if (f.endsWith("markerGeometry.ts")) return false;  // the one place it belongs
    const source = readFileSync(path.join(REPO, f), "utf8");
    return source.includes("0.42") || source.includes("headBack");
  });

  assert.deepEqual(restating, [],
    "these work the leader out themselves instead of calling revisionLeader");

  // And the control: the arithmetic really is where it should be, so the check
  // above cannot pass by the whole thing having been deleted.
  const geometry = readFileSync(path.join(REPO, "src/lib/markerGeometry.ts"), "utf8");
  assert.ok(geometry.includes("ARROW_HALF_ANGLE"), "the shared leader lost its half-angle");
  assert.ok(geometry.includes("headBack"), "the shared leader no longer steps back from the tip");
});
