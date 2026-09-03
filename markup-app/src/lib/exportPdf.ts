import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import {
  arrowWedgePoints,
  DOT_RADIUS_FACTOR,
  MARKER_LINE_FACTOR,
  revisionLeader,
  REVISION_TEXT_WIDTH,
  sectionFlagPolygonPoints,
} from "./markerGeometry";
import { helveticaWidth, MARKER_TYPE_INFO, revisionBoxPosition, wrapToWidth } from "./markerTypes";
import type { MarkerData, ProjectData } from "./types";

const LETTER: [number, number] = [612, 792];

// A revision callout shows this many wrapped lines before the rest is only
// readable in the appendix. Matches what the box renders on screen.
const MAX_CALLOUT_LINES = 6;

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
      const lineW = pageData.width * MARKER_LINE_FACTOR;
      const casing = pageData.width * 0.00026;
      for (const [thickness, c] of [
        [lineW + casing * 2, rgb(0, 0, 0)] as const,
        [lineW, color] as const,
      ]) {
        pdfPage.drawLine({
          start: { x: x1, y: flipY(y1) },
          end: { x: x2, y: flipY(y2) },
          thickness,
          color: c,
        });
      }
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
      // Mirrors the on-screen revision callout: leader + arrowhead into a boxed
      // block of text. Geometry and wrapping match MarkupEditor's renderer so the
      // export reads the same as what was marked up. The Notes appendix page still
      // lists every revision in full, since a long note is clipped to its box here.
      const unit = pageData.width * 0.004;
      const tipX = m.x * pageData.width;
      const tipY = m.y * pageData.height;
      const box = revisionBoxPosition(m);
      const bx = box.x * pageData.width;
      const by = box.y * pageData.height;

      const color = hexToRgb(MARKER_TYPE_INFO.NOTE.color);
      const fontSize = unit * 2.4;
      const pad = unit * 1.7;
      const lineH = fontSize * 1.28;
      const noteText = (m.note ?? "").trim();
      // Same rule as the canvas, measured with the real font metrics rather than a
      // per-character estimate, so screen and print break in the same places.
      const measure = (t: string) => helveticaWidth(t, fontSize);
      const maxTextW =
        m.boxWidth != null ? m.boxWidth * pageData.width - pad * 2 : pageData.width * REVISION_TEXT_WIDTH;
      const lines = noteText ? wrapToWidth(noteText, maxTextW, measure) : [];
      const rows = [m.label, ...lines];
      const autoW = Math.max(...rows.map(measure)) + pad * 2;
      const boxW = m.boxWidth != null ? m.boxWidth * pageData.width : autoW;
      const boxH = pad * 2 + lineH * rows.length;

      // Where the leader leaves the box, where it stops short of the arrowhead,
      // and the head itself. This used to be worked out here as well as on
      // screen and again in the tool palette's icon -- three copies of one
      // drawing, which is how the icon ended up running its line through the
      // arrowhead long after the other two had stopped doing that.
      const leader = revisionLeader(
        { x: tipX, y: tipY },
        { x: bx, y: by, width: boxW, height: boxH },
        unit * 3.2
      );
      const { x: edgeX, y: edgeY } = leader.start;
      const { x: lineEndX, y: lineEndY } = leader.end;
      const outline = unit * 0.13;
      for (const [thickness, c] of [
        [pageData.width * MARKER_LINE_FACTOR + outline * 2, rgb(0, 0, 0)] as const,
        [pageData.width * MARKER_LINE_FACTOR, color] as const,
      ]) {
        pdfPage.drawLine({
          start: { x: edgeX, y: flipY(edgeY) },
          end: { x: lineEndX, y: flipY(lineEndY) },
          thickness,
          color: c,
        });
      }

      pdfPage.drawSvgPath(
        pointsToSvgPath(leader.arrow),
        { x: 0, y: pageData.height, color, borderColor: rgb(0, 0, 0), borderWidth: outline }
      );

      // Black hairline outside the coloured border, so the box reads the same way the
      // IE dot and Section flags do.
      pdfPage.drawRectangle({
        x: bx,
        y: flipY(by + boxH),
        width: boxW,
        height: boxH,
        color: rgb(1, 1, 1),
        opacity: 0.95,
        borderColor: rgb(0, 0, 0),
        borderWidth: unit * 0.6 + outline * 2,
      });
      pdfPage.drawRectangle({
        x: bx,
        y: flipY(by + boxH),
        width: boxW,
        height: boxH,
        borderColor: color,
        borderWidth: unit * 0.6,
      });

      rows.forEach((row, i) => {
        pdfPage.drawText(row, {
          x: bx + pad,
          y: flipY(by + pad + lineH * i + fontSize * 0.92),
          size: fontSize,
          font,
          color: i === 0 ? color : rgb(0.07, 0.09, 0.15),
        });
      });
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
        // Revision text is drawn in its callout on the plan now, so repeating every
        // note in the appendix just duplicated the drawing. Only notes long enough
        // to be clipped by their box still need listing in full; IE and Section
        // notes have no callout of their own, so those always get listed.
        const clipped =
          m.type !== "NOTE" ||
          wrapToWidth(m.note.trim(), pageData.width * REVISION_TEXT_WIDTH, (t) =>
            helveticaWidth(t, pageData.width * 0.004 * 2.4)
          ).length > MAX_CALLOUT_LINES;
        if (clipped) {
          notesByPage.push({ pageNumber: pageData.pageNumber, label: m.label, note: m.note.trim() });
        }
      }
    }
  }

  if (notesByPage.length > 0) {
    let notesPage = pdfDoc.addPage(LETTER);
    let y = LETTER[1] - 60;
    notesPage.drawText("Notes continued", { x: 50, y, size: 18, font, color: rgb(0, 0, 0) });
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

  // A legend page. Whoever receives this PDF sees magenta dots, blue lines and red
  // callouts with nothing explaining them, and the three marker colours are almost
  // identical in greyscale -- so the legend describes each by SHAPE first, which is
  // what actually survives a photocopy.
  {
    const legend = pdfDoc.addPage(LETTER);
    const ph = LETTER[1];
    let y = ph - 70;
    legend.drawText("Marker legend", { x: 50, y, size: 18, font, color: rgb(0, 0, 0) });
    y -= 34;

    const swatchX = 60;
    const textX = 150;
    const rows: { draw: (cy: number) => void; title: string; body: string }[] = [
      {
        title: "IE — Interior Elevation",
        body: "A dot with wedge arrows. Each arrow points at a wall that needs an interior elevation drawing.",
        draw: (cy) => {
          const c = hexToRgb(MARKER_TYPE_INFO.IE.color);
          for (const angle of [0, 90, 180, 270]) {
            legend.drawSvgPath(pointsToSvgPath(arrowWedgePoints(swatchX + 22, ph - cy, angle, 15)), {
              x: 0, y: ph, color: c, borderColor: rgb(0, 0, 0), borderWidth: 0.6,
            });
          }
          legend.drawEllipse({ x: swatchX + 22, y: cy, xScale: 15 * DOT_RADIUS_FACTOR,
            yScale: 15 * DOT_RADIUS_FACTOR, color: c, borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
        },
      },
      {
        title: "Section",
        body: "A line with a flag at each end. The line is the cut; the flags show which way the section looks.",
        draw: (cy) => {
          const c = hexToRgb(MARKER_TYPE_INFO.SECTION.color);
          legend.drawLine({ start: { x: swatchX, y: cy }, end: { x: swatchX + 60, y: cy }, thickness: 2, color: c });
          for (const ep of ["start", "end"] as const) {
            legend.drawSvgPath(
              pointsToSvgPath(sectionFlagPolygonPoints(swatchX, ph - cy, swatchX + 60, ph - cy, ep, false, 12)),
              { x: 0, y: ph, color: c, borderColor: rgb(0, 0, 0), borderWidth: 0.6 }
            );
          }
          // The endpoint dots the real marker has. Without them the flags read as
          // detached from the line, because each wedge's base sits on the dot's circle.
          for (const ex of [swatchX, swatchX + 60]) {
            legend.drawEllipse({ x: ex, y: cy, xScale: 12 * DOT_RADIUS_FACTOR, yScale: 12 * DOT_RADIUS_FACTOR,
              color: c, borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
          }
        },
      },
      {
        title: "Revision",
        body: "A red leader into a text box. The arrow points at what changes; the box says what to change.",
        draw: (cy) => {
          const c = hexToRgb(MARKER_TYPE_INFO.NOTE.color);
          legend.drawLine({ start: { x: swatchX, y: cy - 8 }, end: { x: swatchX + 34, y: cy + 6 }, thickness: 1.8, color: c });
          legend.drawSvgPath(
            pointsToSvgPath([
              { x: swatchX, y: ph - (cy - 8) },
              { x: swatchX + 11, y: ph - (cy - 6) },
              { x: swatchX + 8, y: ph - (cy + 1) },
            ]),
            { x: 0, y: ph, color: c, borderWidth: 0 }
          );
          legend.drawRectangle({ x: swatchX + 34, y: cy - 4, width: 46, height: 20,
            color: rgb(1, 1, 1), borderColor: c, borderWidth: 1.4 });
        },
      },
    ];

    for (const row of rows) {
      row.draw(y + 4);
      legend.drawText(row.title, { x: textX, y: y + 10, size: 12, font, color: rgb(0, 0, 0) });
      for (const [i, line] of wrapText(row.body, 62).entries()) {
        legend.drawText(line, { x: textX, y: y - 4 - i * 13, size: 10, font, color: rgb(0.25, 0.25, 0.25) });
      }
      y -= 66;
    }

    legend.drawText(
      "Marker colours are nearly identical in greyscale — if this is printed in black and white, tell them apart by shape.",
      { x: 50, y: 60, size: 9, font, color: rgb(0.4, 0.4, 0.4) }
    );
  }

  return pdfDoc.save();
}
