// The exported PDF has to put a marker where the browser drew it.
//
// Both renderers call markerGeometry, but separately and in different
// coordinate systems: the editor draws into an SVG viewBox of "0 0 W H" with y
// down, the export into a PDF page of W x H points with y up. A marker drawn
// somewhere else in the export is still a perfectly plausible marker -- the
// client sees one thing, the drafter reads another, and nothing says so.
//
// So this runs the real generateProjectPdf with pdf-lib's page replaced by a
// recorder, and compares every drawn coordinate against what the editor's own
// formulas produce for the same marker.
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

// A 2x2 PNG. generateProjectPdf embeds the page image before drawing markers.
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

function toPath(points: { x: number; y: number }[]) {
  const [first, ...rest] = points;
  return "M " + first.x + " " + first.y + " " +
    rest.map((p) => "L " + p.x + " " + p.y).join(" ") + " Z";
}

// The page as it is stored: a pixel count.
const W = 1700;
const H = 2200;
// The page as it is printed. The export works in points now -- a stored pixel
// count handed to addPage came out as a 100-inch sheet -- and every formula on
// both sides is width times a factor, so feeding the editor's the printed width
// yields the printed geometry and the comparison still means what it meant.
const PW = pointsFromPixels(W);
const PH = pointsFromPixels(H);
const IE = { id: "m1", pageId: "p1", type: "IE", x: 0.25, y: 0.4, x2: null, y2: null,
             label: "IE 1", note: null, boxWidth: null, flipped: false,
             // 217 on purpose: an axis-aligned set would survive a swapped
             // sign or a transposed axis without anyone noticing.
             directions: [0, 90, 217] };
const SECTION = { id: "m2", pageId: "p1", type: "SECTION", x: 0.6, y: 0.2, x2: 0.8, y2: 0.55,
                  label: "Section 1", note: null, boxWidth: null, flipped: true, directions: [] };

/** Runs the real export in a scratch copy of src/lib, recording every draw. */
async function recordAnExport() {
  // Inside the repo, not %TEMP%: Node resolves "pdf-lib" by walking up from the
  // importing file, and nothing above %TEMP% has a node_modules.
  const work = mkdtempSync(path.join(REPO, ".geom-"));
  const cwd = process.cwd();
  const calls: { fn: string; args: unknown[] }[] = [];
  try {
    mkdirSync(path.join(work, "lib"), { recursive: true });
    writeFileSync(path.join(work, "lib", "shim.ts"), SHIM, "utf8");
    for (const f of ["exportPdf.ts", "embedPageImage.ts", "markerGeometry.ts", "markerTypes.ts",
                     "types.ts", "money.ts", "pageSize.ts"]) {
      let text = readFileSync(path.join(LIB, f), "utf8");
      const before = text;
      // Node's resolver wants the extension on a relative .ts import; the
      // bundler does not.
      text = text.replace(/from "\.\/([A-Za-z0-9_]+)"/g, 'from "./$1.ts"');
      text = text.replace(/from "@\/lib\/([A-Za-z0-9_]+)"/g, 'from "./$1.ts"');
      if (f === "exportPdf.ts") {
        text = text.replace('from "pdf-lib"', 'from "./shim.ts"');
        assert.notEqual(text, before, "nothing was rewritten in exportPdf.ts");
        assert.ok(text.includes('from "./shim.ts"'), "pdf-lib was not shimmed");
      }
      writeFileSync(path.join(work, "lib", f), text, "utf8");
    }

    (globalThis as Record<string, unknown>).__calls = calls;
    const geom = await import(pathToFileURL(path.join(work, "lib", "markerGeometry.ts")).href);
    const mod = await import(pathToFileURL(path.join(work, "lib", "exportPdf.ts")).href);

    mkdirSync(path.join(work, "public"), { recursive: true });
    writeFileSync(path.join(work, "public", "page.png"), PNG);
    process.chdir(work);

    await mod.generateProjectPdf({
      name: "geometry", status: "submitted", pricePerIE: null,
      pages: [{ id: "p1", pageNumber: 1, imagePath: "page.png", width: W, height: H,
                markers: [IE, SECTION] }],
    });
    assert.ok(calls.some((c) => c.fn === "drawSvgPath"), "nothing was recorded -- the shim did not take");
    return { calls, geom };
  } finally {
    process.chdir(cwd);
    rmSync(work, { recursive: true, force: true });
  }
}

test("the export draws each marker where the editor computes it", async () => {
  // The editor's formulas, transcribed and then pinned to its source: if it
  // changes how it sizes or places a marker, this fails rather than quietly
  // comparing against a formula the app no longer uses.
  const editorSrc = readFileSync(EDITOR, "utf8");
  for (const pin of [
    "const size = activePage.width * 0.008 * markerScale;",
    "const flagSize = activePage.width * 0.01 * markerScale;",
    "arrowWedgePoints(cx, cy, angle, size)",
    "const markerScale = 1 / Math.min(2.5, Math.max(0.7, zoom));",
  ]) {
    assert.ok(editorSrc.includes(pin), `the editor no longer contains: ${pin}`);
  }

  const { calls, geom } = await recordAnExport();

  // markerScale compensates for zoom on screen and has no meaning in a PDF;
  // at zoom 1 it is 1, which is the only place the two can be compared.
  const markerScale = 1 / Math.min(2.5, Math.max(0.7, 1));
  assert.equal(markerScale, 1);
  const size = PW * 0.008 * markerScale;
  const flagSize = PW * 0.01 * markerScale;

  const expected = [
    ...IE.directions.map((angle) => ({
      what: `IE wedge ${angle}deg`,
      path: toPath(geom.arrowWedgePoints(IE.x * PW, IE.y * PH, angle, size)),
    })),
    ...(["start", "end"] as const).map((endpoint) => ({
      what: `section flag ${endpoint}`,
      path: toPath(geom.sectionFlagPolygonPoints(
        SECTION.x * PW, SECTION.y * PH, SECTION.x2 * PW, SECTION.y2 * PH,
        endpoint, SECTION.flipped, flagSize)),
    })),
  ];

  const drawn = calls.filter((c) => c.fn === "drawSvgPath");
  // The sheet itself, at printable size rather than at its pixel count.
  assert.deepEqual((calls.find((c) => c.fn === "addPage")?.args ?? [])[0], [PW, PH]);

  for (const want of expected) {
    const hit = drawn.find((c) => c.args[0] === want.path);
    assert.ok(hit, `${want.what} is not drawn where the editor puts it`);
    // The only transform allowed: pdf-lib's drawSvgPath reads y as increasing
    // downward from this origin, which mirrors the whole shape about the page
    // height -- exactly what flipY does for the dots and lines. Only x and y
    // are the transform; the same object also carries the colours.
    const origin = hit.args[1] as { x: number; y: number };
    assert.equal(origin.x, 0, `${want.what} was drawn from a different origin`);
    assert.equal(origin.y, PH, `${want.what} was drawn from a different origin`);
  }

  const dot = calls.find((c) => c.fn === "drawEllipse")?.args[0] as { x: number; y: number };
  assert.equal(dot.x, IE.x * PW);
  assert.equal(dot.y, PH - IE.y * PH, "the IE dot is not the mirror of where the editor draws it");
});

test("neither renderer keeps its own copy of a shared constant", async () => {
  // Both files used to declare MARKER_LINE_FACTOR and REVISION_TEXT_WIDTH, with
  // a comment in the export saying it matched the editor -- an agreement kept by
  // hand that nothing checked. A drift would not announce itself: a line drawn
  // at one weight on screen and another in the PDF still looks like a line.
  const geometry = readFileSync(path.join(LIB, "markerGeometry.ts"), "utf8");
  for (const name of ["MARKER_LINE_FACTOR", "REVISION_TEXT_WIDTH"]) {
    assert.ok(geometry.includes(`export const ${name} =`), `${name} should live in markerGeometry`);
    for (const file of [EDITOR, path.join(LIB, "exportPdf.ts")]) {
      const text = readFileSync(file, "utf8");
      assert.ok(text.includes(name), `${path.basename(file)} should still use ${name}`);
      assert.ok(!text.includes(`const ${name} =`),
                `${path.basename(file)} declares its own ${name} again`);
    }
  }
});
