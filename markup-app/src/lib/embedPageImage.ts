import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFPage,
  PDFRawStream,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";

/**
 * Putting a page image into the exported PDF.
 *
 * pdf-lib's embedPng is pure JavaScript on both halves: it inflates the PNG
 * with its own decoder and deflates the pixels again with pako when the
 * document is saved. On a 36x24in sheet at the 200 DPI these are stored at,
 * that is 7200x4800 -- 104 MB of pixels through JS twice, measured at 1297 ms
 * for one page. A six-page set spent eight seconds doing it before a byte
 * reached the browser, on both Waystone and the staff page, because both ask
 * the same route for the same file.
 *
 * None of that work is necessary. A PNG's image data is already deflated, and
 * its per-row filters are exactly PDF's Predictor 15 -- the PDF format took
 * them from PNG. So for the PNGs that qualify the compressed bytes can be
 * copied into the page verbatim: no decode, no re-encode, and the same pixels
 * out the far end. Measured on the same sheet: 2 ms, and the PDF came out
 * 0.61 MB instead of 1.96 MB, because pako's deflate is worse than the one
 * that wrote the PNG in the first place.
 *
 * Not every PNG qualifies. Interlaced ones are stored in a different order,
 * 16-bit and palette images describe their pixels differently, and one with an
 * alpha channel interleaves data PDF wants in a separate stream. Those fall
 * back to what this always did, which is correct but slow. Waystone's own
 * rasterizer writes 8-bit non-interlaced RGB, so the projects it creates take
 * the fast path.
 */

export type PngHeader = {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
  /** Every IDAT chunk's payload, joined -- the deflate stream, still compressed. */
  data: Uint8Array;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG colour types this can hand to PDF unchanged, and what PDF calls them. */
const PASSABLE_COLOR_TYPES: Record<number, { space: string; colors: number }> = {
  0: { space: "DeviceGray", colors: 1 },
  2: { space: "DeviceRGB", colors: 3 },
};

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Read a PNG's header and collect its image data, without decompressing any of it. */
export function parsePng(bytes: Uint8Array): PngHeader | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let offset = 8;
  let header: Omit<PngHeader, "data"> | null = null;
  const chunks: Uint8Array[] = [];
  // 12 bytes of frame per chunk: length, type and CRC.
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length < length) return null;

    if (type === "IHDR") {
      if (length < 13) return null;
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      header = {
        width: h.getUint32(0),
        height: h.getUint32(4),
        bitDepth: body[8],
        colorType: body[9],
        compression: body[10],
        filter: body[11],
        interlace: body[12],
      };
    } else if (type === "IDAT") {
      chunks.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (!header || chunks.length === 0) return null;
  return { ...header, data: concat(chunks) };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

/**
 * Whether this PNG's bytes describe pixels the same way a PDF image stream does.
 *
 * Compression 0 and filter 0 are the only values the PNG format defines, so
 * anything else is a file from the future or a broken one -- either way, not
 * something to hand to a PDF reader uninspected.
 */
export function canPassThrough(png: PngHeader | null): png is PngHeader {
  return (
    png !== null &&
    png.compression === 0 &&
    png.filter === 0 &&
    png.interlace === 0 &&
    png.bitDepth === 8 &&
    png.colorType in PASSABLE_COLOR_TYPES
  );
}

export type EmbedRoute = "passthrough" | "jpeg" | "decoded";

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Draw one page image, by whichever route it qualifies for.
 *
 * Returns which one was taken, so the choice can be asserted rather than
 * inferred from a stopwatch.
 */
export async function embedPageImage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  bytes: Uint8Array,
  box: Box
): Promise<EmbedRoute> {
  if (isJpeg(bytes)) {
    // Already free: a JPEG goes into a PDF as its own bytes under DCTDecode,
    // so pdf-lib copies rather than decodes.
    page.drawImage(await pdfDoc.embedJpg(bytes), box);
    return "jpeg";
  }

  const png = parsePng(bytes);
  if (canPassThrough(png)) {
    const { space, colors } = PASSABLE_COLOR_TYPES[png.colorType];
    const stream = PDFRawStream.of(
      pdfDoc.context.obj({
        Type: "XObject",
        Subtype: "Image",
        Width: png.width,
        Height: png.height,
        ColorSpace: space,
        BitsPerComponent: png.bitDepth,
        Filter: "FlateDecode",
        // Predictor 15 means "each row says which PNG filter it used", which is
        // what the bytes being handed over already say.
        DecodeParms: {
          Predictor: 15,
          Colors: colors,
          BitsPerComponent: png.bitDepth,
          Columns: png.width,
        },
      }),
      png.data
    );
    const name = page.node.newXObject("Image", pdfDoc.context.register(stream));
    // The same four operators drawImage emits: place the unit square where the
    // image goes, draw it, and leave the graphics state as it was found.
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(box.width, 0, 0, box.height, box.x, box.y),
      drawObject(name),
      popGraphicsState()
    );
    return "passthrough";
  }

  page.drawImage(await pdfDoc.embedPng(bytes), box);
  return "decoded";
}
