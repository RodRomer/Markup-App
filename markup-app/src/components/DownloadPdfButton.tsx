"use client";

import { useState } from "react";

export default function DownloadPdfButton({
  href,
  filenameFallback = "export.pdf",
}: {
  href: string;
  filenameFallback?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const match = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? filenameFallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("Failed to generate PDF. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-emerald-500 dark:hover:bg-gray-800"
    >
      {loading ? "Generating PDF..." : "Download PDF"}
    </button>
  );
}
