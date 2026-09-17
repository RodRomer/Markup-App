import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/teamAuth";

/**
 * Adding, listing and switching off people's logins, guarded by the admin key
 * rather than by a sign-in.
 *
 * The same bootstrap argument as teams: somebody has to be able to create the
 * first login, and that cannot require already having one. What this cannot do
 * is read anyone's work -- the admin key opens no project.
 */

export async function GET(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const members = await prisma.member.findMany({
    orderBy: [{ team: { name: "asc" } }, { name: "asc" }],
    // No password hash, ever, not even to an admin. There is nothing to do with
    // one except attack it offline.
    select: {
      id: true, name: true, createdAt: true, disabledAt: true,
      team: { select: { name: true } },
      _count: { select: { sessions: true } },
    },
  });

  return NextResponse.json(members.map((m) => ({
    name: m.name,
    team: m.team.name,
    createdAt: m.createdAt.toISOString(),
    disabledAt: m.disabledAt?.toISOString() ?? null,
    openSessions: m._count.sessions,
  })));
}

export async function POST(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const team = typeof body?.team === "string" ? body.team.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name || !team) {
    return NextResponse.json({ error: "A login needs a name and a team." }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `The password must be at least ${PASSWORD_MIN_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const owner = await prisma.team.findUnique({ where: { name: team } });
  if (!owner) {
    return NextResponse.json({ error: `There is no team called "${team}".` }, { status: 404 });
  }
  // Names are unique across the app, because signing in takes a name and a
  // password and nothing else. A clash here would be two people who cannot both
  // sign in, discovered later.
  if (await prisma.member.findUnique({ where: { name } })) {
    return NextResponse.json({ error: `There is already a login called "${name}".` }, { status: 409 });
  }
  if (await prisma.team.findUnique({ where: { name } })) {
    return NextResponse.json(
      { error: `"${name}" is a team name, so it cannot also be a person's.` }, { status: 409 });
  }

  const member = await prisma.member.create({
    data: { name, teamId: owner.id, passwordHash: hashPassword(password) },
  });
  return NextResponse.json({ name: member.name, team: owner.name });
}

export async function PATCH(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const member = name ? await prisma.member.findUnique({ where: { name } }) : null;
  if (!member) {
    return NextResponse.json({ error: `There is no login called "${name}".` }, { status: 404 });
  }

  if (typeof body?.password === "string") {
    if (body.password.length < PASSWORD_MIN_LENGTH) {
      return NextResponse.json(
        { error: `The password must be at least ${PASSWORD_MIN_LENGTH} characters.` },
        { status: 400 }
      );
    }
    // Their existing sessions go too. A password is changed either because it
    // leaked or because the person left; in both cases a session already open
    // is exactly what must stop working.
    await prisma.$transaction([
      prisma.member.update({ where: { id: member.id }, data: { passwordHash: hashPassword(body.password) } }),
      prisma.session.deleteMany({ where: { memberId: member.id } }),
    ]);
    return NextResponse.json({ name: member.name, passwordChanged: true });
  }

  if (typeof body?.disabled === "boolean") {
    // Disabling takes effect now rather than whenever a session happens to
    // expire -- that is the whole reason for having separate logins.
    await prisma.$transaction([
      prisma.member.update({
        where: { id: member.id },
        data: { disabledAt: body.disabled ? new Date() : null },
      }),
      ...(body.disabled ? [prisma.session.deleteMany({ where: { memberId: member.id } })] : []),
    ]);
    return NextResponse.json({ name: member.name, disabled: body.disabled });
  }

  return NextResponse.json({ error: "Send a password, or disabled: true or false." }, { status: 400 });
}
