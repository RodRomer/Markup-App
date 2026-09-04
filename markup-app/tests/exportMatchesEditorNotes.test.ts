// The revision callout is drawn twice: once as JSX in MarkupEditor and once
// with pdf-lib in exportPdf. Box, leader, arrowhead and every line of text are
// worked out separately on each side from the same handful of constants. A
// callout drawn a little wider, or with its text a line lower, is still a
// perfectly plausible callout -- the client reads one and the drafter reads
// another, and nothing says so.
//
// The wedges, flags and dot are compared in exportMatchesEditor.test.ts. This
// does the same for the note, and it cannot call the editor: the geometry lives
// in a run of const declarations inside JSX. So that run is lifted out of the
// file as text, checked to be the one expected, and evaluated.
import assert from "node:assert/strict";
import { pointsFromPixels } from "../src/lib/pageSize.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "..");
const LIB = path.join(REPO, "src/lib");
const EDITOR = path.join(REPO, "src/components/MarkupEditor.tsx");
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8//8/AzJgYkAD" +
  "IxcAABxlAoNMHXsUAAAAAElFTkSuQmCC", "base64");

const SHIM = [
  'import * as real from "pdf-lib";',
  "export const StandardFonts = real.StandardFonts;",
  "export const rgb = real.rgb;",
  "export const PDFDocument = {",
  "  create: async () => {",
  "    const doc = await real.PDFDocument.create();",
  "    const addPage = doc.addPage.bind(doc);",
  "    doc.addPage = (...a) => {",
  "      const page = addPage(...a);",
  "      globalThis.__calls.push({ fn: 'addPage', args: a });",
  "      return new Proxy(page, {",
  "        get(target, prop) {",
  "          const value = target[prop];",
  "          if (typeof value !== 'function') return value;",
  "          return (...args) => {",
  "            if (typeof prop === 'string' && prop.startsWith('draw')) {",
  "              globalThis.__calls.push({ fn: prop, args });",
  "            }",
  "            return value.apply(target, args);",
  "          };",
  "        },",
  "      });",
  "    };",
  "    return doc;",
  "  },",
  "};",
].join(NL);

// The page as stored, and as printed. The export works in points now; every
// formula on both sides is width times a factor, so running the editor's block
// at the printed width gives the printed geometry and the comparison is still
// between the two renderers rather than between two unit systems.
const W = 1700;
const H = 2200;
const PW = pointsFromPixels(W);
const PH = pointsFromPixels(H);

/** The editor's note geometry, lifted from the JSX and run. */
async function editorNoteGeometry(marker: Record<string, unknown>, lib: Record<string, unknown>) {
  const source = readFileSync(EDITOR, "utf8").split(CR + NL).join(NL);
  const START = "                const unit = activePage.width * 0.004;";
  const END = "                const arrowPoints = toSvgPoints(leader.arrow);";
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  assert.notEqual(from, -1, "the note block no longer starts where this expects");
  assert.notEqual(to, -1, "the note block no longer ends where this expects");
  assert.ok(to > from, "the note block's anchors are the wrong way round");
  const block = source.slice(from, to + END.length);
  for (const needle of ["revisionBoxPosition(m)", "wrapToWidth(", "const boxH =",
                        "revisionLeader(", "const arrowPoints ="]) {
    assert.ok(block.includes(needle), `the lifted block has no ${needle} -- wrong text`);
  }

  // Written out and imported rather than handed to new Function: the block
  // carries a type annotation ((t: string) => ...), which new Function cannot
  // parse and Node's loader strips for free.
  const module_ = [
    "export function compute(scope) {",
    "  const { activePage, m, revisionBoxPosition, helveticaWidth, wrapToWidth,",
    "          REVISION_TEXT_WIDTH, MARKER_TYPE_INFO, selectedMarkerId,",
    "          revisionLeader, toSvgPoints } = scope;",
    block,
    "  return { unit, tipX, tipY, bx, by, fontSize, pad, lines, lineH, boxW, boxH,",
    "           edgeX, edgeY, arrowPoints, lineEndX, lineEndY };",
    "}",
  ].join(NL);
  const dir = mkdtempSync(path.join(REPO, ".notes-lift-"));
  try {
    const file = path.join(dir, "block.ts");
    writeFileSync(file, module_, "utf8");
    const { compute } = await import(pathToFileURL(file).href);
    return compute({ activePage: { width: PW, height: PH }, m: marker, selectedMarkerId: null, ...lib });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The export, run for real with pdf-lib's page replaced by a recorder. */
async function recordAnExport(marker: Record<string, unknown>) {
  const work = mkdtempSync(path.join(REPO, ".notes-"));
  const cwd = process.cwd();
  const calls: { fn: string; args: unknown[] }[] = [];
  try {
    mkdirSync(path.join(work, "lib"), { recursive: true });
    writeFileSync(path.join(work, "lib", "shim.ts"), SHIM, "utf8");
    for (const f of ["exportPdf.ts", "markerGeometry.ts", "markerTypes.ts", "types.ts", "money.ts",
                     "pageSize.ts"]) {
      let text = readFileSync(path.join(LIB, f), "utf8");
      const before = text;
      text = text.replace(/from "\.\/([A-Za-z0-9_]+)"/g, 'from "./$1.ts"');
      text = text.replace(/from "@\/lib\/([A-Za-z0-9_]+)"/g, 'from "./$1.ts"');
      if (f === "exportPdf.ts") {
        text = text.replace('from "pdf-lib"', 'from "./shim.ts"');
        assert.notEqual(text, before, "nothing was rewritten in exportPdf.ts");
      }
      writeFileSync(path.join(work, "lib", f), text, "utf8");
    }
    (globalThis as Record<string, unknown>).__calls = calls;
    const geometry = await import(pathToFileURL(path.join(work, "lib", "markerGeometry.ts")).href);
    const types = await import(pathToFileURL(path.join(work, "lib", "markerTypes.ts")).href);
    const mod = await import(pathToFileURL(path.join(work, "lib", "exportPdf.ts")).href);

    mkdirSync(path.join(work, "public"), { recursive: true });
    writeFileSync(path.join(work, "public", "page.png"), PNG);
    process.chdir(work);
    await mod.generateProjectPdf({
      name: "notes", status: "submitted", pricePerIE: null,
      pages: [{ id: "p1", pageNumber: 1, imagePath: "page.png", width: W, height: H,
                kind: "image", markers: [marker] }],
    });
    // Only the sheet itself. generateProjectPdf goes on to add Letter-sized
    // notes and legend pages, whose own rectangles and text would otherwise be
    // counted as the callout's.
    const secondPage = calls.findIndex((c, i) => c.fn === "addPage" && i > 0);
    const sheet = secondPage === -1 ? calls : calls.slice(0, secondPage);
    assert.ok(sheet.some((c) => c.fn === "drawRectangle"), "no callout box was drawn");
    return { calls: sheet, lib: { ...geometry, ...types } };
  } finally {
    process.chdir(cwd);
    rmSync(work, { recursive: true, force: true });
  }
}

const NOTES: Record<string, Record<string, unknown>> = {
  "an auto-width note": {
    id: "n1", pageId: "p1", type: "NOTE", x: 0.3, y: 0.25, x2: 0.5, y2: 0.55,
    label: "Revision 1", boxWidth: null, flipped: false, directions: [],
    note: "Move the counter 300mm north and reroute the conduit behind it.",
  },
  "a widened note that wraps to several lines": {
    id: "n2", pageId: "p1", type: "NOTE", x: 0.7, y: 0.8, x2: 0.35, y2: 0.42,
    label: "Revision 2", boxWidth: 0.28, flipped: false, directions: [],
    note: "Client wants the whole millwork run rebuilt in oak, with the upper "
        + "shelves removed and the lighting relocated to the soffit above.",
  },
};

for (const [what, marker] of Object.entries(NOTES)) {
  test(`the export draws ${what} where the editor computes it`, async () => {
    const { calls, lib } = await recordAnExport(marker);
    const screen = await editorNoteGeometry(marker, lib);

    // The editor has to have produced something real, or every comparison
    // below is between two nothings.
    assert.ok(screen.boxW > 0 && screen.boxH > 0, `the editor computed no box: ${JSON.stringify(screen)}`);
    assert.ok(screen.lines.length >= 1, "the editor wrapped the note to no lines");
    if (what.includes("several lines")) {
      // Or the wrapping case is not testing wrapping.
      assert.ok(screen.lines.length > 1, `that note did not wrap: ${JSON.stringify(screen.lines)}`);
    }

    const flip = (y: number) => PH - y;

    // The box: drawn twice, filled then outlined, and both must be the same rect.
    const boxes = calls.filter((c) => c.fn === "drawRectangle")
      .map((c) => c.args[0] as Record<string, number>);
    assert.equal(boxes.length, 2, "the callout box should be a fill and an outline");
    for (const box of boxes) {
      assert.equal(box.x, screen.bx, "box x");
      assert.equal(box.y, flip(screen.by + screen.boxH), "box y");
      assert.equal(box.width, screen.boxW, "box width");
      assert.equal(box.height, screen.boxH, "box height");
    }

    // The leader, cased in black then drawn in colour: same two endpoints.
    const leaders = calls.filter((c) => c.fn === "drawLine")
      .map((c) => c.args[0] as { start: { x: number; y: number }; end: { x: number; y: number } });
    assert.equal(leaders.length, 2, "the leader should be cased then drawn");
    for (const leader of leaders) {
      assert.equal(leader.start.x, screen.edgeX, "leader start x");
      assert.equal(leader.start.y, flip(screen.edgeY), "leader start y");
      assert.equal(leader.end.x, screen.lineEndX, "leader end x");
      assert.equal(leader.end.y, flip(screen.lineEndY), "leader end y");
    }

    // The arrowhead: the editor builds "x,y x,y x,y", the export an SVG path
    // drawn from (0, pageHeight), which is the same mirror.
    const head = calls.find((c) => c.fn === "drawSvgPath");
    assert.ok(head, "no arrowhead was drawn");
    const headPoints = String(head.args[0]).replace(/[ML]\s*/g, "").replace(" Z", "").trim()
      .split(/\s+/).reduce<string[]>((pairs, part, i, all) => {
        if (i % 2 === 0) pairs.push(`${part},${all[i + 1]}`);
        return pairs;
      }, []).join(" ");
    assert.equal(headPoints, screen.arrowPoints, "the arrowhead is a different triangle");
    assert.deepEqual({ x: (head.args[1] as Record<string, number>).x,
                       y: (head.args[1] as Record<string, number>).y }, { x: 0, y: PH });

    // Every line of text, including the label, at the same baseline.
    const rows = [marker.label as string, ...screen.lines];
    const drawn = calls.filter((c) => c.fn === "drawText");
    assert.equal(drawn.length, rows.length,
                 `the export drew ${drawn.length} rows and the editor shows ${rows.length}`);
    rows.forEach((row, i) => {
      const [text, opts] = drawn[i].args as [string, Record<string, number>];
      assert.equal(text, row, `row ${i} reads differently`);
      assert.equal(opts.x, screen.bx + screen.pad, `row ${i} x`);
      assert.equal(opts.y, flip(screen.by + screen.pad + screen.lineH * i + screen.fontSize * 0.92),
                   `row ${i} baseline`);
      assert.equal(opts.size, screen.fontSize, `row ${i} font size`);
    });
  });
}

// Two separate things, once conflated here and worth keeping apart.
//
// The fill: the export paints the box white at 0.95 and so does the editor --
// on the rect *behind* the interactive one. That was already true, and a second
// fill on the rect in front would stack two translucent whites and make every
// callout quietly more opaque than the PDF's.
//
// The hit target: an SVG rect with fill="none" only takes a pointer along its
// stroke, so the callout could be grabbed by its 2px border and nowhere else.
// pointerEvents:"all" fixes that without painting anything.
test("the callout box is painted once, and grabbable everywhere", () => {
  const editor = readFileSync(path.join(REPO, "src/components/MarkupEditor.tsx"), "utf8");
  const exporter = readFileSync(path.join(REPO, "src/lib/exportPdf.ts"), "utf8");

  assert.match(exporter, /color: rgb\(1, 1, 1\),\s*opacity: 0\.95,/,
               "the export no longer fills the callout box white at 0.95");

  // Only the marker itself. The tool-palette icon draws the same callout at
  // icon size and carries the same fill on purpose, so counting the whole file
  // would always find two and this would never mean anything.
  const rendering = editor.slice(editor.indexOf("export default function MarkupEditor"));
  assert.ok(rendering.length > 0, "could not find the editor component");
  const fills = rendering.match(/fill="#ffffff"\s*fillOpacity=\{0\.95\}/g) ?? [];
  assert.equal(fills.length, 1,
    `the callout box is painted ${fills.length} times; it should be exactly once`);

  assert.match(editor, /pointerEvents: "all"/,
    "the callout box is back to being grabbable only along its border");
});
