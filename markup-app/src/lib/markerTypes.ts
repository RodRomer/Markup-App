export type MarkerType = "IE" | "SECTION" | "NOTE";

export const MARKER_TYPES: MarkerType[] = ["IE", "SECTION", "NOTE"];

export const MARKER_TYPE_INFO: Record<
  MarkerType,
  { label: string; shortLabel: string; color: string }
> = {
  // Light/print ramp: magenta 320, blue 220, red 356. Hues chosen for the best
  // worst-case separation -- IE sits dE 65 from Section and dE 59 from Revision,
  // where a violet IE would have been only dE 35 from Section blue. They are
  // near-identical in greyscale though, so a photocopied plan is legible only
  // because the SHAPES differ -- wedge-armed dot, flagged line, boxed callout.
  // Keep that in mind before simplifying any marker geometry.
  IE: { label: "IE", shortLabel: "IE", color: "#b81e85" },
  SECTION: { label: "Section", shortLabel: "S", color: "#2466eb" },
  // Red by drafting convention for revisions.
  NOTE: { label: "Revision", shortLabel: "R", color: "#d3222e" },
};


/** Offsets for click-placed revisions. Successive callouts on the same page step
 * through these instead of all landing on the identical spot, which previously
 * buried each new box under the last one. Eight positions around the point, then
 * it wraps -- by then they are far enough apart to drag without hunting. */
export const REVISION_BOX_OFFSETS = [
  { dx: 0.07, dy: -0.06 },
  { dx: 0.07, dy: 0.04 },
  { dx: -0.15, dy: -0.06 },
  { dx: -0.15, dy: 0.04 },
  { dx: 0.02, dy: -0.13 },
  { dx: 0.02, dy: 0.10 },
  { dx: 0.10, dy: -0.11 },
  { dx: -0.13, dy: 0.10 },
];

export function defaultRevisionBox(x: number, y: number, seq = 0): { x2: number; y2: number } {
  const o = REVISION_BOX_OFFSETS[seq % REVISION_BOX_OFFSETS.length];
  return {
    x2: Math.min(0.98, Math.max(0, x + o.dx)),
    y2: Math.min(0.98, Math.max(0, y + o.dy)),
  };
}

/** Box position for rendering. Every revision stores x2/y2 at creation time, so the
 * fallback here is only a type guard, not a compatibility path. */
export function revisionBoxPosition(
  m: { x: number; y: number; x2?: number | null; y2?: number | null }
): { x: number; y: number } {
  if (typeof m.x2 === "number" && typeof m.y2 === "number") return { x: m.x2, y: m.y2 };
  const d = defaultRevisionBox(m.x, m.y, 0);
  return { x: d.x2, y: d.y2 };
}


// Helvetica advance widths, units per 1000em, straight from the standard AFM metrics.
// pdf-lib's StandardFonts.Helvetica uses exactly these, so measuring with this table
// makes the on-screen callout wrap in precisely the same places as the exported PDF.
//
// It also has to be deterministic: measuring via canvas gave one answer in the browser
// and a fallback estimate during server rendering, and the two disagreed -- which broke
// hydration and left the page inert.
const HELVETICA_WIDTHS: Record<string, number> = {
  " ":278,"!":278,'"':355,"#":556,$:556,"%":889,"&":667,"'":191,"(":333,")":333,"*":389,
  "+":584,",":278,"-":333,".":278,"/":278,"0":556,"1":556,"2":556,"3":556,"4":556,"5":556,
  "6":556,"7":556,"8":556,"9":556,":":278,";":278,"<":584,"=":584,">":584,"?":556,"@":1015,
  A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,
  O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,
  "[":278,"\\":278,"]":278,"^":469,_:556,"`":333,
  a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,
  o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,
  "{":334,"|":260,"}":334,"~":584,
};

/** Rendered width of `text` at `fontSize`, using Helvetica metrics. Identical on the
 *  server, in the browser, and in the PDF exporter. */
export function helveticaWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += HELVETICA_WIDTHS[ch] ?? 556;
  return (units / 1000) * fontSize;
}

/** Font the revision callout renders in, on screen and in the export. Kept here so
 *  the measuring code and the drawing code can never disagree about it. */
export const REVISION_FONT_FAMILY = "Helvetica, Arial, sans-serif";

/** Wraps to a real measured width instead of a character count. The old estimate of
 *  0.56em per character ran wide, so text broke earlier than it needed to and left a
 *  dead strip down the right of every box. `measure` returns the rendered width of a
 *  string: canvas measureText on screen, widthOfTextAtSize in the PDF. */
export function wrapToWidth(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      // A single word wider than the box has to be broken, or it overflows.
      while (measure(w) > maxWidth && w.length > 1) {
        let cut = w.length;
        while (cut > 1 && measure(w.slice(0, cut)) > maxWidth) cut--;
        if (line) { out.push(line); line = ""; }
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const candidate = line ? line + " " + w : w;
      if (!line || measure(candidate) <= maxWidth) line = candidate;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
