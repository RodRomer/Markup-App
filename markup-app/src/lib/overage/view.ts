/**
 * What Warden is shown, assembled from stored rows without touching anything.
 *
 * Emails are composed here, at the moment they are looked at, from the figures
 * the last run saw and the drafter list as it is *now* -- so adding a missing
 * address in Warden makes an alert sendable straight away, without waiting for
 * tomorrow's run.
 */
import { compose, drafterKey, drafterNames, type Email } from "./compose.ts";
import type { ReportRow } from "./plan.ts";
import { type Alert, type AlertKind, MISSING_SF, OVER_SF } from "./rules.ts";

/** An alert as stored -- the columns compose needs. */
export type StoredAlert = {
  id: string;
  oppId: number;
  kind: string;
  projectNumber: string;
  drafter: string;
  pmEmail: string;
  overage: number | null;
  sfEst: number | null;
  notesSf: number | null;
  threshold: number | null;
  businessDays: number | null;
};

export function alertFromRow(row: StoredAlert): Alert {
  if (row.kind !== MISSING_SF && row.kind !== OVER_SF) {
    throw new Error(`Unknown alert kind in the database: ${row.kind}`);
  }
  return {
    kind: row.kind as AlertKind,
    project: {
      oppId: row.oppId, number: row.projectNumber, drafter: row.drafter, pmEmail: row.pmEmail,
      overage: row.overage, sfEst: row.sfEst, notes: "",
    },
    notesSf: row.notesSf,
    threshold: row.threshold,
    businessDays: row.businessDays,
  };
}

export type PendingEmail = {
  id: string;
  oppId: number;
  kind: string;
  projectNumber: string;
  email: Email;
};

export function pendingEmails(rows: StoredAlert[], drafterEmails: ReadonlyMap<string, string>): PendingEmail[] {
  return rows
    .map((row) => ({
      id: row.id,
      oppId: row.oppId,
      kind: row.kind,
      projectNumber: row.projectNumber,
      email: compose(alertFromRow(row), drafterEmails),
    }))
    // Sendable first, then by project: what can go now is what an admin opened
    // Warden to do, and what is blocked is the list of addresses to go and find.
    .sort((a, b) =>
      Number(b.email.sendable) - Number(a.email.sendable) ||
      a.projectNumber.localeCompare(b.projectNumber) ||
      a.kind.localeCompare(b.kind));
}

/**
 * Drafter names the last run saw that have no email in Warden's list.
 *
 * From the whole report rather than only the alerts, so a drafter can be given
 * an address before their first missing-SF alert rather than because of it.
 * Each name once, as Keap spells it.
 */
export function unmappedDrafters(report: ReportRow[], drafterEmails: ReadonlyMap<string, string>): string[] {
  const seen = new Map<string, string>();
  for (const row of report) {
    for (const name of drafterNames(row.drafter)) {
      const key = drafterKey(name);
      if (!drafterEmails.has(key) && !seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
