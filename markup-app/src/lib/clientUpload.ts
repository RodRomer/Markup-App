// Client-only helpers: rasterize PDF pages to PNGs and read image dimensions,
// all in the browser so the server never needs to parse PDFs itself.

// PDF user space is 72 units/inch, so this scale is equivalent to rendering
// at 200 DPI — a bigger physical sheet rasterizes to proportionally more
// pixels instead of every page being squeezed to the same target width.
const RASTER_DPI = 200;
const PDF_SCALE = RASTER_DPI / 72;

export type RasterizedPage = { blob: Blob; width: number; height: number };

export async function rasterizePdf(file: File): Promise<RasterizedPage[]> {
  // Loaded dynamically: pdfjs-dist touches browser-only globals (DOMMatrix, etc.)
  // at module-evaluation time, which breaks Next.js's server-side prerendering
  // of pages that import this module if pulled in statically.
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: RasterizedPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_SCALE });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas rendering is not supported in this browser");

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to encode rendered page"))),
        "image/png"
      )
    );
    pages.push({ blob, width: canvas.width, height: canvas.height });
  }

  return pages;
}

export function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
