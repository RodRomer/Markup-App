import * as pdfjs from "pdfjs-dist";

import { DISPLAY_MAX_WIDTH, RASTER_DPI } from "./pageSize";

/**
 * Turning a site plan into the page images the app stores, in the browser.
 *
 * The mirror of Waystone's markup_app/rasterize.py, which does the same job
 * with PyMuPDF. Two renders per page and the same two numbers, because a
 * project created from the staff page has to be indistinguishable from one
 * created from Waystone -- a set that exports at a different size, or shows
 * paler on screen, depending on which machine made it would be its own bug.
 */

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Re-exported so this file still reads as the one place a rasterizer's
// numbers are stated, while there is only one copy of each.
export { DISPLAY_MAX_WIDTH, RASTER_DPI };

const IMAGE_TYPES = ["image/png", "image/jpeg"];

export type RenderedPage = {
  full: Blob;
  width: number;
  height: number;
  display: Blob | null;
  displayWidth: number | null;
  displayHeight: number | null;
};

export class RasterizeError extends Error {}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new RasterizeError("The browser could not encode a page."))),
      "image/png"
    );
  });
}

/** A canvas of exactly this size, painted white.
 *
 *  White first because a PDF page has no background of its own: left
 *  transparent, a plan would pick up whatever is behind it and the PNG would
 *  not match what Waystone produces. */
function blankCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RasterizeError("This browser would not give a 2D canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Let go of the pixels straight away.
 *
 *  A 7200x4800 canvas is 138 MB. Held across a six-page set that is most of a
 *  gigabyte, and the tab is killed part-way through with nothing to show for
 *  it -- so each one is released as soon as its PNG exists. */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

async function renderPdf(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<RenderedPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    throw new RasterizeError(
      `Couldn't open '${file.name}' as a PDF: ${err instanceof Error ? err.message : err}`
    );
  }

  if (doc.numPages === 0) throw new RasterizeError(`'${file.name}' has no pages.`);

  const pages: RenderedPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);

    const viewport = page.getViewport({ scale: RASTER_DPI / 72 });
    const canvas = blankCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const full = await toBlob(canvas);
    const { width, height } = canvas;
    release(canvas);

    // Rendered again rather than scaled down from the one above: scaling is the
    // thing being avoided, and re-rendering costs a fraction of the first pass.
    let display: Blob | null = null;
    let displaySize: { width: number; height: number } | null = null;
    const inches = viewport.width / (RASTER_DPI / 72) / 72;
    const displayDpi = inches > 0 ? DISPLAY_MAX_WIDTH / inches : RASTER_DPI;
    if (displayDpi < RASTER_DPI) {
      const small = page.getViewport({ scale: displayDpi / 72 });
      const smallCanvas = blankCanvas(small.width, small.height);
      await page.render({
        canvas: smallCanvas,
        canvasContext: smallCanvas.getContext("2d")!,
        viewport: small,
      }).promise;
      display = await toBlob(smallCanvas);
      displaySize = { width: smallCanvas.width, height: smallCanvas.height };
      release(smallCanvas);
    }

    page.cleanup();
    pages.push({
      full,
      width,
      height,
      display,
      displayWidth: displaySize?.width ?? null,
      displayHeight: displaySize?.height ?? null,
    });
    onProgress?.(n, doc.numPages);
  }

  // Releases the worker as well as the document.
  await task.destroy();
  return pages;
}

async function renderImage(file: File): Promise<RenderedPage[]> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new RasterizeError(`'${file.name}' isn't a readable image.`);
  });

  // An image has no vector to re-render from, so the smaller copy is a
  // downscale. Still worth making: a good downscale keeps far more of the
  // drawing than the browser's own shrink-to-fit does.
  let display: Blob | null = null;
  let displaySize: { width: number; height: number } | null = null;
  if (bitmap.width > DISPLAY_MAX_WIDTH) {
    const height = Math.round((bitmap.height * DISPLAY_MAX_WIDTH) / bitmap.width);
    const canvas = blankCanvas(DISPLAY_MAX_WIDTH, height);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, DISPLAY_MAX_WIDTH, height);
    display = await toBlob(canvas);
    displaySize = { width: canvas.width, height: canvas.height };
    release(canvas);
  }

  const { width, height } = bitmap;
  bitmap.close();

  // The original bytes, unre-encoded: the server does not re-encode an uploaded
  // image either, and a round trip through canvas would only lose something.
  return [{
    full: file,
    width,
    height,
    display,
    displayWidth: displaySize?.width ?? null,
    displayHeight: displaySize?.height ?? null,
  }];
}

export async function renderPages(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<{ kind: "pdf" | "image"; pages: RenderedPage[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return { kind: "pdf", pages: await renderPdf(file, onProgress) };
  }
  if (IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g)$/.test(name)) {
    return { kind: "image", pages: await renderImage(file) };
  }
  throw new RasterizeError("Choose a PDF, PNG or JPG.");
}
