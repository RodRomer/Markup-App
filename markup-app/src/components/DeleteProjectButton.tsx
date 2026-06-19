"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteProjectButton({
  projectId,
  projectName,
  redirectTo,
}: {
  projectId: string;
  projectName: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete "${projectName}"? This permanently removes its plan and all markup.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete project");
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch {
      window.alert("Failed to delete project. Please try again.");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      title="Delete project"
      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
    >
      {busy ? "Deleting..." : "Delete"}
    </button>
  );
}
