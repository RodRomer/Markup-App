"use client";

import { useState } from "react";

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.alert("Couldn't copy automatically — please copy the link manually.");
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
