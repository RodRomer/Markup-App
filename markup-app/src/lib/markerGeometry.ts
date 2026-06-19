type Point = { x: number; y: number };

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
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

const ARROW_TIP_DISTANCE = 1.7;

/** Tip of an IE direction arrow, `size` units out from the marker center along `angleDeg`. */
export function arrowTipPoint(cx: number, cy: number, angleDeg: number, size: number): Point {
  const rad = toRad(angleDeg);
  return { x: cx + Math.cos(rad) * (size * ARROW_TIP_DISTANCE), y: cy + Math.sin(rad) * (size * ARROW_TIP_DISTANCE) };
}

/** Lone triangle pointing outward from (cx,cy) along angleDeg — used only when an IE marker has a single direction. */
export function arrowPolygonPoints(
  cx: number,
  cy: number,
  angleDeg: number,
  size: number
): Point[] {
  const rad = toRad(angleDeg);
  const baseDistance = size * 0.5;
  const tipDistance = size * ARROW_TIP_DISTANCE;
  const baseHalfWidth = size * 0.5;
  const perpRad = rad + Math.PI / 2;

  const baseCx = cx + Math.cos(rad) * baseDistance;
  const baseCy = cy + Math.sin(rad) * baseDistance;
  const tip = { x: cx + Math.cos(rad) * tipDistance, y: cy + Math.sin(rad) * tipDistance };
  const corner1 = {
    x: baseCx + Math.cos(perpRad) * baseHalfWidth,
    y: baseCy + Math.sin(perpRad) * baseHalfWidth,
  };
  const corner2 = {
    x: baseCx - Math.cos(perpRad) * baseHalfWidth,
    y: baseCy - Math.sin(perpRad) * baseHalfWidth,
  };

  return [tip, corner1, corner2];
}

/**
 * The IE marker's full arrow shape: one solid polygon connecting the tip of
 * every direction directly to the next, so 4 evenly-spaced directions read
 * as a single diamond (not four separate spiky triangles). 1 direction falls
 * back to a lone triangle; 2 directions become a lens/kite between them.
 */
export function ieMarkerPolygon(cx: number, cy: number, directions: number[], size: number): Point[] {
  if (directions.length === 0) return [];
  if (directions.length === 1) return arrowPolygonPoints(cx, cy, directions[0], size);

  const tipDistance = size * ARROW_TIP_DISTANCE;
  const tipAt = (angleDeg: number, dist = tipDistance) => {
    const rad = toRad(angleDeg);
    return { x: cx + Math.cos(rad) * dist, y: cy + Math.sin(rad) * dist };
  };

  if (directions.length === 2) {
    const [a, b] = directions;
    const mid = (a + b) / 2;
    return [tipAt(a), tipAt(mid + 90, size * 0.5), tipAt(b), tipAt(mid - 90, size * 0.5)];
  }

  const sorted = [...directions].sort(
    (x, y) => (((x % 360) + 360) % 360) - (((y % 360) + 360) % 360)
  );
  return sorted.map((a) => tipAt(a));
}

/** Small flag triangle at a section line endpoint, pointing perpendicular to the line. */
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
  const viewRad = lineRad + (Math.PI / 2) * side;

  const [x, y] = endpoint === "start" ? [x1, y1] : [x2, y2];
  // Offset the whole flag out along the view direction so its base clears the
  // circular endpoint handle instead of sitting underneath it.
  const baseDistance = size * 0.8;
  const tipDistance = size * 2.1;
  const baseHalf = size * 0.45;

  const baseCx = x + Math.cos(viewRad) * baseDistance;
  const baseCy = y + Math.sin(viewRad) * baseDistance;
  const tip = { x: x + Math.cos(viewRad) * tipDistance, y: y + Math.sin(viewRad) * tipDistance };
  const corner1 = { x: baseCx + Math.cos(lineRad) * baseHalf, y: baseCy + Math.sin(lineRad) * baseHalf };
  const corner2 = { x: baseCx - Math.cos(lineRad) * baseHalf, y: baseCy - Math.sin(lineRad) * baseHalf };

  return [tip, corner1, corner2];
}
