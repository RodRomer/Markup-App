import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const data: { allowIE?: boolean; allowSection?: boolean } = {};
  if (typeof body.allowIE === "boolean") data.allowIE = body.allowIE;
  if (typeof body.allowSection === "boolean") data.allowSection = body.allowSection;

  const project = await prisma.project.update({ where: { id }, data });
  return NextResponse.json({ allowIE: project.allowIE, allowSection: project.allowSection });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { documents: { include: { pages: true } } },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const pages = project.documents.flatMap((d) => d.pages);
  await Promise.all(pages.map((p) => deleteFile(p.imagePath.replace(/^\/uploads\//, ""))));

  await prisma.project.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
