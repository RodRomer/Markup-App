import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { isDenied, requireTeam } from "@/lib/teamAuth";
import { toolsFor } from "@/lib/toolAccess";

/**
 * Which tools this login may use, and -- for an admin -- setting that.
 *
 * GET answers the signed-in login and is what Waystone builds its rail from.
 * The admin verbs need the admin key, like teams and members: deciding who gets
 * a tool is not something a tool's own user should be able to do.
 */

export async function GET(request: Request) {
  const who = await requireTeam(request);
  if (isDenied(who)) return who;

  const access = await toolsFor(who);
  return NextResponse.json({
    ...access,
    // Echoed back so a machine can tell whose rail it is holding, and drop a
    // cached one that belonged to somebody else.
    team: who.teamName,
    member: who.memberName,
  });
}

/** Grant or refuse one tool, for a team or for one person. */
export async function POST(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const tool = typeof body?.tool === "string" ? body.tool.trim() : "";
  const team = typeof body?.team === "string" ? body.team.trim() : "";
  const member = typeof body?.member === "string" ? body.member.trim() : "";
  const allowed = body?.allowed !== false;

  if (!tool) return NextResponse.json({ error: "Which tool?" }, { status: 400 });
  if (Boolean(team) === Boolean(member)) {
    return NextResponse.json(
      { error: "Name a team or a person, not both and not neither." }, { status: 400 });
  }

  if (member) {
    const person = await prisma.member.findUnique({ where: { name: member } });
    if (!person) {
      return NextResponse.json({ error: `There is no login called "${member}".` }, { status: 404 });
    }
    await prisma.toolGrant.upsert({
      where: { memberId_tool: { memberId: person.id, tool } },
      create: { memberId: person.id, tool, allowed },
      update: { allowed },
    });
    return NextResponse.json({ tool, member, allowed });
  }

  const owner = await prisma.team.findUnique({ where: { name: team } });
  if (!owner) {
    return NextResponse.json({ error: `There is no team called "${team}".` }, { status: 404 });
  }
  await prisma.toolGrant.upsert({
    where: { teamId_tool: { teamId: owner.id, tool } },
    create: { teamId: owner.id, tool, allowed },
    update: { allowed },
  });
  return NextResponse.json({ tool, team, allowed });
}

/**
 * Drop a rule, rather than setting it either way.
 *
 * Not the same as refusing: removing a person's rule puts them back on whatever
 * their team has, and removing a team's last rule puts that team back to having
 * everything. Worth having, because otherwise the only way out of a mistake is
 * another rule on top of it.
 */
export async function DELETE(request: Request) {
  const denied = requireStaff(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const tool = typeof body?.tool === "string" ? body.tool.trim() : "";
  const team = typeof body?.team === "string" ? body.team.trim() : "";
  const member = typeof body?.member === "string" ? body.member.trim() : "";
  if (!tool || Boolean(team) === Boolean(member)) {
    return NextResponse.json(
      { error: "Name a tool, and a team or a person." }, { status: 400 });
  }

  if (member) {
    const person = await prisma.member.findUnique({ where: { name: member } });
    if (!person) {
      return NextResponse.json({ error: `There is no login called "${member}".` }, { status: 404 });
    }
    await prisma.toolGrant.deleteMany({ where: { memberId: person.id, tool } });
    return NextResponse.json({ tool, member, rule: "removed" });
  }

  const owner = await prisma.team.findUnique({ where: { name: team } });
  if (!owner) {
    return NextResponse.json({ error: `There is no team called "${team}".` }, { status: 404 });
  }
  await prisma.toolGrant.deleteMany({ where: { teamId: owner.id, tool } });
  return NextResponse.json({ tool, team, rule: "removed" });
}
