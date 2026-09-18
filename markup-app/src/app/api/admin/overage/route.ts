import { NextResponse } from "next/server";
import { isAdminDenied, requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import type { ReportRow } from "@/lib/overage/plan";
import { runOverageCheck } from "@/lib/overage/run";
import { pendingEmails, unmappedDrafters } from "@/lib/overage/view";

/** A run reads ~70 projects from Keap at a polite rate; about ten seconds. */
export const maxDuration = 120;

/** How many sent alerts Warden lists, newest first, as a record of what went. */
const RECENTLY_SENT = 25;

/**
 * Everything Warden's overage page shows.
 *
 * The emails are composed now, from the last run's figures and the drafter list
 * as it stands -- so an address added a minute ago makes its alerts sendable
 * without waiting for tomorrow's run.
 */
export async function GET(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const [lastRun, lastGoodRun, pending, drafters, sent] = await Promise.all([
    prisma.overageRun.findFirst({ orderBy: { ranAt: "desc" },
      select: { ranAt: true, trigger: true, ok: true, error: true } }),
    prisma.overageRun.findFirst({ where: { ok: true }, orderBy: { ranAt: "desc" },
      select: { ranAt: true, report: true } }),
    prisma.overageAlert.findMany({ where: { sentAt: null, resolvedAt: null } }),
    prisma.drafterEmail.findMany({ select: { key: true, email: true } }),
    prisma.overageAlert.findMany({
      where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, take: RECENTLY_SENT,
      select: { projectNumber: true, kind: true, sentAt: true, sentTo: true, sentByMemberId: true },
    }),
  ]);

  const emails = new Map(drafters.map((d) => [d.key, d.email]));
  const report = (lastGoodRun?.report ?? []) as ReportRow[];
  const senderIds = [...new Set(sent.map((s) => s.sentByMemberId).filter((id): id is string => !!id))];
  const senders = await prisma.member.findMany({
    where: { id: { in: senderIds } }, select: { id: true, name: true },
  });
  const senderName = new Map(senders.map((m) => [m.id, m.name]));

  return NextResponse.json({
    lastRun: lastRun && { ...lastRun, ranAt: lastRun.ranAt.toISOString() },
    lastGoodRunAt: lastGoodRun?.ranAt.toISOString() ?? null,
    pending: pendingEmails(pending, emails),
    unmappedDrafters: unmappedDrafters(report, emails),
    report,
    recentlySent: sent.map((s) => ({
      projectNumber: s.projectNumber,
      kind: s.kind,
      sentAt: s.sentAt!.toISOString(),
      sentTo: s.sentTo,
      sentBy: (s.sentByMemberId && senderName.get(s.sentByMemberId)) ?? null,
    })),
  });
}

/** Run now. The weekday morning run is the cron route; this is the button. */
export async function POST(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const outcome = await runOverageCheck("manual", who.memberId);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
