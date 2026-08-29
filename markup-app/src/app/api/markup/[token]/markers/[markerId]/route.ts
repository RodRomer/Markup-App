import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toMarkerData } from "@/lib/types";

async function loadEditableMarker(token: string, markerId: string) {
  const marker = await prisma.marker.findFirst({
    where: { id: markerId, page: { document: { project: { shareToken: token } } } },
    include: { page: { include: { document: { include: { project: true } } } } },
  });
  return marker;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string; markerId: string }> }
) {
  const { token, markerId } = await params;
  const marker = await loadEditableMarker(token, markerId);

  if (!marker) {
    return NextResponse.json({ error: "Marker not found" }, { status: 404 });
  }
  if (marker.page.document.project.status === "submitted") {
    return NextResponse.json(
      { error: "This markup has already been submitted" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const data: {
    x?: number;
    y?: number;
    x2?: number;
    y2?: number;
    note?: string | null;
    boxWidth?: number | null;
    flipped?: boolean;
  } = {};
  if (typeof body.x === "number") data.x = Math.min(1, Math.max(0, body.x));
  if (typeof body.y === "number") data.y = Math.min(1, Math.max(0, body.y));
  if (typeof body.x2 === "number") data.x2 = Math.min(1, Math.max(0, body.x2));
  if (typeof body.y2 === "number") data.y2 = Math.min(1, Math.max(0, body.y2));
  if (typeof body.note === "string" || body.note === null) data.note = body.note;
  if (typeof body.boxWidth === "number") data.boxWidth = Math.min(0.9, Math.max(0.05, body.boxWidth));
  else if (body.boxWidth === null) data.boxWidth = null;
  if (typeof body.flipped === "boolean") data.flipped = body.flipped;

  const directions = body.directions;
  const hasDirections =
    Array.isArray(directions) &&
    directions.length >= 1 &&
    directions.length <= 4 &&
    directions.every((d) => typeof d === "number");

  if (Array.isArray(directions) && !hasDirections) {
    return NextResponse.json({ error: "IE markers need 1-4 directions" }, { status: 400 });
  }

  const updated = hasDirections
    ? (
        await prisma.$transaction([
          prisma.markerDirection.deleteMany({ where: { markerId } }),
          prisma.marker.update({
            where: { id: markerId },
            data: {
              ...data,
              directions: { create: directions.map((angle: number, order: number) => ({ angle, order })) },
            },
            include: { directions: { orderBy: { order: "asc" } } },
          }),
        ])
      )[1]
    : await prisma.marker.update({
        where: { id: markerId },
        data,
        include: { directions: { orderBy: { order: "asc" } } },
      });

  return NextResponse.json(toMarkerData(updated));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ token: string; markerId: string }> }
) {
  const { token, markerId } = await params;
  const marker = await loadEditableMarker(token, markerId);

  if (!marker) {
    return NextResponse.json({ error: "Marker not found" }, { status: 404 });
  }
  if (marker.page.document.project.status === "submitted") {
    return NextResponse.json(
      { error: "This markup has already been submitted" },
      { status: 403 }
    );
  }

  await prisma.marker.delete({ where: { id: markerId } });
  return NextResponse.json({ ok: true });
}
