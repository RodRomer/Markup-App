"use client";

import { useState } from "react";
import { loadImageDimensions, rasterizePdf } from "@/lib/clientUpload";

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

type PreparedPage = { blob: Blob; width: number; height: number };

async function prepareImagePages(files: File[]): Promise<PreparedPage[]> {
  const dims = await Promise.all(files.map(loadImageDimensions));
  return files.map((file, i) => ({ blob: file, width: dims[i].width, height: dims[i].height }));
}

async function cleanupUploadedBlobs(urls: string[]) {
  if (urls.length === 0) return;
  await fetch("/api/blob-upload", { method: "DELETE", body: JSON.stringify({ urls }) }).catch(() => {});
}

export default function NewProjectForm({
  useBlob,
  onCreated,
}: {
  useBlob: boolean;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [allowIE, setAllowIE] = useState(true);
  const [allowSection, setAllowSection] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0 || !name.trim()) return;

    const pdfCount = files.filter(isPdfFile).length;
    if (pdfCount > 0 && files.length > 1) {
      setError("Choose a single PDF, or one or more images — not both.");
      return;
    }
    if (!allowIE && !allowSection) {
      setError("Request at least one of IE or Section.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const isPdf = files.length === 1 && isPdfFile(files[0]);
      const kind = isPdf ? "pdf" : "image";
      const originalFilename = isPdf
        ? files[0].name
        : files.length === 1
          ? files[0].name
          : `${files.length} images`;

      setProgress(isPdf ? "Rendering PDF pages..." : files.length > 1 ? "Reading images..." : "Reading image...");
      const pages = isPdf ? await rasterizePdf(files[0]) : await prepareImagePages(files);

      let id: string;
      if (useBlob) {
        const { upload } = await import("@vercel/blob/client");
        const uploadedUrls: string[] = [];
        try {
          setProgress(pages.length > 1 ? "Uploading pages..." : "Uploading...");
          const uploaded = [];
          for (let i = 0; i < pages.length; i++) {
            const { url } = await upload(`page-${crypto.randomUUID()}-${i}.png`, pages[i].blob, {
              access: "public",
              handleUploadUrl: "/api/blob-upload",
            });
            uploadedUrls.push(url);
            uploaded.push({ imagePath: url, width: pages[i].width, height: pages[i].height });
          }

          setProgress("Creating project...");
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              kind,
              originalFilename,
              allowIE,
              allowSection,
              pages: uploaded,
            }),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
          ({ id } = await res.json());
        } catch (err) {
          await cleanupUploadedBlobs(uploadedUrls);
          throw err;
        }
      } else {
        const formData = new FormData();
        formData.set("name", name.trim());
        formData.set("allowIE", String(allowIE));
        formData.set("allowSection", String(allowSection));
        formData.set("originalFilename", originalFilename);
        formData.set("kind", kind);
        formData.set("meta", JSON.stringify(pages.map((p) => ({ width: p.width, height: p.height }))));
        pages.forEach((p, i) => formData.set(`file-${i}`, p.blob, `page-${i}.png`));

        setProgress("Uploading...");
        const res = await fetch("/api/projects", { method: "POST", body: formData });
        if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
        ({ id } = await res.json());
      }

      setName("");
      setFiles([]);
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border p-4 dark:border-gray-800">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New project</h2>
      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Project name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 123 Main St - Floors 1-3"
          className="rounded border px-3 py-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Site plan — a single PDF, or one image per page/floor (select multiple)
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="rounded border px-3 py-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          required
        />
      </label>
      {files.length > 1 && (
        <ul className="rounded border bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
          {files.map((f, i) => (
            <li key={i}>
              Page {i + 1}: {f.name}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
        Request from client
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={allowIE} onChange={(e) => setAllowIE(e.target.checked)} />
          IE
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={allowSection}
            onChange={(e) => setAllowSection(e.target.checked)}
          />
          Section
        </label>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={busy || files.length === 0 || !name.trim()}
        className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? progress ?? "Working..." : "Create project"}
      </button>
    </form>
  );
}
