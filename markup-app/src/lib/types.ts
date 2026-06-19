import type { MarkerType } from "./markerTypes";

export type MarkerData = {
  id: string;
  pageId: string;
  type: MarkerType;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  flipped: boolean;
  directions: number[];
  label: string;
  note: string | null;
};

export type PageData = {
  id: string;
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  kind: "image" | "pdf";
  markers: MarkerData[];
};

export type ProjectData = {
  id: string;
  name: string;
  shareToken: string;
  status: string;
  allowIE: boolean;
  allowSection: boolean;
  pages: PageData[];
};

type MarkerWithRelations = {
  id: string;
  pageId: string;
  type: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  flipped: boolean;
  label: string;
  note: string | null;
  directions: { angle: number; order: number }[];
};

/** Flattens Prisma's Marker (with its directions relation) into the plain shape the client expects. */
export function toMarkerData(m: MarkerWithRelations): MarkerData {
  return {
    id: m.id,
    pageId: m.pageId,
    type: m.type as MarkerType,
    x: m.x,
    y: m.y,
    x2: m.x2,
    y2: m.y2,
    flipped: m.flipped,
    directions: [...m.directions].sort((a, b) => a.order - b.order).map((d) => d.angle),
    label: m.label,
    note: m.note,
  };
}

type ProjectWithRelations = {
  id: string;
  name: string;
  shareToken: string;
  status: string;
  allowIE: boolean;
  allowSection: boolean;
  documents: {
    kind: string;
    pages: {
      id: string;
      pageNumber: number;
      imagePath: string;
      width: number;
      height: number;
      markers: (MarkerWithRelations & { createdAt: Date })[];
    }[];
  }[];
};

/** Flattens Prisma's documents[].pages[] tree into a single sorted page list for the editor. */
export function toProjectData(project: ProjectWithRelations): ProjectData {
  const pages = project.documents
    .flatMap((d) => d.pages.map((p) => ({ ...p, kind: d.kind as "image" | "pdf" })))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      imagePath: p.imagePath,
      width: p.width,
      height: p.height,
      kind: p.kind,
      markers: [...p.markers]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(toMarkerData),
    }));

  return {
    id: project.id,
    name: project.name,
    shareToken: project.shareToken,
    status: project.status,
    allowIE: project.allowIE,
    allowSection: project.allowSection,
    pages,
  };
}
