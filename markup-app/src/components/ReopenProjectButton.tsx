"use client";

import { useState } from "react";

export default function ReopenProjectButton({
  shareToken,
  onReopened,
}: {
  shareToken: string;
  onReopened: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleReopen() {
    setBusy(true);
    try {
      const res = await fetch(`/api/markup/${shareToken}/reopen`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to reopen project");
      onReopened();
    } catch {
      window.alert("Failed to reopen project. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleReopen}
      disabled={busy}
      title="Reopen for editing"
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-blue-500 dark:hover:bg-gray-800"
    >
      {busy ? "Reopening..." : "Reopen for editing"}
    </button>
  );
}
