import { NextResponse } from "next/server";
import { isAdminDenied, requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import { compose } from "@/lib/overage/compose";
import { alertFromRow } from "@/lib/overage/view";

/** More than a day's alerts ever were; enough to refuse a runaway loop. */
const MAX_PER_CLAIM = 100;

/**
 * Take alerts to send, so nobody else can.
 *
 * Warden claims before it sends, one at a time, and the claim is what marks an
 * alert sent. Two admins pressing Send at once each get only what they claimed:
 * the update only matches a row whose sentAt is still null, so the second one
 * matches nothing.
 *
 * The email is composed here and handed back, and Warden sends exactly that.
 * The recipients recorded against the alert are the ones the server decided,
 * not whatever a client says it sent to.
 */
export async function POST(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Which alerts?" }, { status: 400 });
  if (ids.length > MAX_PER_CLAIM) {
    return NextResponse.json({ error: `At most ${MAX_PER_CLAIM} at a time.` }, { status: 400 });
  }

  const [rows, drafters] = await Promise.all([
    prisma.overageAlert.findMany({ where: { id: { in: ids }, sentAt: null, resolvedAt: null } }),
    prisma.drafterEmail.findMany({ select: { key: true, email: true } }),
  ]);
  const emails = new Map(drafters.map((d) => [d.key, d.email]));

  const claimed: { id: string; to: string[]; subject: string; body: string }[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) {
    if (!found.has(id)) skipped.push({ id, reason: "Already sent, or no longer a problem." });
  }

  for (const row of rows) {
    const email = compose(alertFromRow(row), emails);
    if (!email.sendable) {
      skipped.push({ id: row.id, reason: email.reason ?? "Nobody to send it to." });
      continue;
    }
    const taken = await prisma.overageAlert.updateMany({
      where: { id: row.id, sentAt: null, resolvedAt: null },
      data: { sentAt: new Date(), sentByMemberId: who.memberId, sentTo: email.to.join("; ") },
    });
    if (taken.count === 1) {
      claimed.push({ id: row.id, to: email.to, subject: email.subject, body: email.body });
    } else {
      skipped.push({ id: row.id, reason: "Someone else is sending it." });
    }
  }

  return NextResponse.json({ claimed, skipped });
}
