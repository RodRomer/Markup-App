type Point = { x: number; y: number };

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function polarPoint(cx: number, cy: number, angleDeg: number, dist: number): Point {
  const rad = toRad(angleDeg);
  return { x: cx + Math.cos(rad) * dist, y: cy + Math.sin(rad) * dist };
}

export function toSvgPoints(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Snaps a (dx,dy) vector to the nearest multiple of 45° (horizontal,
 * vertical, or diagonal) when it's within `thresholdDeg` of one, preserving
 * length; otherwise returns it unchanged so free angles stay available.
 */
export function snapToCommonAngle(
  dx: number,
  dy: number,
  thresholdDeg = 6
): { dx: number; dy: number } {
  const length = Math.hypot(dx, dy);
  if (length === 0) return { dx, dy };

  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const nearestSnap = Math.round(angle / step) * step;
  const diff = Math.abs(Math.atan2(Math.sin(angle - nearestSnap), Math.cos(angle - nearestSnap)));
  if ((diff * 180) / Math.PI > thresholdDeg) return { dx, dy };

  return { dx: Math.cos(nearestSnap) * length, dy: Math.sin(nearestSnap) * length };
}

// Both renderers draw from these, and both used to declare their own copy with
// a comment in the export saying it matched the editor -- an agreement kept by
// hand, between two files, that nothing checked. A marker drawn at one weight on
// screen and another in the PDF still looks like a marker in both, so a drift
// here would not announce itself.

// Section cut lines and revision leaders are the same weight of line and are
// drawn from this single factor, so changing one changes both.
export const MARKER_LINE_FACTOR = 0.0022;

// Default callout text width, as a fraction of page width. Equivalent to the ~34
// characters the old character-count wrapper allowed at this font size; an earlier
// pass set this to 0.085, which halved the box and turned two-line callouts into
// four-line ones.
export const REVISION_TEXT_WIDTH = 0.163;

/** A marker's dot is drawn at `size * DOT_RADIUS_FACTOR` — arrow geometry is built around this same radius so the two always line up. */
export const DOT_RADIUS_FACTOR = 0.5;

// How much farther out the tip sits versus the minimum (tangent) distance.
// Only stretches the tip outward — the base corners stay locked to the dot's
// circle, so this can change freely without breaking the dot connection.
const ARROW_LENGTH_FACTOR = 1.3;

/**
 * One arrow wedge pointing outward from (cx,cy) along angleDeg. Its two base
 * corners sit exactly on the dot's own circle (radius `size * DOT_RADIUS_FACTOR`),
 * 45° to either side of the arrow's angle. That 45° offset is what makes this
 * consistent across direction counts: any two directions that are 90° apart
 * (every pair this app ever produces, since directions are only ever
 * added/rotated in 90° steps) share that point exactly, so their wedges meet
 * with no gap or overlap; directions further apart just leave that stretch of
 * the dot's circle showing.
 */
export function arrowWedgePoints(cx: number, cy: number, angleDeg: number, size: number): Point[] {
  const r = size * DOT_RADIUS_FACTOR;
  const tipDistance = r * Math.SQRT2 * ARROW_LENGTH_FACTOR;
  return [
    polarPoint(cx, cy, angleDeg - 45, r),
    polarPoint(cx, cy, angleDeg, tipDistance),
    polarPoint(cx, cy, angleDeg + 45, r),
  ];
}

/** Tip of an IE direction arrow, `size` units out from the marker center along `angleDeg` — used to place the rotation handle clear of the arrows. */
export function arrowTipPoint(cx: number, cy: number, angleDeg: number, size: number): Point {
  return polarPoint(cx, cy, angleDeg, size);
}

/** Small flag at a section line endpoint, pointing perpendicular to the line — the same tangent-to-the-dot wedge shape as an IE arrow. */
export function sectionFlagPolygonPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  endpoint: "start" | "end",
  flipped: boolean,
  size: number
): Point[] {
  const lineRad = Math.atan2(y2 - y1, x2 - x1);
  const side = flipped ? -1 : 1;
  const viewDeg = ((lineRad + (Math.PI / 2) * side) * 180) / Math.PI;
  const [x, y] = endpoint === "start" ? [x1, y1] : [x2, y2];
  return arrowWedgePoints(x, y, viewDeg, size);
}

/** How far the arrowhead's barbs sweep back from its axis, in radians. */
const ARROW_HALF_ANGLE = 0.42;

/**
 * How much thinner an outline is than the line it cases.
 *
 * Every marker carries a black casing so it holds up over dark linework. One
 * ratio, so the IE wedges, the section line and the revision leader are outlined
 * to the same weight rather than three independently chosen ones.
 */
export const MARKER_OUTLINE_RATIO = 0.35;

/**
 * The leader from a revision callout to the thing it points at.
 *
 * Three parts that have to agree, which is why they are worked out together:
 * where the line leaves the box, where it stops, and the arrowhead it stops
 * against. The line ends at the arrowhead's *base*, not at the tip -- drawn to
 * the tip it shows through and around the head, which is exactly what the tool
 * palette's icon was doing after it was drawn by hand from the same description.
 */
export function revisionLeader(
  tip: Point,
  box: { x: number; y: number; width: number; height: number },
  arrowLength: number
): { start: Point; end: Point; arrow: Point[] } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = tip.x - cx;
  const dy = tip.y - cy;

  // Where the line from the box's centre crosses its edge.
  const clip = Math.min(
    Math.abs(dx) > 1e-6 ? box.width / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-6 ? box.height / 2 / Math.abs(dy) : Infinity
  );
  const start = { x: cx + dx * Math.min(1, clip), y: cy + dy * Math.min(1, clip) };

  const angle = Math.atan2(tip.y - start.y, tip.x - start.x);
  const arrow = [
    tip,
    {
      x: tip.x - arrowLength * Math.cos(angle - ARROW_HALF_ANGLE),
      y: tip.y - arrowLength * Math.sin(angle - ARROW_HALF_ANGLE),
    },
    {
      x: tip.x - arrowLength * Math.cos(angle + ARROW_HALF_ANGLE),
      y: tip.y - arrowLength * Math.sin(angle + ARROW_HALF_ANGLE),
    },
  ];

  const headBack = arrowLength * Math.cos(ARROW_HALF_ANGLE);
  const end = {
    x: tip.x - headBack * Math.cos(angle),
    y: tip.y - headBack * Math.sin(angle),
  };

  return { start, end, arrow };
}
