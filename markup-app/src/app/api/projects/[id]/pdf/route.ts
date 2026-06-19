import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toProjectData } from "@/lib/types";
import { generateProjectPdf } from "@/lib/exportPdf";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      documents: {
        include: {
          pages: { include: { markers: { include: { directions: { orderBy: { order: "asc" } } } } } },
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.status !== "submitted") {
    return NextResponse.json({ error: "Project has not been submitted yet" }, { status: 403 });
  }

  const pdfBytes = await generateProjectPdf(toProjectData(project));
  const filename = `${project.name.replace(/[^a-z0-9\- _]/gi, "_")}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
