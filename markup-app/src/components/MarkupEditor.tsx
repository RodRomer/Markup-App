"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MARKER_TYPES, MARKER_TYPE_INFO, type MarkerType } from "@/lib/markerTypes";
import {
  arrowTipPoint,
  arrowWedgePoints,
  DOT_RADIUS_FACTOR,
  sectionFlagPolygonPoints,
  snapToCommonAngle,
  toSvgPoints,
} from "@/lib/markerGeometry";
import type { MarkerData, ProjectData } from "@/lib/types";

type DragTarget =
  | { kind: "point"; markerId: string; field: "primary" | "secondary" }
  | { kind: "direction"; markerId: string; index: number; origDirections: number[] }
  | {
      kind: "whole";
      markerId: string;
      startRel: { x: number; y: number };
      orig: { x: number; y: number; x2: number; y2: number };
    };

type Draft = {
  type: MarkerType;
  start: { x: number; y: number };
  startClient: { x: number; y: number };
  current: { x: number; y: number };
  currentClient: { x: number; y: number };
};

const MIN_SECTION_DRAG_PX = 15;
const PAN_CLICK_THRESHOLD_PX = 4;
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const DEFAULT_BASE_WIDTH = 900;
const PAN_HOLD_STEP = 14;
const PAN_HOLD_INTERVAL_MS = 16;
// The single rotation handle sits offset from direction[0] so it doesn't sit
// on top of an arrow — halfway between two arrows, in the diamond's "valley".
const IE_HANDLE_OFFSET_DEG = 45;

type PanDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  moved: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// Friendlier than MARKER_TYPE_INFO's shortLabel ("S") for count displays —
// shortLabel stays tiny on purpose since it's what renders inside the small
// on-canvas marker dot, where space is very tight.
const COUNT_LABEL: Record<MarkerType, string> = { IE: "IE", SECTION: "Section", NOTE: "Note" };

function emptyCounts(): Record<MarkerType, number> {
  return { IE: 0, SECTION: 0, NOTE: 0 };
}

function countByType(markers: MarkerData[]): Record<MarkerType, number> {
  const counts = emptyCounts();
  for (const m of markers) {
    counts[m.type] += m.type === "IE" ? Math.max(1, m.directions.length) : 1;
  }
  return counts;
}

// Miniature rendering of the actual on-canvas symbol, used in the tool
// palette so picking a tool shows what it looks like rather than an
// abstract colored dot.
function ToolIcon({ type }: { type: MarkerType }) {
  const color = MARKER_TYPE_INFO[type].color;
  if (type === "IE") {
    const size = 7;
    return (
      <svg viewBox="0 0 40 40" className="h-6 w-6 shrink-0">
        {[0, 90, 180, 270].map((angle) => (
          <polygon
            key={angle}
            points={toSvgPoints(arrowWedgePoints(20, 20, angle, size))}
            fill={color}
            stroke="black"
            strokeWidth={0.6}
          />
        ))}
        <circle cx={20} cy={20} r={size * DOT_RADIUS_FACTOR} fill={color} stroke="black" strokeWidth={0.6} />
      </svg>
    );
  }
  if (type === "SECTION") {
    const size = 5;
    return (
      <svg viewBox="0 0 40 40" className="h-6 w-6 shrink-0">
        <line x1={7} y1={20} x2={33} y2={20} stroke={color} strokeWidth={1.6} />
        {(["start", "end"] as const).map((endpoint) => (
          <polygon
            key={endpoint}
            points={toSvgPoints(sectionFlagPolygonPoints(7, 20, 33, 20, endpoint, false, size))}
            fill={color}
            stroke="black"
            strokeWidth={0.6}
          />
        ))}
        <circle cx={7} cy={20} r={size * DOT_RADIUS_FACTOR} fill={color} stroke="black" strokeWidth={0.6} />
        <circle cx={33} cy={20} r={size * DOT_RADIUS_FACTOR} fill={color} stroke="black" strokeWidth={0.6} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className="h-6 w-6 shrink-0">
      <circle cx={20} cy={20} r={10} fill={color} />
    </svg>
  );
}

export default function MarkupEditor({
  token,
  project,
  readOnly = false,
  headerExtra,
}: {
  token: string;
  project: ProjectData;
  readOnly?: boolean;
  /** Staff-only header content (back link, share URL, project actions) shown at the top of the ribbon. */
  headerExtra?: React.ReactNode;
}) {
  const [pages, setPages] = useState(project.pages);
  const [status, setStatus] = useState(project.status);
  const [activePageId, setActivePageId] = useState(pages[0]?.id ?? "");
  const [selectedTool, setSelectedTool] = useState<MarkerType | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [baseWidth, setBaseWidth] = useState(DEFAULT_BASE_WIDTH);
  const [instructionsCollapsed, setInstructionsCollapsed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState<"page" | "project" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const zoomWidgetRef = useRef<HTMLDivElement>(null);
  // Mirrors of zoom/pan state for synchronous reads inside the wheel handler.
  // setZoom/setPan must never be nested (one's updater calling the other) —
  // React's StrictMode dev-mode double-invokes updater functions to catch
  // impurity, which silently applied the pan correction twice and made
  // zoom-to-cursor drift away from the actual cursor.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;
  const panDragRef = useRef<PanDragState | null>(null);

  const locked = readOnly || status === "submitted";
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];
  const selectedMarker = selectedMarkerId ? findMarker(selectedMarkerId) ?? null : null;

  // Section lines apply to every page of the document (they're the same cut
  // line viewed from each story), so the page panel shows the project-wide
  // section count rather than just this page's own — IE/Note stay per-page.
  const currentPageCounts = useMemo(() => {
    const counts = countByType(activePage?.markers ?? []);
    counts.SECTION = countByType(pages.flatMap((p) => p.markers)).SECTION;
    return counts;
  }, [activePage, pages]);
  const overallCounts = useMemo(
    () => countByType(pages.flatMap((p) => p.markers)),
    [pages]
  );
  const ghostSections = useMemo(() => {
    if (!activePage || activePage.kind !== "pdf") return [];
    return pages
      .filter((p) => p.id !== activePage.id && p.kind === "pdf")
      .flatMap((p) => p.markers)
      .filter((m) => m.type === "SECTION" && m.x2 != null && m.y2 != null);
  }, [pages, activePage]);

  function computeFitWidth() {
    const viewport = outerRef.current;
    if (!viewport || !activePage) return DEFAULT_BASE_WIDTH;
    const vw = viewport.clientWidth * 0.96;
    const vh = viewport.clientHeight * 0.96;
    if (vw <= 0 || vh <= 0) return DEFAULT_BASE_WIDTH;
    const aspect = activePage.width / activePage.height;
    return Math.max(200, Math.min(vw, vh * aspect));
  }

  function centerPan(z: number) {
    const viewport = outerRef.current;
    const content = containerRef.current;
    if (!viewport || !content) return { x: 0, y: 0 };
    return {
      x: (viewport.clientWidth - content.offsetWidth * z) / 2,
      y: (viewport.clientHeight - content.offsetHeight * z) / 2,
    };
  }

  // Fit the plan to the viewport (and reset zoom) whenever the active page changes.
  useEffect(() => {
    setBaseWidth(computeFitWidth());
    setZoom(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  // Once the fit width actually lands in the DOM, center the view around it.
  // Also covers the case where the image was already cached (no fresh "load"
  // event) — the <img onLoad> handler below covers the slow-load case.
  useEffect(() => {
    setPan(centerPan(zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseWidth]);

  // Keep the plan filling the viewport if the window is resized.
  useEffect(() => {
    function onResize() {
      setBaseWidth(computeFitWidth());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage]);

  // Clicking anywhere outside the canvas and outside the ribbon/zoom widget
  // clears the current selection — including the rest of the page for the
  // staff embed, since that view has no ribbon of its own.
  useEffect(() => {
    if (!selectedMarkerId) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (outerRef.current?.contains(target)) return;
      if (ribbonRef.current?.contains(target)) return;
      if (zoomWidgetRef.current?.contains(target)) return;
      setSelectedMarkerId(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [selectedMarkerId]);

  // Escape clears the current selection; Delete/Backspace removes the
  // selected marker — skipped while typing in a text field (e.g. the note).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        setSelectedMarkerId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedMarkerId && !locked) {
        e.preventDefault();
        handleDeleteMarker(selectedMarkerId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedMarkerId, locked]);

  function updatePageMarkers(pageId: string, updater: (markers: MarkerData[]) => MarkerData[]) {
    setPages((prev) =>
      prev.map((p) => (p.id === pageId ? { ...p, markers: updater(p.markers) } : p))
    );
  }

  // A section line can be edited from any page it's visible on (its own page,
  // or as a cross-page reference) — these look up/update a marker by id alone,
  // regardless of which page actually owns it.
  function findMarker(markerId: string): MarkerData | undefined {
    for (const p of pages) {
      const m = p.markers.find((mk) => mk.id === markerId);
      if (m) return m;
    }
    return undefined;
  }

  function updateMarkerById(markerId: string, updater: (m: MarkerData) => MarkerData) {
    setPages((prev) =>
      prev.map((p) => ({ ...p, markers: p.markers.map((m) => (m.id === markerId ? updater(m) : m)) }))
    );
  }

  function relativePosition(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function nextLabel(type: MarkerType) {
    const count = (activePage?.markers ?? []).filter((m) => m.type === type).length + 1;
    return `${MARKER_TYPE_INFO[type].label} ${count}`;
  }

  async function patchMarker(markerId: string, body: Record<string, unknown>) {
    try {
      await fetch(`/api/markup/${token}/markers/${markerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setError("Failed to save change");
    }
  }

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const prevZoom = zoomRef.current;
      const prevPan = panRef.current;
      const newZoom = clamp(
        prevZoom + (e.deltaY > 0 ? -ZOOM_STEP / 2 : ZOOM_STEP / 2),
        ZOOM_MIN,
        ZOOM_MAX
      );
      if (newZoom === prevZoom) return;
      const ratio = newZoom / prevZoom;
      const newPan =
        newZoom === ZOOM_MIN
          ? centerPan(newZoom)
          : {
              x: cursorX - (cursorX - prevPan.x) * ratio,
              y: cursorY - (cursorY - prevPan.y) * ratio,
            };
      zoomRef.current = newZoom;
      panRef.current = newPan;
      setZoom(newZoom);
      setPan(newPan);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [activePageId]);

  // --- Placing new markers (click-drag draft on the canvas), or panning/deselecting when no tool is active ---
  // Attached to the whole viewport (not just the <img>) so panning/deselect work from the gray padding too.

  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (locked || !activePage) return;
    if (selectedTool) {
      handleStartDraft(e);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      moved: false,
    };
  }

  function handleCanvasPointerMove(e: React.PointerEvent) {
    if (draft) {
      handleDraftMove(e);
      return;
    }
    const drag = panDragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD_PX) drag.moved = true;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    }
  }

  function handleCanvasPointerUp(e: React.PointerEvent) {
    if (draft) {
      handleDraftEnd(e);
      return;
    }
    const drag = panDragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      if (!drag.moved) setSelectedMarkerId(null);
      panDragRef.current = null;
    }
  }

  function zoomByButton(delta: number) {
    const prevZoom = zoomRef.current;
    const newZoom = clamp(prevZoom + delta, ZOOM_MIN, ZOOM_MAX);
    if (newZoom === prevZoom || !outerRef.current) return;
    const prevPan = panRef.current;
    const cx = outerRef.current.clientWidth / 2;
    const cy = outerRef.current.clientHeight / 2;
    const ratio = newZoom / prevZoom;
    const newPan =
      newZoom === ZOOM_MIN
        ? centerPan(newZoom)
        : {
            x: cx - (cx - prevPan.x) * ratio,
            y: cy - (cy - prevPan.y) * ratio,
          };
    zoomRef.current = newZoom;
    panRef.current = newPan;
    setZoom(newZoom);
    setPan(newPan);
  }

  // Joystick-style D-pad: an alternative to click-and-drag panning. Holding a
  // direction button pans continuously for as long as it's held.
  const panHoldIntervalRef = useRef<number | null>(null);
  function startPanHold(dx: number, dy: number) {
    stopPanHold();
    panHoldIntervalRef.current = window.setInterval(() => {
      const next = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      panRef.current = next;
      setPan(next);
    }, PAN_HOLD_INTERVAL_MS);
  }
  function stopPanHold() {
    if (panHoldIntervalRef.current !== null) {
      window.clearInterval(panHoldIntervalRef.current);
      panHoldIntervalRef.current = null;
    }
  }
  useEffect(() => stopPanHold, []);

  function handleStartDraft(e: React.PointerEvent) {
    if (locked || !selectedTool || !activePage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = relativePosition(e.clientX, e.clientY);
    const startClient = { x: e.clientX, y: e.clientY };
    setDraft({ type: selectedTool, start, startClient, current: start, currentClient: startClient });
  }

  function handleDraftMove(e: React.PointerEvent) {
    if (!draft) return;
    let current = relativePosition(e.clientX, e.clientY);
    const currentClient = { x: e.clientX, y: e.clientY };
    if (draft.type === "SECTION") {
      const snapped = snapToCommonAngle(current.x - draft.start.x, current.y - draft.start.y);
      current = { x: draft.start.x + snapped.dx, y: draft.start.y + snapped.dy };
    }
    setDraft((prev) => (prev ? { ...prev, current, currentClient } : prev));
  }

  async function handleDraftEnd(e: React.PointerEvent) {
    if (!draft || !activePage) return;
    const final = draft;
    setDraft(null);
    const dist = Math.hypot(
      final.currentClient.x - final.startClient.x,
      final.currentClient.y - final.startClient.y
    );

    let body: Record<string, unknown>;
    if (final.type === "NOTE") {
      body = { pageId: activePage.id, type: "NOTE", x: final.start.x, y: final.start.y, label: nextLabel("NOTE") };
    } else if (final.type === "IE") {
      body = {
        pageId: activePage.id,
        type: "IE",
        x: final.start.x,
        y: final.start.y,
        label: nextLabel("IE"),
        directions: [0, 90, 180, 270],
      };
    } else {
      if (dist < MIN_SECTION_DRAG_PX) return;
      body = {
        pageId: activePage.id,
        type: "SECTION",
        x: final.start.x,
        y: final.start.y,
        x2: final.current.x,
        y2: final.current.y,
        label: nextLabel("SECTION"),
      };
    }

    try {
      const res = await fetch(`/api/markup/${token}/markers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to add marker");
      const marker: MarkerData = await res.json();
      updatePageMarkers(activePage.id, (markers) => [...markers, marker]);
      setSelectedTool(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add marker");
    }
  }

  // --- Dragging existing geometry (a point, or one IE direction arrow) ---

  function handlePointPointerDown(e: React.PointerEvent, markerId: string, field: "primary" | "secondary") {
    if (locked) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedMarkerId(markerId);
    setDragTarget({ kind: "point", markerId, field });
  }

  function handleLinePointerDown(e: React.PointerEvent, markerId: string) {
    if (locked) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedMarkerId(markerId);
    const marker = findMarker(markerId);
    if (!marker || marker.x2 == null || marker.y2 == null) return;
    const startRel = relativePosition(e.clientX, e.clientY);
    setDragTarget({
      kind: "whole",
      markerId,
      startRel,
      orig: { x: marker.x, y: marker.y, x2: marker.x2, y2: marker.y2 },
    });
  }

  function handleDirectionPointerDown(e: React.PointerEvent, markerId: string, index: number) {
    if (locked || !activePage) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setSelectedMarkerId(markerId);
    const marker = activePage.markers.find((m) => m.id === markerId);
    if (!marker) return;
    setDragTarget({ kind: "direction", markerId, index, origDirections: marker.directions });
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!dragTarget) return;
    if (dragTarget.kind === "point") {
      let { x, y } = relativePosition(e.clientX, e.clientY);
      const marker = findMarker(dragTarget.markerId);
      if (marker?.type === "SECTION" && marker.x2 != null && marker.y2 != null) {
        const other = dragTarget.field === "primary" ? { x: marker.x2, y: marker.y2 } : { x: marker.x, y: marker.y };
        const snapped = snapToCommonAngle(x - other.x, y - other.y);
        x = other.x + snapped.dx;
        y = other.y + snapped.dy;
      }
      updateMarkerById(dragTarget.markerId, (m) =>
        dragTarget.field === "primary" ? { ...m, x, y } : { ...m, x2: x, y2: y }
      );
    } else if (dragTarget.kind === "whole") {
      const cur = relativePosition(e.clientX, e.clientY);
      const dx = cur.x - dragTarget.startRel.x;
      const dy = cur.y - dragTarget.startRel.y;
      const { orig } = dragTarget;
      updateMarkerById(dragTarget.markerId, (m) => ({
        ...m,
        x: orig.x + dx,
        y: orig.y + dy,
        x2: orig.x2 + dx,
        y2: orig.y2 + dy,
      }));
    } else {
      const marker = findMarker(dragTarget.markerId);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!marker || !rect) return;
      const centerClientX = rect.left + marker.x * rect.width;
      const centerClientY = rect.top + marker.y * rect.height;
      const snapped = snapToCommonAngle(e.clientX - centerClientX, e.clientY - centerClientY);
      const angle = (Math.atan2(snapped.dy, snapped.dx) * 180) / Math.PI;
      const delta = angle - (dragTarget.origDirections[dragTarget.index] + IE_HANDLE_OFFSET_DEG);
      updateMarkerById(dragTarget.markerId, (m) => ({
        ...m,
        directions: dragTarget.origDirections.map((a) => a + delta),
      }));
    }
  }

  async function handleDragEnd() {
    if (!dragTarget) return;
    const target = dragTarget;
    setDragTarget(null);
    const marker = findMarker(target.markerId);
    if (!marker) return;

    if (target.kind === "point") {
      const body = target.field === "primary" ? { x: marker.x, y: marker.y } : { x2: marker.x2, y2: marker.y2 };
      await patchMarker(marker.id, body);
    } else if (target.kind === "whole") {
      await patchMarker(marker.id, { x: marker.x, y: marker.y, x2: marker.x2, y2: marker.y2 });
    } else {
      await patchMarker(marker.id, { directions: marker.directions });
    }
  }

  // --- Selected-marker panel actions ---

  async function handleDeleteMarker(markerId: string) {
    try {
      const res = await fetch(`/api/markup/${token}/markers/${markerId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete marker");
      setPages((prev) => prev.map((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== markerId) })));
      setSelectedMarkerId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete marker");
    }
  }

  async function handleNoteChange(markerId: string, note: string) {
    updateMarkerById(markerId, (m) => ({ ...m, note }));
    await patchMarker(markerId, { note });
  }

  async function handleAddDirection(markerId: string) {
    if (!activePage) return;
    const marker = activePage.markers.find((m) => m.id === markerId);
    if (!marker || marker.directions.length >= 4) return;
    const lastAngle = marker.directions[marker.directions.length - 1] ?? 0;
    const directions = [...marker.directions, (lastAngle + 90) % 360];
    updatePageMarkers(activePage.id, (markers) => markers.map((m) => (m.id === markerId ? { ...m, directions } : m)));
    await patchMarker(markerId, { directions });
  }

  async function handleRemoveDirection(markerId: string) {
    if (!activePage) return;
    const marker = activePage.markers.find((m) => m.id === markerId);
    if (!marker || marker.directions.length <= 1) return;
    const directions = marker.directions.slice(0, -1);
    updatePageMarkers(activePage.id, (markers) => markers.map((m) => (m.id === markerId ? { ...m, directions } : m)));
    await patchMarker(markerId, { directions });
  }

  async function handleToggleFlip(markerId: string) {
    const marker = findMarker(markerId);
    if (!marker) return;
    const flipped = !marker.flipped;
    setSelectedMarkerId(markerId);
    updateMarkerById(markerId, (m) => ({ ...m, flipped }));
    await patchMarker(markerId, { flipped });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/markup/${token}/submit`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to submit");
      setStatus("submitted");
      setSelectedMarkerId(null);
      setSelectedTool(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(scope: "page" | "project") {
    const confirmText =
      scope === "page"
        ? "Delete all markers on this page? This can't be undone."
        : "Delete all markers across every page? This can't be undone.";
    if (!window.confirm(confirmText)) return;
    setResetting(scope);
    setError(null);
    try {
      const res = await fetch(`/api/markup/${token}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope === "page" && activePage ? { pageId: activePage.id } : {}),
      });
      if (!res.ok) throw new Error("Failed to reset markers");
      if (scope === "page" && activePage) {
        updatePageMarkers(activePage.id, () => []);
      } else {
        setPages((prev) => prev.map((p) => ({ ...p, markers: [] })));
      }
      setSelectedMarkerId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset markers");
    } finally {
      setResetting(null);
    }
  }

  async function handleDeletePage(pageId: string) {
    const target = pages.find((p) => p.id === pageId);
    if (!target) return;
    if (pages.length <= 1) {
      window.alert("Cannot delete the only page — delete the whole project instead.");
      return;
    }
    if (!window.confirm(`Delete page ${target.pageNumber}? This removes its plan and all its markup.`)) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/pages/${pageId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to delete page");
      setPages((prev) => {
        const next = prev
          .filter((p) => p.id !== pageId)
          .sort((a, b) => a.pageNumber - b.pageNumber)
          .map((p, i) => ({ ...p, pageNumber: i + 1 }));
        if (activePageId === pageId) setActivePageId(next[0]?.id ?? "");
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete page");
    }
  }

  const placementHint =
    selectedTool === "NOTE"
      ? "Click the document to place a Note"
      : selectedTool === "IE"
      ? "Click to place an IE Location — it places with all 4 directions; select it afterward to remove the ones you don't need, or drag any arrow to rotate the whole group"
      : selectedTool
      ? `Click and drag on the document to aim the ${MARKER_TYPE_INFO[selectedTool].label}`
      : null;

  const dpadButtonClass =
    "flex h-6 w-6 items-center justify-center rounded text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700";

  const zoomWidget = (
    <div
      ref={zoomWidgetRef}
      className="absolute top-3 right-3 flex flex-col items-center gap-1 rounded-md border border-gray-200 bg-white/90 p-1 text-sm shadow-md backdrop-blur-sm dark:border-gray-600 dark:bg-gray-800/90"
    >
      <div className="grid grid-cols-3 gap-0.5" title="Hold to pan">
        <span />
        <button
          type="button"
          onPointerDown={() => startPanHold(0, PAN_HOLD_STEP)}
          onPointerUp={stopPanHold}
          onPointerLeave={stopPanHold}
          aria-label="Pan up"
          className={dpadButtonClass}
        >
          ▲
        </button>
        <span />
        <button
          type="button"
          onPointerDown={() => startPanHold(PAN_HOLD_STEP, 0)}
          onPointerUp={stopPanHold}
          onPointerLeave={stopPanHold}
          aria-label="Pan left"
          className={dpadButtonClass}
        >
          ◀
        </button>
        <span className="flex items-center justify-center text-gray-300 dark:text-gray-600">•</span>
        <button
          type="button"
          onPointerDown={() => startPanHold(-PAN_HOLD_STEP, 0)}
          onPointerUp={stopPanHold}
          onPointerLeave={stopPanHold}
          aria-label="Pan right"
          className={dpadButtonClass}
        >
          ▶
        </button>
        <span />
        <button
          type="button"
          onPointerDown={() => startPanHold(0, -PAN_HOLD_STEP)}
          onPointerUp={stopPanHold}
          onPointerLeave={stopPanHold}
          aria-label="Pan down"
          className={dpadButtonClass}
        >
          ▼
        </button>
        <span />
      </div>
      <div className="h-px w-full bg-gray-200 dark:bg-gray-600" />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => zoomByButton(-ZOOM_STEP)}
          className="flex h-7 w-7 items-center justify-center rounded-md font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setPan(centerPan(1));
          }}
          className="min-w-[3.5rem] rounded-md px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          title="Fit to screen"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomByButton(ZOOM_STEP)}
          className="flex h-7 w-7 items-center justify-center rounded-md font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );

  // Section lines from other pages of the same PDF render and behave exactly
  // like ones that live on the current page — same style, fully draggable —
  // so they're merged straight into the normal marker list rather than kept
  // as a separate read-only "ghost" layer.
  const renderableMarkers = activePage ? [...activePage.markers, ...ghostSections] : [];

  const canvasArea = activePage && (
    <div className="relative h-full w-full">
      <div
        ref={outerRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        className={`absolute inset-0 touch-none overflow-hidden rounded-t-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 ${
          selectedTool ? "cursor-crosshair" : "cursor-grab"
        }`}
      >
        <div
          ref={containerRef}
          className="relative inline-block select-none"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
        >
          <img
            src={activePage.imagePath}
            alt={`Page ${activePage.pageNumber}`}
            draggable={false}
            onLoad={() => setPan(centerPan(zoom))}
            className="block"
            style={{ width: baseWidth }}
          />

          <svg
            viewBox={`0 0 ${activePage.width} ${activePage.height}`}
            className="absolute inset-0 h-full w-full"
            style={{ pointerEvents: "none" }}
          >
            {renderableMarkers.map((m) => {
              if (m.type === "SECTION" && m.x2 != null && m.y2 != null) {
                const x1 = m.x * activePage.width;
                const y1 = m.y * activePage.height;
                const x2 = m.x2 * activePage.width;
                const y2 = m.y2 * activePage.height;
                const flagSize = activePage.width * 0.02;
                return (
                  <g key={m.id}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="transparent"
                      strokeWidth={activePage.width * 0.014}
                      style={{ pointerEvents: locked ? "none" : "auto", cursor: "move" }}
                      onPointerDown={(e) => handleLinePointerDown(e, m.id)}
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                    />
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={MARKER_TYPE_INFO.SECTION.color}
                      strokeWidth={activePage.width * 0.0022}
                      style={{ pointerEvents: "none" }}
                    />
                    <polygon
                      points={toSvgPoints(sectionFlagPolygonPoints(x1, y1, x2, y2, "start", m.flipped, flagSize))}
                      fill={MARKER_TYPE_INFO.SECTION.color}
                      stroke="black"
                      strokeWidth={flagSize * 0.08}
                      style={{ pointerEvents: locked ? "none" : "auto", cursor: "pointer" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFlip(m.id);
                      }}
                    />
                    <polygon
                      points={toSvgPoints(sectionFlagPolygonPoints(x1, y1, x2, y2, "end", m.flipped, flagSize))}
                      fill={MARKER_TYPE_INFO.SECTION.color}
                      stroke="black"
                      strokeWidth={flagSize * 0.08}
                      style={{ pointerEvents: locked ? "none" : "auto", cursor: "pointer" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFlip(m.id);
                      }}
                    />
                    {[
                      { x: x1, y: y1, field: "primary" as const },
                      { x: x2, y: y2, field: "secondary" as const },
                    ].map(({ x, y, field }) => {
                      const r = flagSize * DOT_RADIUS_FACTOR;
                      return (
                        <g key={field}>
                          {selectedMarkerId === m.id && (
                            <circle cx={x} cy={y} r={r * 1.5} fill="none" stroke="black" strokeWidth={r * 0.2} />
                          )}
                          <circle
                            cx={x}
                            cy={y}
                            r={r}
                            fill={MARKER_TYPE_INFO.SECTION.color}
                            stroke="black"
                            strokeWidth={r * 0.3}
                            style={{ pointerEvents: locked ? "none" : "auto", cursor: locked ? undefined : "move" }}
                            onPointerDown={(e) => handlePointPointerDown(e, m.id, field)}
                            onPointerMove={handleDragMove}
                            onPointerUp={handleDragEnd}
                          >
                            <title>{m.label}</title>
                          </circle>
                        </g>
                      );
                    })}
                  </g>
                );
              }
              if (m.type === "IE") {
                const cx = m.x * activePage.width;
                const cy = m.y * activePage.height;
                const size = activePage.width * 0.008;
                const dotR = size * DOT_RADIUS_FACTOR;
                return (
                  <g key={m.id}>
                    {m.directions.map((angle, i) => (
                      <polygon
                        key={i}
                        points={toSvgPoints(arrowWedgePoints(cx, cy, angle, size))}
                        fill={MARKER_TYPE_INFO.IE.color}
                        stroke="black"
                        strokeWidth={size * 0.08}
                        style={{ pointerEvents: "none" }}
                      />
                    ))}
                    {selectedMarkerId === m.id && (
                      <circle cx={cx} cy={cy} r={dotR * 1.5} fill="none" stroke="black" strokeWidth={dotR * 0.2} />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={dotR}
                      fill={MARKER_TYPE_INFO.IE.color}
                      stroke="black"
                      strokeWidth={dotR * 0.3}
                      style={{ pointerEvents: locked ? "none" : "auto", cursor: locked ? undefined : "move" }}
                      onPointerDown={(e) => handlePointPointerDown(e, m.id, "primary")}
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                    >
                      <title>{m.label}</title>
                    </circle>
                    {!locked &&
                      selectedMarkerId === m.id &&
                      (() => {
                        const handlePos = arrowTipPoint(
                          cx,
                          cy,
                          m.directions[0] + IE_HANDLE_OFFSET_DEG,
                          size * 1.3
                        );
                        const r = Math.max(size * 0.5, 5);
                        return (
                          <g
                            style={{ pointerEvents: "auto", cursor: "grab" }}
                            onPointerDown={(e) => handleDirectionPointerDown(e, m.id, 0)}
                            onPointerMove={handleDragMove}
                            onPointerUp={handleDragEnd}
                          >
                            <circle
                              cx={handlePos.x}
                              cy={handlePos.y}
                              r={r}
                              fill={MARKER_TYPE_INFO.IE.color}
                              stroke="black"
                              strokeWidth={size * 0.15}
                            />
                            <text
                              x={handlePos.x}
                              y={handlePos.y}
                              fontSize={r * 1.5}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill="white"
                              style={{ pointerEvents: "none" }}
                            >
                              ↻
                            </text>
                          </g>
                        );
                      })()}
                  </g>
                );
              }
              return null;
            })}

            {draft && draft.type === "SECTION" && (
              <line
                x1={draft.start.x * activePage.width}
                y1={draft.start.y * activePage.height}
                x2={draft.current.x * activePage.width}
                y2={draft.current.y * activePage.height}
                stroke={MARKER_TYPE_INFO.SECTION.color}
                strokeDasharray="6 4"
                strokeWidth={activePage.width * 0.004}
              />
            )}
          </svg>

          {renderableMarkers
            .filter((m) => m.type === "NOTE")
            .map((m) => (
              <div
                key={m.id}
                onPointerDown={(e) => handlePointPointerDown(e, m.id, "primary")}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
                style={{
                  left: `${m.x * 100}%`,
                  top: `${m.y * 100}%`,
                  background: MARKER_TYPE_INFO[m.type].color,
                  transform: "translate(-50%, -50%)",
                }}
                title={m.label}
                className={`absolute flex h-7 w-7 touch-none items-center justify-center rounded-full border-2 border-black text-xs font-bold text-white shadow ${
                  locked ? "" : "cursor-move"
                } ${selectedMarkerId === m.id ? "ring-2 ring-black ring-offset-1 dark:ring-gray-300" : ""}`}
              >
                {MARKER_TYPE_INFO[m.type].shortLabel}
              </div>
            ))}
        </div>
      </div>
      {zoomWidget}
    </div>
  );

  const errorBanner = error && (
    <div className="rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-red-700 dark:border-gray-700 dark:bg-gray-800 dark:text-red-400">
      {error}
    </div>
  );

  const lockedBanner = locked && (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      <span>
        {status === "submitted"
          ? "This markup has been submitted and is now read-only."
          : "This markup is read-only."}
      </span>
      {!readOnly && status === "submitted" && (
        <a
          href={`/api/markup/${token}/pdf`}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-green-400 dark:hover:bg-gray-700"
        >
          Download PDF
        </a>
      )}
    </div>
  );

  const instructionsPanel = !readOnly && !locked && (
    instructionsCollapsed ? (
      <button
        type="button"
        onClick={() => setInstructionsCollapsed(false)}
        className="flex w-fit items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-900 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-900"
      >
        ⓘ How to mark up this plan ⌄
      </button>
    ) : (
      <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
        <div className="mb-1 flex items-center justify-between">
          <p className="font-semibold">How to mark up this plan</p>
          <button
            type="button"
            onClick={() => setInstructionsCollapsed(true)}
            title="Minimize instructions"
            className="rounded-md px-1.5 py-0.5 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            ⌃
          </button>
        </div>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Pick a marker type below: IE Location, Section Location, or Note.</li>
          <li>
            For IE Location or Note, click anywhere on the plan to place it. For Section
            Location, click and drag to draw the cut line.
          </li>
          <li>
            An IE marker starts with 4 arrows pointing every direction — click it, then drag
            any arrow to rotate the whole group together, or remove the ones you don&apos;t
            need. For an unusual layout, place a second IE marker instead.
          </li>
          <li>
            For a Section line, drag the line itself to move it, or click one of its end flags
            (or use &quot;Flip view direction&quot; below the plan) to flip which way it&apos;s
            looking.
          </li>
          <li>Scroll over the plan to zoom, or drag to pan around.</li>
          <li>
            When everything looks right, click &quot;Submit markup&quot; at the bottom — you
            won&apos;t be able to make changes after that, so double-check first.
          </li>
        </ol>
      </div>
    )
  );

  const allowedMarkerTypes = MARKER_TYPES.filter(
    (type) => type !== "IE" || project.allowIE
  ).filter((type) => type !== "SECTION" || project.allowSection);

  const toolPalette = !locked && (
    <div className="flex flex-col gap-2">
      {allowedMarkerTypes.map((type) => (
        <button
          key={type}
          onClick={() => setSelectedTool(selectedTool === type ? null : type)}
          className={`flex items-center gap-2 rounded-md border-2 px-3 py-1.5 text-sm font-medium ${
            selectedTool === type
              ? "border-gray-900 bg-gray-900 text-white dark:border-gray-300 dark:bg-gray-700 dark:text-gray-100"
              : "border-gray-200 bg-white text-gray-800 hover:border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          <ToolIcon type={type} />
          {MARKER_TYPE_INFO[type].label}
        </button>
      ))}
      {placementHint && <p className="text-sm text-gray-700 dark:text-gray-300">{placementHint}</p>}
    </div>
  );

  const countsPanel = (
    <div className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium text-gray-800 dark:text-gray-200">Page totals:</span>
      {MARKER_TYPES.map((type) => (
        <span key={type}>
          {COUNT_LABEL[type]}: {currentPageCounts[type]}
        </span>
      ))}
    </div>
  );

  const selectedMarkerPanel = selectedMarker && !locked && (
    <div className="rounded-md border bg-white p-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{selectedMarker.label}</span>
        <button
          onClick={() => handleDeleteMarker(selectedMarker.id)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
        >
          Delete marker
        </button>
      </div>

      {selectedMarker.type === "IE" && (
        <div className="mb-2 flex flex-col gap-1.5">
          <span className="text-gray-700 dark:text-gray-300">
            Drag the ↻ handle on the canvas to rotate the whole group.
          </span>
          <div className="flex items-center gap-2">
            <span className="text-gray-700 dark:text-gray-300">Arrows:</span>
            <button
              onClick={() => handleRemoveDirection(selectedMarker.id)}
              disabled={selectedMarker.directions.length <= 1}
              aria-label="Remove an arrow"
              className="flex h-6 w-6 items-center justify-center rounded-md border text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              −
            </button>
            <span className="w-4 text-center font-semibold text-gray-900 dark:text-gray-100">
              {selectedMarker.directions.length}
            </span>
            <button
              onClick={() => handleAddDirection(selectedMarker.id)}
              disabled={selectedMarker.directions.length >= 4}
              aria-label="Add an arrow"
              className="flex h-6 w-6 items-center justify-center rounded-md border text-sm font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              +
            </button>
          </div>
        </div>
      )}

      {selectedMarker.type === "SECTION" && (
        <div className="mb-2 flex flex-col gap-1">
          <p className="text-xs text-gray-600 dark:text-gray-400">Drag the line itself to move it.</p>
          <button
            onClick={() => handleToggleFlip(selectedMarker.id)}
            className="self-start rounded-md border px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
          >
            Flip view direction
          </button>
        </div>
      )}

      <textarea
        key={selectedMarker.id}
        defaultValue={selectedMarker.note ?? ""}
        placeholder="Add a note..."
        onBlur={(e) => handleNoteChange(selectedMarker.id, e.target.value)}
        className="w-full rounded border px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        rows={2}
      />
    </div>
  );

  const totalsPanel = (
    <div className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
      <span className="font-medium text-gray-800 dark:text-gray-200">Project totals:</span>
      {MARKER_TYPES.map((type) => (
        <span key={type}>
          {COUNT_LABEL[type]}: {overallCounts[type]}
        </span>
      ))}
    </div>
  );

  const submitFooter = !readOnly &&
    (status === "submitted" ? (
      <span className="font-medium text-green-700 dark:text-green-400">Submitted</span>
    ) : (
      <div className="flex flex-col gap-2">
        <button
          onClick={() => handleReset("page")}
          disabled={resetting !== null}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
        >
          {resetting === "page" ? "Resetting..." : "Reset this page"}
        </button>
        <button
          onClick={() => handleReset("project")}
          disabled={resetting !== null}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
        >
          {resetting === "project" ? "Resetting..." : "Reset entire project"}
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit markup"}
        </button>
      </div>
    ));

  // Excel-sheet-style page tabs: a horizontal strip that sits directly under
  // the canvas, with the active tab's background matching the canvas so it
  // visually reads as part of the same surface.
  const pageTabsStrip = (
    <div className="flex items-end gap-0.5 overflow-x-auto rounded-b-lg border border-t-0 border-gray-200 bg-gray-200 px-2 pt-3 dark:border-gray-700 dark:bg-gray-950">
      {pages.map((p) => (
        <div key={p.id} className="group relative">
          <button
            onClick={() => {
              setActivePageId(p.id);
              setSelectedMarkerId(null);
              setSelectedTool(null);
            }}
            className={`whitespace-nowrap rounded-t-md border px-3 py-1.5 text-sm font-medium ${
              p.id === activePageId
                ? "border-gray-200 border-b-transparent bg-gray-50 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                : "border-transparent text-gray-600 hover:bg-gray-300/50 dark:text-gray-400 dark:hover:bg-gray-800/50"
            }`}
          >
            Page {p.pageNumber}
          </button>
          {readOnly && pages.length > 1 && (
            <button
              onClick={() => handleDeletePage(p.id)}
              title="Delete page"
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white opacity-0 hover:bg-red-700 group-hover:opacity-100"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex bg-white dark:bg-gray-900">
      <div
        ref={ribbonRef}
        className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900"
      >
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{project.name}</h1>
          {!locked && (
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Place IE and Section markers, then submit when you&apos;re done.
            </p>
          )}
        </div>
        {headerExtra}
        {errorBanner}
        {lockedBanner}
        {instructionsPanel}

        {toolPalette}
        {countsPanel}
        {selectedMarkerPanel}

        <div className="mt-auto flex flex-col gap-3 border-t pt-3 dark:border-gray-700">
          {totalsPanel}
          {submitFooter}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-0">
        <div className="relative flex-1">{canvasArea}</div>
        {pageTabsStrip}
      </div>
    </div>
  );
}
