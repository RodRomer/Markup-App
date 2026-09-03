import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MARKER_TYPES } from "@/lib/markerTypes";
import { toMarkerData } from "@/lib/types";
import { touchProject } from "@/lib/activity";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json();
  const { pageId, type, x, y, x2, y2, label, note, directions, flipped } = body;

  if (
    typeof pageId !== "string" ||
    !MARKER_TYPES.includes(type) ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof label !== "string"
  ) {
    return NextResponse.json({ error: "Invalid marker" }, { status: 400 });
  }

  if (type === "SECTION" && (typeof x2 !== "number" || typeof y2 !== "number")) {
    return NextResponse.json({ error: "Section markers need a second endpoint" }, { status: 400 });
  }
  const hasSecondPoint =
    (type === "SECTION" || type === "NOTE") && typeof x2 === "number" && typeof y2 === "number";

  if (
    type === "IE" &&
    (!Array.isArray(directions) ||
      directions.length < 1 ||
      directions.length > 4 ||
      !directions.every((d) => typeof d === "number"))
  ) {
    return NextResponse.json({ error: "IE markers need 1-4 directions" }, { status: 400 });
  }

  const page = await prisma.page.findFirst({
    where: { id: pageId, document: { project: { shareToken: token } } },
    include: { document: { include: { project: true } } },
  });

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }
  if (page.document.project.status === "submitted") {
    return NextResponse.json(
      { error: "This markup has already been submitted" },
      { status: 403 }
    );
  }

  const marker = await prisma.marker.create({
    data: {
      pageId,
      type,
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      // SECTION uses x2/y2 as its far endpoint; NOTE uses them as its text-box
      // corner. Both are optional for NOTE -- a plain click places one without a
      // drag, and revisionBoxPosition() falls back to a default offset.
      x2: hasSecondPoint ? Math.min(1, Math.max(0, x2)) : null,
      y2: hasSecondPoint ? Math.min(1, Math.max(0, y2)) : null,
      label,
      note: typeof note === "string" ? note : null,
      flipped: type === "SECTION" && flipped === true,
      directions:
        type === "IE"
          ? { create: directions.map((angle: number, order: number) => ({ angle, order })) }
          : undefined,
    },
    include: { directions: { orderBy: { order: "asc" } } },
  });

  await touchProject(token);
  return NextResponse.json(toMarkerData(marker));
}
