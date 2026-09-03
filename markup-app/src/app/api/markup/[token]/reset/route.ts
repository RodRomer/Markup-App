import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resetScopeFrom } from "@/lib/resetScope";
import { touchProject } from "@/lib/activity";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const project = await prisma.project.findUnique({ where: { shareToken: token } });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // request.text(), not request.json() -- a body that fails to parse has to be
  // distinguishable from a body that asked for everything, and .json().catch()
  // made them the same thing. See lib/resetScope.
  const scope = resetScopeFrom(await request.text());
  if (scope.kind === "invalid") {
    return NextResponse.json({ error: scope.reason }, { status: 400 });
  }

  const inThisProject = { page: { document: { projectId: project.id } } };
  const { count } = await prisma.marker.deleteMany({
    where: scope.kind === "page"
      ? { pageId: scope.pageId, ...inThisProject }
      : inThisProject,
  });

  // The caller is told which of the two things happened and how much went,
  // so "reset this page" quietly clearing the project cannot pass unnoticed.
  await touchProject(token);
  return NextResponse.json({ ok: true, scope: scope.kind, deleted: count });
}
