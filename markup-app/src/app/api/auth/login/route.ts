import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newSessionToken, sessionExpiry, verifyPassword } from "@/lib/teamAuth";

/**
 * Sign in, as a person or as a team.
 *
 * A name and a password is the whole credential, and this is the one route that
 * takes it. A person's own login is tried first; the shared team password still
 * works, so the changeover does not have to happen everywhere at once. Either
 * way the session is scoped to a team and sees that team's projects only --
 * which is the point of separating the two: everyone keeps the same view of the
 * work while holding a credential of their own.
 *
 * A disabled person is refused in the same words as a wrong password. Saying
 * "that account is switched off" tells a stranger the name was right.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const member = name
    ? await prisma.member.findUnique({ where: { name }, include: { team: true } })
    : null;
  const team = member ? member.team : name ? await prisma.team.findUnique({ where: { name } }) : null;

  // Verify even when there is nobody by that name, against a hash that cannot
  // match. Otherwise a wrong name returns in a millisecond and a wrong password
  // takes a hundred, which tells a stranger exactly which names are real.
  const stored = member?.passwordHash ?? team?.passwordHash
    ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const ok = verifyPassword(password, stored);

  if (!team || !ok || member?.disabledAt) {
    return NextResponse.json({ error: "Wrong name or password." }, { status: 401 });
  }

  const token = newSessionToken();
  const expiresAt = sessionExpiry();
  await prisma.session.create({
    data: { token, teamId: team.id, memberId: member?.id ?? null, expiresAt },
  });

  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    team: { id: team.id, name: team.name },
    // Who signed in, when it was a person. Null for the shared team password.
    member: member ? { id: member.id, name: member.name } : null,
  });
}
