import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/teamAuth";

/**
 * Managing teams, guarded by MARKUP_STAFF_KEY rather than by a team sign-in.
 *
 * Somebody has to be able to make the first team, and that cannot require
 * already belonging to one. The admin key is the bootstrap, and creating and
 * listing teams is all it can now do -- it no longer opens anyone's projects.
 */

export async function GET(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    // No password hash, ever, not even to an admin. There is nothing anyone can
    // do with it except attack it offline.
    select: { id: true, name: true, createdAt: true, _count: { select: { projects: true } } },
  });

  return NextResponse.json(
    teams.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      projectCount: t._count.projects,
    }))
  );
}

export async function POST(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name) {
    return NextResponse.json({ error: "A team needs a name." }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `The password must be at least ${PASSWORD_MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const existing = await prisma.team.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: `There is already a team called "${name}".` }, { status: 409 });
  }

  const team = await prisma.team.create({
    data: { name, passwordHash: hashPassword(password) },
  });

  // The password is not echoed back. Whoever created the team already has it,
  // and this response ends up in logs and consoles.
  return NextResponse.json({ id: team.id, name: team.name });
}
