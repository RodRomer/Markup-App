/**
 * How a stored page becomes a printable one.
 *
 * A page is stored as a pixel count, because that is what a rasterizer produces
 * and what an <img> needs. A PDF page is measured in points, 72 to the inch. The
 * two are not the same number and nothing in the stored row says which it is --
 * so the conversion lives here, once, with the resolution it depends on.
 */

/**
 * The resolution every page is rasterized at, in both rasterizers.
 *
 * Waystone's markup_app/rasterize.py and the browser's rasterizeInBrowser.ts
 * each render at this, and neither can import from the other -- one is Python
 * in another repository. Both pin it in a test for that reason: changing one
 * without the other has to be a deliberate act rather than a typo.
 */
export const RASTER_DPI = 200;

/**
 * The width of the second render each page carries, for the editor to show.
 *
 * Here rather than beside the rasterizer because it is a fact about a page, and
 * because a test that wants to pin it should not have to load pdf.js to read it.
 */
export const DISPLAY_MAX_WIDTH = 2400;

/** PDF user space. A point is 1/72 inch, by definition. */
export const POINTS_PER_INCH = 72;

/**
 * The size a stored page should be printed at.
 *
 * Without this the export handed pixel counts straight to addPage, which reads
 * them as points: a 36-inch ARCH D sheet rasterized to 7200px came out as a
 * 100-inch page, wider than any plotter, and nothing on it could be measured
 * because it could only ever be printed "fit to page".
 *
 * Every marker is a fraction of page width, so converting the page converts the
 * markers with it and nothing moves relative to the drawing.
 */
export function pointsFromPixels(pixels: number): number {
  return (pixels * POINTS_PER_INCH) / RASTER_DPI;
}
