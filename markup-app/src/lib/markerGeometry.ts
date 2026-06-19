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

/** A marker's dot is drawn at `size * DOT_RADIUS_FACTOR` — arrow geometry is built around this same radius so the two always line up. */
export const DOT_RADIUS_FACTOR = 0.5;

/**
 * One arrow wedge pointing outward from (cx,cy) along angleDeg. Its two base
 * corners sit exactly on the dot's own circle (radius `size * DOT_RADIUS_FACTOR`),
 * 45° to either side of the arrow's angle — the distance from center to tip
 * is chosen so that line is tangent to the dot there. That 45° offset is what
 * makes this consistent across direction counts: any two directions that are
 * 90° apart (every pair this app ever produces, since directions are only
 * ever added/rotated in 90° steps) share that tangent point exactly, so their
 * wedges meet with no gap or overlap; directions further apart just leave
 * that stretch of the dot's circle showing.
 */
export function arrowWedgePoints(cx: number, cy: number, angleDeg: number, size: number): Point[] {
  const r = size * DOT_RADIUS_FACTOR;
  const tipDistance = r * Math.SQRT2;
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
