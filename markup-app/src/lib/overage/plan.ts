/**
 * What one run of the overage check changes, decided without touching anything.
 *
 * run.ts reads Keap and the database and writes the result; everything in
 * between is here, pure, so the part that can go subtly wrong -- which alerts
 * are new, which cleared, which came back -- is tested by calling it.
 */
import { type AlertState, observe } from "./lifecycle.ts";
import { type Alert, alertKey, type Result } from "./rules.ts";

export type AlertRow = AlertState & { oppId: number; kind: string };

/**
 * `alert` carries the figures to refresh the row with; null for a row the run
 * no longer sees, whose figures stay as they were last seen.
 *
 * `state` never includes a change to `sentAt`, and the writer must not write
 * it. A run reads the rows, thinks, and writes -- and an admin can claim an
 * alert in between. Writing back the `sentAt` it read would put a null over
 * that claim, and the alert would be offered, and sent, a second time.
 */
export type AlertChange =
  | { op: "create"; alert: Alert; state: AlertState }
  | { op: "update"; oppId: number; kind: string; alert: Alert | null; state: AlertState };

export function planAlertChanges(existing: AlertRow[], active: Alert[], now: string): AlertChange[] {
  const byKey = new Map(existing.map((row) => [`${row.oppId}:${row.kind}`, row]));
  // Keyed, so a project listed twice -- Keap's paging can repeat one if the
  // stage changes mid-listing -- is one alert rather than two.
  const activeByKey = new Map(active.map((a) => [alertKey(a), a]));

  const changes: AlertChange[] = [];
  for (const [key, alert] of activeByKey) {
    const row = byKey.get(key);
    const state = observe(row ?? null, true, now)!;
    changes.push(row
      ? { op: "update", oppId: row.oppId, kind: row.kind, alert, state }
      : { op: "create", alert, state });
  }
  for (const [key, row] of byKey) {
    if (activeByKey.has(key) || row.resolvedAt !== null) continue;
    changes.push({ op: "update", oppId: row.oppId, kind: row.kind, alert: null,
                   state: observe(row, false, now)! });
  }
  return changes;
}

/** One line of the report Warden shows: every CAD Live project, alert or not. */
export type ReportRow = {
  oppId: number;
  number: string;
  drafter: string;
  entered: string | null;
  businessDays: number | null;
  notesSf: number | null;
  overage: number | null;
  threshold: number | null;
  status: string;
};

export function reportRows(results: Result[]): ReportRow[] {
  return results
    .map((r) => ({
      oppId: r.project.oppId,
      number: r.project.number,
      drafter: r.project.drafter,
      entered: r.entered,
      businessDays: r.businessDays,
      notesSf: r.notesSf,
      overage: r.project.overage,
      threshold: r.threshold,
      status: r.status,
    }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

/**
 * The calendar day somewhere, as "YYYY-MM-DD".
 *
 * The server's own day is UTC's, which turns over at 6pm in Denver -- so a Run
 * now pressed after work would count tomorrow as today, and a project could
 * cross the three-business-day line a day early.
 */
export function localDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
