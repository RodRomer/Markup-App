import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newSessionToken, sessionExpiry, verifyPassword } from "@/lib/teamAuth";

/**
 * Sign in as a team. Open to anyone who knows a team name and its password --
 * that pair is the credential, and this is the one route that accepts it.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const team = name ? await prisma.team.findUnique({ where: { name } }) : null;

  // Verify even when there is no such team, against a hash that cannot match.
  // Otherwise a wrong name returns in a millisecond and a wrong password takes
  // a hundred, which tells a stranger exactly which teams exist.
  const stored = team?.passwordHash
    ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const ok = verifyPassword(password, stored);

  if (!team || !ok) {
    return NextResponse.json({ error: "Wrong team name or password." }, { status: 401 });
  }

  const token = newSessionToken();
  const expiresAt = sessionExpiry();
  await prisma.session.create({ data: { token, teamId: team.id, expiresAt } });

  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    team: { id: team.id, name: team.name },
  });
}
