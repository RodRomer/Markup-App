import { NextResponse } from "next/server";
import { isAdminDenied, requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/db";
import { drafterKey } from "@/lib/overage/compose";

/**
 * Drafter name -> email, kept by admins in Warden.
 *
 * Keap's Drafter Name field holds names only. Names are matched on drafterKey
 * -- trimmed, single-spaced, lower case -- so the list does not have to be typed
 * exactly as Keap spells it.
 */

// Deliberately loose. Outlook is the real judge of an address; this only stops
// a name pasted into the email box, which would otherwise sit in the list
// looking like a mapping while every email to that drafter bounced.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const drafters = await prisma.drafterEmail.findMany({
    orderBy: { name: "asc" },
    select: { name: true, email: true, updatedAt: true },
  });
  return NextResponse.json(drafters.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() })));
}

export async function PUT(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!name || name.length > 200) return NextResponse.json({ error: "Which drafter?" }, { status: 400 });
  if (!EMAIL.test(email) || email.length > 320) {
    return NextResponse.json({ error: `"${email}" is not an email address.` }, { status: 400 });
  }

  const key = drafterKey(name);
  await prisma.drafterEmail.upsert({
    where: { key },
    create: { key, name, email, updatedByMemberId: who.memberId },
    update: { name, email, updatedByMemberId: who.memberId },
  });
  return NextResponse.json({ name, email });
}

export async function DELETE(request: Request) {
  const who = await requireAdmin(request);
  if (isAdminDenied(who)) return who;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  if (!name.trim()) return NextResponse.json({ error: "Which drafter?" }, { status: 400 });
  const removed = await prisma.drafterEmail.deleteMany({ where: { key: drafterKey(name) } });
  return NextResponse.json({ removed: removed.count });
}
