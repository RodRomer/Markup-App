"use client";

import { useState } from "react";

export default function RequestedMarkerTypes({
  projectId,
  allowIE,
  allowSection,
}: {
  projectId: string;
  allowIE: boolean;
  allowSection: boolean;
}) {
  const [ie, setIe] = useState(allowIE);
  const [section, setSection] = useState(allowSection);
  const [saving, setSaving] = useState(false);

  async function update(next: { allowIE?: boolean; allowSection?: boolean }) {
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Requesting from client:</span>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={ie}
          disabled={saving}
          onChange={(e) => {
            setIe(e.target.checked);
            update({ allowIE: e.target.checked });
          }}
        />
        IE
      </label>
      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={section}
          disabled={saving}
          onChange={(e) => {
            setSection(e.target.checked);
            update({ allowSection: e.target.checked });
          }}
        />
        Section
      </label>
    </div>
  );
}
