import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const project = await prisma.project.findUnique({ where: { shareToken: token } });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const pageId: string | undefined = body?.pageId;

  await prisma.marker.deleteMany({
    where: pageId
      ? { pageId, page: { document: { projectId: project.id } } }
      : { page: { document: { projectId: project.id } } },
  });

  return NextResponse.json({ ok: true });
}
