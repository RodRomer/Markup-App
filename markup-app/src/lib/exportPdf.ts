import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import { arrowWedgePoints, DOT_RADIUS_FACTOR, sectionFlagPolygonPoints } from "./markerGeometry";
import { MARKER_TYPE_INFO, noteNumber } from "./markerTypes";
import type { MarkerData, ProjectData } from "./types";

const LETTER: [number, number] = [612, 792];

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isJpeg(bytes: Buffer) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function pointsToSvgPath(points: { x: number; y: number }[]) {
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(" ")} Z`;
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function loadImageBytes(imagePath: string): Promise<Buffer> {
  return imagePath.startsWith("http")
    ? Buffer.from(await (await fetch(imagePath)).arrayBuffer())
    : readFile(path.join(process.cwd(), "public", imagePath));
}

export async function generateProjectPdf(project: ProjectData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const notesByPage: { pageNumber: number; label: string; note: string }[] = [];

  // Fetching every page's image (often from Blob storage over the network) is
  // the slow part — doing it for all pages at once instead of one-at-a-time
  // turns N sequential round trips into 1.
  const imageBytesByPage = await Promise.all(project.pages.map((p) => loadImageBytes(p.imagePath)));

  for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex++) {
    const pageData = project.pages[pageIndex];
    const imageBytes = imageBytesByPage[pageIndex];
    const image = isJpeg(imageBytes)
      ? await pdfDoc.embedJpg(imageBytes)
      : await pdfDoc.embedPng(imageBytes);

    const pdfPage = pdfDoc.addPage([pageData.width, pageData.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: pageData.width, height: pageData.height });

    const pageHeight = pageData.height;
    const flipY = (y: number) => pageHeight - y;

    function drawSection(m: MarkerData) {
      const x1 = m.x * pageData.width;
      const y1 = m.y * pageData.height;
      const x2 = m.x2! * pageData.width;
      const y2 = m.y2! * pageData.height;
      const color = hexToRgb(MARKER_TYPE_INFO.SECTION.color);
      const flagSize = pageData.width * 0.01;
      pdfPage.drawLine({
        start: { x: x1, y: flipY(y1) },
        end: { x: x2, y: flipY(y2) },
        thickness: pageData.width * 0.0022,
        color,
      });
      for (const endpoint of ["start", "end"] as const) {
        const pts = sectionFlagPolygonPoints(x1, y1, x2, y2, endpoint, m.flipped, flagSize);
        pdfPage.drawSvgPath(pointsToSvgPath(pts), {
          x: 0,
          y: pageHeight,
          color,
          borderColor: rgb(0, 0, 0),
          borderWidth: flagSize * 0.06,
        });
      }
      const dotRadius = flagSize * DOT_RADIUS_FACTOR;
      for (const [dx, dy] of [[x1, y1], [x2, y2]]) {
        pdfPage.drawEllipse({
          x: dx,
          y: flipY(dy),
          xScale: dotRadius,
          yScale: dotRadius,
          color,
          borderColor: rgb(0, 0, 0),
          borderWidth: dotRadius * 0.12,
        });
      }
    }

    function drawIE(m: MarkerData) {
      const cx = m.x * pageData.width;
      const cy = m.y * pageData.height;
      const size = pageData.width * 0.008;
      const color = hexToRgb(MARKER_TYPE_INFO.IE.color);
      const black = rgb(0, 0, 0);
      for (const angle of m.directions) {
        const pts = arrowWedgePoints(cx, cy, angle, size);
        pdfPage.drawSvgPath(pointsToSvgPath(pts), {
          x: 0,
          y: pageHeight,
          color,
          borderColor: black,
          borderWidth: size * 0.06,
        });
      }
      pdfPage.drawEllipse({
        x: cx,
        y: flipY(cy),
        xScale: size * DOT_RADIUS_FACTOR,
        yScale: size * DOT_RADIUS_FACTOR,
        color,
        borderColor: black,
        borderWidth: size * DOT_RADIUS_FACTOR * 0.12,
      });
    }

    function drawNote(m: MarkerData) {
      const cx = m.x * pageData.width;
      const cy = m.y * pageData.height;
      const size = pageData.width * 0.004;
      pdfPage.drawEllipse({
        x: cx,
        y: flipY(cy),
        xScale: size,
        yScale: size,
        color: hexToRgb(MARKER_TYPE_INFO.NOTE.color),
        borderColor: rgb(0, 0, 0),
        borderWidth: size * 0.12,
      });
      const text = noteNumber(m.label);
      if (text) {
        const fontSize = size * 1.3;
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        pdfPage.drawText(text, {
          x: cx - textWidth / 2,
          y: flipY(cy) - fontSize * 0.36,
          size: fontSize,
          font,
          color: rgb(1, 1, 1),
        });
      }
    }

    if (pageData.kind === "pdf") {
      for (const other of project.pages) {
        if (other.id === pageData.id) continue;
        for (const m of other.markers) {
          if (m.type === "SECTION" && m.x2 != null && m.y2 != null) drawSection(m);
        }
      }
    }

    for (const m of pageData.markers) {
      if (m.type === "SECTION" && m.x2 != null && m.y2 != null) drawSection(m);
      else if (m.type === "IE") drawIE(m);
      else if (m.type === "NOTE") drawNote(m);

      if (m.note && m.note.trim()) {
        notesByPage.push({ pageNumber: pageData.pageNumber, label: m.label, note: m.note.trim() });
      }
    }
  }

  if (notesByPage.length > 0) {
    let notesPage = pdfDoc.addPage(LETTER);
    let y = LETTER[1] - 60;
    notesPage.drawText("Notes & Details", { x: 50, y, size: 18, font, color: rgb(0, 0, 0) });
    y -= 36;

    let currentPageNumber: number | null = null;
    for (const entry of notesByPage) {
      if (entry.pageNumber !== currentPageNumber) {
        currentPageNumber = entry.pageNumber;
        notesPage.drawText(`Page ${entry.pageNumber}`, {
          x: 50,
          y,
          size: 13,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 20;
      }
      const lines = wrapText(`${entry.label}: ${entry.note}`, 90);
      for (const line of lines) {
        if (y < 50) {
          notesPage = pdfDoc.addPage(LETTER);
          y = LETTER[1] - 60;
        }
        notesPage.drawText(line, { x: 60, y, size: 11, font, color: rgb(0, 0, 0) });
        y -= 16;
      }
      y -= 8;
    }
  }

  return pdfDoc.save();
}
