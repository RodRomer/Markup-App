/**
 * The two overage alert rules, free of I/O so they can be tested without Keap.
 *
 * A port of rules.py from the prototype in VS Development\Overage, which stays
 * there untouched as the reference. Its 33 test cases are ported alongside this
 * (tests/overageRules.test.ts) with the same inputs and the same answers --
 * that parity is the whole reason the port can be trusted, so a change to the
 * rule belongs in both or in neither.
 *
 * Dates are "YYYY-MM-DD" strings throughout rather than Date objects. The
 * server runs in UTC and PPM does not, and a Date carries a time of day that
 * silently moves a project into the previous day for anyone who forgets it.
 */
import {
  FIELD_DRAFTER,
  FIELD_NOTES,
  FIELD_OVERAGE,
  FIELD_PM_EMAIL,
  FIELD_SF_EST,
  MISSING_SF_BUSINESS_DAYS,
  OVERAGE_MULTIPLIER,
} from "./settings.ts";

export const MISSING_SF = "MISSING_SF";
export const OVER_SF = "OVER_SF";
export type AlertKind = typeof MISSING_SF | typeof OVER_SF;

// A number only counts when a unit sits right next to it, before or after --
// "2802 sf" or "SF: 2802". Notes hold plenty of numbers that are not square
// footage -- "Revit 2023", "C3", "<25 business days".
const UNIT = String.raw`(?:sf|s\.f\.|sq\.?\s*ft\.?|square\s*f(?:ee|oo)t)`;
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{3,7})`;
const SF = new RegExp(
  String.raw`(?<![\d,.])${NUM}\s*${UNIT}(?![a-z])` + // 2802 sf
    String.raw`|(?<![a-z])${UNIT}\s*[:=\-~]?\s*${NUM}(?![\d,.]\d)(?!\d)`, // SF: 2802
  "gi",
);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** Keap hands notes back HTML-escaped -- "&lt;25", "&#013;" between lines.
 *  Python's html.unescape did this in the prototype; this covers what Keap
 *  actually produces, numeric references and the common names. */
function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X"
        ? parseInt(ref.slice(2), 16)
        : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * The square footage written in CAD/Plot Notes, or null.
 *
 * The last one wins: notes are appended to, so a later figure is an update.
 */
export function parseSf(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const matches = [...unescapeHtml(notes).matchAll(SF)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return parseInt((last[1] ?? last[2]).replaceAll(",", ""), 10);
}

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Mon-Fri days after `start`, up to and including `today`.
 *
 * Entered Friday -> Monday 1, Tuesday 2, Wednesday 3.
 */
export function businessDaysSince(start: string, today: string): number {
  const DAY = 86_400_000;
  const end = toUtc(today);
  let days = 0;
  for (let t = toUtc(start) + DAY; t <= end; t += DAY) {
    const weekday = new Date(t).getUTCDay(); // 0 Sunday .. 6 Saturday
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

export function overageThreshold(overage: number | null): number | null {
  if (!overage) return null;
  return Math.floor(overage * OVERAGE_MULTIPLIER);
}

export type Project = {
  oppId: number;
  number: string;
  drafter: string;
  pmEmail: string;
  overage: number | null;
  sfEst: number | null;
  notes: string;
};

export type Alert = {
  kind: AlertKind;
  project: Project;
  notesSf: number | null;
  threshold: number | null;
  businessDays: number | null;
};

export function alertKey(alert: { kind: string; project: { oppId: number } }): string {
  return `${alert.project.oppId}:${alert.kind}`;
}

export type Result = {
  project: Project;
  entered: string | null;
  businessDays: number | null;
  notesSf: number | null;
  threshold: number | null;
  status: string;
  alerts: Alert[];
};

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type RawOpportunity = {
  id: number;
  opportunity_title?: string | null;
  custom_fields?: { id: number; content?: unknown }[];
};

export function projectFromOpportunity(raw: RawOpportunity): Project {
  const cf = new Map((raw.custom_fields ?? []).map((f) => [f.id, f.content]));
  return {
    oppId: raw.id,
    number: raw.opportunity_title || "",
    drafter: text(cf.get(FIELD_DRAFTER)).trim(),
    pmEmail: text(cf.get(FIELD_PM_EMAIL)).trim(),
    overage: toInt(cf.get(FIELD_OVERAGE)),
    sfEst: toInt(cf.get(FIELD_SF_EST)),
    notes: text(cf.get(FIELD_NOTES)),
  };
}

export function evaluate(project: Project, entered: string | null, today: string): Result {
  const notesSf = parseSf(project.notes);
  const threshold = overageThreshold(project.overage);
  const days = entered ? businessDaysSince(entered, today) : null;
  const alerts: Alert[] = [];
  const status: string[] = [];

  if (notesSf === null) {
    if (days === null) {
      status.push("no stage history");
    } else if (days >= MISSING_SF_BUSINESS_DAYS) {
      alerts.push({ kind: MISSING_SF, project, notesSf: null, threshold: null, businessDays: days });
      status.push("SF missing");
    } else {
      status.push("waiting on SF");
    }
  } else if (threshold === null) {
    status.push("no overage baseline");
  } else if (notesSf > threshold) {
    alerts.push({ kind: OVER_SF, project, notesSf, threshold, businessDays: days });
    status.push("OVER");
    if (!project.pmEmail) status.push("no PM email");
  } else {
    status.push("OK");
  }

  return { project, entered, businessDays: days, notesSf, threshold, status: status.join(", "), alerts };
}
