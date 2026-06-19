import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const project = await prisma.project.findUnique({ where: { shareToken: token } });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { status: "sent" },
  });

  return NextResponse.json(updated);
}
