import { NextResponse } from "next/server";
import { isAdminDenied, requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";

/** How long after claiming an alert its claimer can hand it back. */
const RELEASE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Hand back a claim whose email Outlook then failed to send.
 *
 * Only the person who claimed it, and only within minutes of claiming. This
 * exists to undo a send that did not happen -- not to make a sent alert unsent
 * later, which would let "once only" be quietly undone and let a record of who
 * was told disappear.
 */
export async function POST(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Which alerts?" }, { status: 400 });

  const released = await prisma.overageAlert.updateMany({
    where: {
      id: { in: ids },
      sentByMemberId: who.memberId,
      sentAt: { gte: new Date(Date.now() - RELEASE_WINDOW_MS) },
    },
    data: { sentAt: null, sentByMemberId: null, sentTo: null },
  });
  return NextResponse.json({ released: released.count });
}
