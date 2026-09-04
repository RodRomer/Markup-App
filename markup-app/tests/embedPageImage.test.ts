// A page image goes into the exported PDF by one of three routes, and the fast
// one hands a PDF reader bytes this code never looked inside. That is only safe
// because PDF's Predictor 15 is PNG's own row filtering -- so the tests below
// are mostly about the header that says so. Get Columns or Colors wrong and the
// reader walks the rows at the wrong stride: no error, just a smeared plan.
//
// The route taken is returned rather than timed, because "which path did it
// take" is the thing that has to hold. A stopwatch would pass on a fast machine
// whatever the code did.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";

import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import { canPassThrough, embedPageImage, isJpeg, parsePng } from "../src/lib/embedPageImage.ts";

const REPO = path.resolve(import.meta.dirname, "..");

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, check]);
}

/** A real, valid PNG -- built here so a test can ask for one PDF cannot take. */
function makePng({
  width = 4,
  height = 3,
  colorType = 2,
  bitDepth = 8,
  interlace = 0,
  idatChunks = 1,
} = {}): Buffer {
  const samples: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const stride = (width * (samples[colorType] ?? 3) * bitDepth) / 8;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride + 1);
    row[0] = 0; // filter: none
    for (let i = 1; i < row.length; i++) row[i] = (y * 40 + i * 7) % 256;
    rows.push(row);
  }
  const compressed = deflateSync(Buffer.concat(rows));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;

  // Split across several IDATs when asked: a real encoder does this on any
  // sizeable image, and a reader that took only the first would put a fraction
  // of a page on the sheet.
  const size = Math.ceil(compressed.length / idatChunks);
  const idats: Buffer[] = [];
  for (let at = 0; at < compressed.length; at += size) {
    idats.push(chunk("IDAT", compressed.subarray(at, at + size)));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...idats,
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function embed(bytes: Buffer) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 80]);
  const route = await embedPageImage(doc, page, bytes, { x: 0, y: 0, width: 100, height: 80 });
  return { doc, page, route };
}

type Page = Awaited<ReturnType<typeof embed>>["page"];

/** The image stream this page draws, as the PDF holds it. */
function imageStream(doc: PDFDocument, page: Page) {
  const xobjects = page.node.Resources()!.lookup(PDFName.of("XObject")) as never as {
    keys(): PDFName[];
    get(name: PDFName): never;
  };
  const [name] = xobjects.keys();
  const stream = doc.context.lookup(xobjects.get(name));
  assert.ok(stream instanceof PDFRawStream, "the page image is not a raw stream");
  return stream;
}

function numberAt(dict: { lookup(name: PDFName): unknown }, key: string): number {
  return (dict.lookup(PDFName.of(key)) as { asNumber(): number }).asNumber();
}

test("an ordinary RGB page goes through untouched, bytes and all", async () => {
  const bytes = makePng();
  const { doc, page, route } = await embed(bytes);
  assert.equal(route, "passthrough");

  // The whole claim: what the PDF carries is what the PNG carried. Not
  // equivalent pixels -- the same compressed bytes.
  const stream = imageStream(doc, page);
  assert.deepEqual(Buffer.from(stream.contents), Buffer.from(parsePng(bytes)!.data));
});

test("the header tells the reader how to walk the rows it was handed", async () => {
  const { doc, page } = await embed(makePng({ width: 7, height: 5 }));
  const dict = imageStream(doc, page).dict;
  const parms = dict.lookup(PDFName.of("DecodeParms")) as { lookup(n: PDFName): unknown };

  assert.equal(numberAt(dict, "Width"), 7);
  assert.equal(numberAt(dict, "Height"), 5);
  assert.equal(numberAt(dict, "BitsPerComponent"), 8);
  assert.equal(String(dict.lookup(PDFName.of("ColorSpace"))), "/DeviceRGB");
  assert.equal(String(dict.lookup(PDFName.of("Filter"))), "/FlateDecode");
  // 15 is "every row names its own filter", which is exactly what a PNG's rows
  // do. Anything else here and the copied bytes mean something different.
  assert.equal(numberAt(parms, "Predictor"), 15);
  assert.equal(numberAt(parms, "Colors"), 3);
  assert.equal(numberAt(parms, "Columns"), 7, "the stride the reader steps by must be the image's own");
  assert.equal(numberAt(parms, "BitsPerComponent"), 8);
});

test("a greyscale page is passed through as grey, not as three channels", async () => {
  const { doc, page, route } = await embed(makePng({ colorType: 0 }));
  assert.equal(route, "passthrough");
  const dict = imageStream(doc, page).dict;
  assert.equal(String(dict.lookup(PDFName.of("ColorSpace"))), "/DeviceGray");
  const parms = dict.lookup(PDFName.of("DecodeParms")) as { lookup(n: PDFName): unknown };
  assert.equal(numberAt(parms, "Colors"), 1);
});

test("every IDAT is taken, not just the first", () => {
  const whole = parsePng(makePng({ width: 40, height: 40, idatChunks: 1 }))!;
  const split = parsePng(makePng({ width: 40, height: 40, idatChunks: 5 }))!;
  assert.deepEqual(Buffer.from(split.data), Buffer.from(whole.data));
});

// --- what must not take the fast path ---

test("a PNG that does not describe pixels PDF's way is decoded instead", () => {
  // Alpha interleaves a channel PDF keeps in a separate stream; interlacing
  // stores the rows in seven passes in a different order; 16-bit samples are a
  // different stride. Each would be silently wrong, so each falls back.
  const cases: [string, Buffer][] = [
    ["alpha", makePng({ colorType: 6 })],
    ["interlaced", makePng({ interlace: 1 })],
    ["16-bit", makePng({ bitDepth: 16 })],
  ];
  for (const [what, png] of cases) {
    assert.equal(canPassThrough(parsePng(png)), false, `${what} was passed through`);
  }
});

test("a browser-made page still exports, by the slow route", async () => {
  // canvas.toBlob writes RGBA, so projects created from the staff page take
  // this path. Slower, but it has to work -- and it is what this always did.
  const { route } = await embed(makePng({ colorType: 6 }));
  assert.equal(route, "decoded");
});

test("a JPEG is recognised and left to pdf-lib, which already copies it", () => {
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpeg(makePng()), false);
});

test("something that is not a PNG at all is not mistaken for one", () => {
  assert.equal(parsePng(Buffer.from("not a png at all, truly")), null);
  assert.equal(parsePng(Buffer.alloc(0)), null);
  // A header with no image data behind it is not something to hand over either.
  assert.equal(parsePng(makePng().subarray(0, 33)), null);
});

test("the exporter actually uses this", () => {
  const source = readFileSync(path.join(REPO, "src/lib/exportPdf.ts"), "utf8");
  assert.ok(source.includes("embedPageImage("), "the exporter no longer routes the page image");
  assert.equal(/embedPng\(/.test(source), false,
    "the exporter embeds a PNG directly again, which is the slow path this replaced");
});
