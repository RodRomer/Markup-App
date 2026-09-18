/**
 * Turning an alert into the email an admin reviews and sends.
 *
 * The text is ported from notify.compose in the prototype, word for word, and
 * the parity check that proved the SF rule the same was run over this as well.
 * What the prototype left as "(email TBD)" is decided here: a drafter's name is
 * looked up in the list admins keep in Warden, and an alert with nobody to
 * send it to is marked unsendable -- with the reason -- rather than dropped.
 * Dropping it would look, from Warden, exactly like there being nothing wrong.
 */
import { type Alert, MISSING_SF, OVER_SF } from "./rules.ts";
import { OVERAGE_MULTIPLIER } from "./settings.ts";

export type Email = {
  to: string[];
  subject: string;
  body: string;
  /** False when there is nobody to send it to; `reason` then says why. */
  sendable: boolean;
  reason: string | null;
};

/** Drafter Name is a Keap list box, comma-separated when several are set. */
export function drafterNames(field: string): string[] {
  return field.split(",").map((n) => n.trim()).filter(Boolean);
}

/** How a drafter's name is matched against the list kept in Warden. Keap list
 *  values are fixed spellings, but whoever types the list into Warden is not,
 *  and "jane smith" failing to match "Jane Smith " would be a silly way to
 *  leave somebody unemailed. */
export function drafterKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 2802 -> "2,802", the way Python's f"{n:,}" wrote it. Not toLocaleString:
 *  that depends on the server's locale, and this text is compared across
 *  languages. */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function compose(alert: Alert, drafterEmails: ReadonlyMap<string, string>): Email {
  const p = alert.project;

  if (alert.kind === MISSING_SF) {
    const names = drafterNames(p.drafter);
    const to = names.map((n) => drafterEmails.get(drafterKey(n))).filter((e): e is string => !!e);
    const unmapped = names.filter((n) => !drafterEmails.get(drafterKey(n)));
    const reason = names.length === 0
      ? "No drafter is set in Keap."
      : unmapped.length > 0
        ? `No email in Warden for ${unmapped.map((n) => `'${n}'`).join(", ")}.`
        : null;
    return {
      // All or nothing: a project with two drafters where only one gets the
      // email is a project where the other one never hears about it.
      to: reason ? [] : to,
      subject: `${p.number}: Building SF missing from CAD/Plot Notes`,
      body:
        `${p.number} has been in CAD Live for ${alert.businessDays} business days ` +
        `and CAD/Plot Notes has no updated building SF.\n\n` +
        `Please add the measured SF to CAD/Plot Notes, e.g. "2802 sf".\n\n` +
        `Estimated SF: ${p.sfEst || "-"}\n` +
        `Building SF - Overage: ${p.overage || "-"}`,
      sendable: reason === null,
      reason,
    };
  }

  if (alert.kind === OVER_SF) {
    const notesSf = alert.notesSf ?? 0;
    const overage = p.overage ?? 0;
    const pct = ((notesSf / overage - 1) * 100).toFixed(1);
    const reason = p.pmEmail ? null : "No Project Manager email in Keap.";
    return {
      to: p.pmEmail ? [p.pmEmail] : [],
      subject: `${p.number}: Building SF over overage threshold`,
      body:
        `The drafter's SF for ${p.number} is over the overage threshold.\n\n` +
        `CAD/Plot Notes SF: ${grouped(notesSf)}\n` +
        `Building SF - Overage: ${grouped(overage)}\n` +
        `Threshold (Overage x ${OVERAGE_MULTIPLIER}): ${grouped(alert.threshold ?? 0)}\n` +
        `Over the Overage field by ${pct}%\n\n` +
        `Estimated SF: ${p.sfEst || "-"}\n` +
        `Drafter: ${p.drafter || "-"}`,
      sendable: reason === null,
      reason,
    };
  }

  throw new Error(`Unknown alert kind: ${(alert as Alert).kind}`);
}
