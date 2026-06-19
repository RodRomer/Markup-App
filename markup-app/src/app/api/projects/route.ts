import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";

type PageMeta = { width: number; height: number };

export async function POST(request: Request) {
  const formData = await request.formData();

  const name = formData.get("name");
  const kind = formData.get("kind");
  const originalFilename = formData.get("originalFilename");
  const metaRaw = formData.get("meta");
  const allowIE = formData.get("allowIE") !== "false";
  const allowSection = formData.get("allowSection") !== "false";

  if (
    typeof name !== "string" ||
    !name.trim() ||
    (kind !== "image" && kind !== "pdf") ||
    typeof originalFilename !== "string" ||
    typeof metaRaw !== "string"
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const meta: PageMeta[] = JSON.parse(metaRaw);
  if (!Array.isArray(meta) || meta.length === 0) {
    return NextResponse.json({ error: "No pages provided" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: { name: name.trim(), status: "sent", allowIE, allowSection },
  });

  const document = await prisma.document.create({
    data: { projectId: project.id, originalFilename, kind },
  });

  for (let i = 0; i < meta.length; i++) {
    const file = formData.get(`file-${i}`);
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: `Missing file for page ${i}` },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `${document.id}-${i}.png`;
    const imagePath = await saveFile(key, buffer);

    await prisma.page.create({
      data: {
        documentId: document.id,
        pageNumber: i + 1,
        imagePath,
        width: Math.round(meta[i].width),
        height: Math.round(meta[i].height),
      },
    });
  }

  return NextResponse.json({
    id: project.id,
    shareToken: project.shareToken,
  });
}
