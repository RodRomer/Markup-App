import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteFile } from "@/lib/storage";
import { toProjectData } from "@/lib/types";
import { requireStaff } from "@/lib/staffAuth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireStaff(request);
  if (denied) return denied;
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

  return NextResponse.json({ ...toProjectData(project), createdAt: project.createdAt.toISOString(), lastActivityAt: project.lastActivityAt.toISOString() });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await params;
  const body = await request.json();

  const data: { allowIE?: boolean; allowSection?: boolean; pricePerIE?: number | null } = {};
  if (typeof body.allowIE === "boolean") data.allowIE = body.allowIE;
  if (typeof body.allowSection === "boolean") data.allowSection = body.allowSection;

  // Three states, and they have to stay three. Absent leaves the price alone;
  // null clears it, so the client sees no pricing at all; 0 is a stated
  // allowance of nothing and shows as one. Collapsing null and 0 here would
  // make "free" and "not priced" the same thing on the client's screen.
  if (body.pricePerIE === null) {
    data.pricePerIE = null;
  } else if (typeof body.pricePerIE === "number") {
    if (!Number.isFinite(body.pricePerIE) || body.pricePerIE < 0) {
      return NextResponse.json({ error: "pricePerIE must be zero or more" }, { status: 400 });
    }
    data.pricePerIE = body.pricePerIE;
  }

  const project = await prisma.project.update({ where: { id }, data });
  return NextResponse.json({
    allowIE: project.allowIE,
    allowSection: project.allowSection,
    pricePerIE: project.pricePerIE,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireStaff(request);
  if (denied) return denied;
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: { documents: { include: { pages: true } } },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const pages = project.documents.flatMap((d) => d.pages);

  await prisma.project.delete({ where: { id } });

  // After the record is gone, for the same reason as the page delete: the
  // images used to go first, so a delete that failed left a project that was
  // still shareable and whose every page had lost its plan.
  await Promise.all(pages.map((p) => deleteFile(p.imagePath.replace(/^\/uploads\//, ""))));

  return NextResponse.json({ ok: true });
}
