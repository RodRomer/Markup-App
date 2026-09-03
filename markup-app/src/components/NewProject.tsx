"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import { RasterizeError, renderPages, type RenderedPage } from "@/lib/rasterizeInBrowser";
import { safeStem } from "@/lib/blobKeys";

/**
 * Creating a project from the staff page, which until now only Waystone could
 * do.
 *
 * The pages are rendered here rather than on the server: nothing in the Node
 * app can rasterize a PDF, and Vercel caps a serverless request body at 4.5 MB
 * -- a five-page ARCH D set is several times that. So the browser renders each
 * page, uploads it straight to Blob storage, and the create call carries only
 * URLs. That is exactly the shape /api/projects' JSON path already expected.
 */

const CARD = "rounded-[10px] border border-[#2e2e2e] bg-[#242424]";
const BTN =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 " +
  "disabled:cursor-not-allowed border border-[#474747] bg-[#2e2e2e] text-[#f2f2f2] hover:bg-[#3a3a3a]";
const PRIMARY =
  "rounded-lg px-4 py-2 text-sm font-semibold bg-[#5286ff] text-[#171717] hover:bg-[#7aa2ff] " +
  "disabled:opacity-40 disabled:cursor-not-allowed";
const FIELD =
  "rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#f2f2f2] " +
  "placeholder:text-[#6a6a6a]";

export default function NewProject({
  token,
  onCreated,
  onCancel,
}: {
  token: string;
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [allowIE, setAllowIE] = useState(true);
  const [allowSection, setAllowSection] = useState(true);
  const [price, setPrice] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = step !== null;

  async function uploadPage(stem: string, index: number, page: RenderedPage) {
    const put = (suffix: string, body: Blob) =>
      upload(`${stem}-${index}${suffix}.png`, body, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
        // The route establishes the team before it hands out a write token.
        headers: { "x-team-token": token },
      });

    const full = await put("", page.full);
    const display = page.display ? await put("-display", page.display) : null;
    return {
      imagePath: full.url,
      width: page.width,
      height: page.height,
      displayPath: display?.url,
      displayWidth: page.displayWidth ?? undefined,
      displayHeight: page.displayHeight ?? undefined,
    };
  }

  /** Taking a file, however it arrived. */
  function choose(chosen: File | null) {
    setFile(chosen);
    // The filename is nearly always what the project should be called, and
    // typing it again is the sort of busywork nobody thanks you for.
    if (chosen && !name.trim()) setName(chosen.name.replace(/\.[^.]+$/, ""));
  }

  async function create() {
    if (!file || !name.trim()) return;
    setError(null);
    try {
      setStep("Reading the plan…");
      const { kind, pages } = await renderPages(file, (done, total) =>
        setStep(`Rendering page ${done} of ${total}…`)
      );

      const stem = safeStem(file.name);
      const uploaded = [];
      for (const [i, page] of pages.entries()) {
        setStep(`Uploading page ${i + 1} of ${pages.length}…`);
        uploaded.push(await uploadPage(stem, i, page));
      }

      setStep("Creating the project…");
      // Blank means this project shows no pricing; 0 is a stated price of zero
      // and is kept. Sending "" for blank would collapse the two.
      const trimmedPrice = price.trim();
      const parsed = Number(trimmedPrice);
      const pricePerIE =
        trimmedPrice !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-team-token": token },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          originalFilename: file.name,
          allowIE,
          allowSection,
          pricePerIE,
          pages: uploaded,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The project could not be created.");

      await onCreated();
    } catch (e) {
      // A rasterize failure already reads as an instruction; anything else is
      // shown as it arrived rather than dressed up.
      setError(e instanceof RasterizeError || e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
    }
  }

  return (
    <div className={CARD + " p-6"}>
      <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
        New project
      </h2>

      {error && <p className="mb-3 text-sm text-[#f78645]">{error}</p>}

      <div className="flex flex-col gap-3">
        <input
          className={FIELD}
          placeholder="Project name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />

        {/* A label wrapping the input, so the whole panel is the click target as
            well as the drop target -- a drop zone you cannot click is a puzzle,
            and a file button you cannot drop onto is the thing being fixed. */}
        <label
          onDragOver={(e) => {
            if (busy) return;
            // Both needed: without preventDefault the browser navigates to the
            // file instead of handing it over.
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (busy) return;
            // Only the first. A plan set is one file; taking two silently would
            // create a project from whichever the browser happened to list first.
            const dropped = e.dataTransfer.files?.[0] ?? null;
            if (e.dataTransfer.files?.length > 1) {
              setError("One file at a time — the first was taken.");
            }
            choose(dropped);
          }}
          className={
            "flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors " +
            (busy ? "cursor-not-allowed opacity-50 " : "") +
            (dragging
              ? "border-[#5286ff] bg-[#5286ff]/10 text-[#f2f2f2]"
              : "border-[#474747] bg-[#1f1f1f] text-[#b2b2b2] hover:border-[#6a6a6a]")
          }
        >
          <span className="font-medium">
            {file ? file.name : "Drop a plan here, or click to choose"}
          </span>
          <span className="text-xs text-[#6a6a6a]">PDF, PNG or JPG</span>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            disabled={busy}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 text-sm text-[#b2b2b2]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowIE} disabled={busy}
                   onChange={(e) => setAllowIE(e.target.checked)} />
            Allow IE
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowSection} disabled={busy}
                   onChange={(e) => setAllowSection(e.target.checked)} />
            Allow Section
          </label>
          <label className="flex items-center gap-2">
            Price per IE
            <input
              className={FIELD + " w-28"}
              inputMode="decimal"
              placeholder="none"
              value={price}
              disabled={busy}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        </div>

        {/* Said out loud because rendering a six-page ARCH D set is not instant,
            and a silent button is indistinguishable from one that did nothing. */}
        {step && <p className="text-sm text-[#8c8c8c]">{step}</p>}

        <div className="flex gap-2">
          <button className={PRIMARY} disabled={!file || !name.trim() || busy}
                  onClick={() => void create()}>
            {busy ? "Working…" : "Create project"}
          </button>
          <button className={BTN} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
