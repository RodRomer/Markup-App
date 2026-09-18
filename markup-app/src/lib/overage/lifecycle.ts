/**
 * What happens to one alert from run to run.
 *
 * Settled with the user: once only. Each project is emailed at most once per
 * problem, ever -- an ignored alert is not re-sent. So an alert that has been
 * sent is never offered again, even if the problem clears and comes back.
 *
 * An alert that was never sent is different. It can clear (the drafter adds the
 * SF before anyone gets round to sending), and it can come back, and it should
 * be offered again when it does: nobody has been told about it yet.
 *
 * Timestamps are ISO strings, which sort as times.
 */

export type AlertState = {
  firstSeenAt: string;
  lastSeenAt: string;
  /** Set when a run no longer sees the problem. Cleared if it comes back. */
  resolvedAt: string | null;
  /** Set when an admin claims it to send. Never cleared by a run. */
  sentAt: string | null;
};

/**
 * The next state of one alert, given whether this run sees the problem.
 *
 * `null` in and inactive means there is nothing to record -- a problem nobody
 * has seen is not an alert. `null` out only ever happens in that case.
 */
export function observe(existing: AlertState | null, active: boolean, now: string): AlertState | null {
  if (!existing) {
    return active ? { firstSeenAt: now, lastSeenAt: now, resolvedAt: null, sentAt: null } : null;
  }
  if (active) {
    return { ...existing, lastSeenAt: now, resolvedAt: null };
  }
  return { ...existing, resolvedAt: existing.resolvedAt ?? now };
}

/** Whether Warden should offer it: seen now, and never sent. */
export function isPending(state: AlertState): boolean {
  return state.sentAt === null && state.resolvedAt === null;
}
