import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Revoke this session. Deliberately answers the same either way: a caller
 *  signing out does not need to know whether the token was still good. */
export async function POST(request: Request) {
  const token = request.headers.get("x-team-token");
  if (token) {
    await prisma.session.delete({ where: { token } }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
