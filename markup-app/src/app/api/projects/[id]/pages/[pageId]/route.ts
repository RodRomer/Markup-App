import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> }
) {
  const { id, pageId } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { documents: { include: { pages: true } } },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const allPages = project.documents.flatMap((d) => d.pages);
  const page = allPages.find((p) => p.id === pageId);

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }
  if (allPages.length <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the only page — delete the whole project instead." },
      { status: 400 }
    );
  }

  await deleteFile(page.imagePath.replace(/^\/uploads\//, ""));

  const remaining = allPages
    .filter((p) => p.id !== pageId)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  await prisma.$transaction([
    prisma.page.delete({ where: { id: pageId } }),
    ...remaining.map((p, i) =>
      prisma.page.update({ where: { id: p.id }, data: { pageNumber: i + 1 } })
    ),
  ]);

  return NextResponse.json({ ok: true });
}
