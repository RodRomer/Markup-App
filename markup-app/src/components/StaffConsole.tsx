"use client";

import { useCallback, useEffect, useState } from "react";

import { formatMoney } from "@/lib/money";

/** Projects, and what can be done to one -- the same actions Waystone's Rune
 *  tab offers, for when the desktop app is not to hand.
 *
 *  The staff key lives in sessionStorage rather than localStorage: this page is
 *  on a public address, and a key that outlives the tab is a key left sitting
 *  on any machine anyone borrowed. Closing the tab forgets it.
 */

type Project = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  markerCount?: number;
  ieCount?: number;
  /** View directions, not markers -- what a price is multiplied by. */
  ieViewCount?: number;
};

type Detail = Project & {
  shareToken: string;
  allowIE: boolean;
  allowSection: boolean;
  pricePerIE: number | null;
  pages: { id: string; pageNumber: number }[];
};

const KEY_STORE = "rune.staffKey";

/** Why a pasted value cannot be the key, or null if it looks plausible.
 *
 *  Waystone's own key field is seeded with bullet characters standing in for a
 *  key already saved -- the real value is never echoed back out of the
 *  registry. The field looks entirely copyable, so copying from there and
 *  pasting here is the obvious mistake to make, and "Not authorised" would not
 *  hint at it. */
function whyNotAKey(value: string): string | null {
  if (/^[•*●·]+$/.test(value)) {
    return "That is the row of dots Waystone shows in place of a saved key, not the key itself. " +
      "The value is only readable from the Windows environment variable MARKUP_STAFF_KEY.";
  }
  if (value.includes(" ")) {
    return "That contains a space, so it is probably not the key.";
  }
  return null;
}

function readStoredKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return ""; // private windows and blocked site data both land here
  }
}

const CARD = "rounded-[10px] border border-[#2e2e2e] bg-[#242424]";
const BTN =
  "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 " +
  "disabled:cursor-not-allowed border border-[#474747] bg-[#2e2e2e] text-[#f2f2f2] hover:bg-[#3a3a3a]";
const PRIMARY =
  "rounded-lg px-4 py-2 text-sm font-semibold bg-[#5286ff] text-[#171717] hover:bg-[#7aa2ff] " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

export default function StaffConsole() {
  const [key, setKey] = useState("");
  const [typedKey, setTypedKey] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");

  useEffect(() => setKey(readStoredKey()), []);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(path, {
        ...init,
        headers: { ...(init.headers ?? {}), "x-waystone-key": key },
      });
      if (!res.ok) {
        let message = "HTTP " + res.status;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* a non-JSON error body is still an error */
        }
        // A key IS set, so 401/403 means it is the wrong one rather than absent.
        // Waystone draws the same distinction, because the two need different fixes.
        // The length is included because the usual cause is that what arrived is
        // not what was copied -- truncated, padded, or a different value
        // entirely -- and "Not authorised" alone gives no way to tell.
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            message + " — the key this page sent was " + key.length +
            " characters. If that is not the length of your key, what reached the " +
            "box is not what you copied.");
        }
        throw new Error(message);
      }
      return res;
    },
    [key],
  );

  const loadProjects = useCallback(async () => {
    if (!key) return;
    setError(null);
    try {
      const res = await call("/api/projects");
      setProjects(await res.json());
    } catch (e) {
      // Cleared, so a stale list cannot sit there looking current under an error.
      setProjects(null);
      const message = e instanceof Error ? e.message : String(e);
      // A TypeError from fetch means the request never reached the server at
      // all -- offline, blocked, an extension. That needs a different fix from
      // a key the server refused, and the two read identically otherwise.
      setError(e instanceof TypeError
        ? "The request never reached the server (" + message + "). That is a " +
          "connection or browser problem rather than the key."
        : message);
    }
  }, [call, key]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function act(label: string, run: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      // Always. A failure must not leave a button reading "Deleting..." for
      // good -- exactly what had to be fixed in Waystone's own Rune tab.
      setBusy(null);
    }
  }

  function saveKey() {
    const trimmed = typedKey.trim();
    const wrong = whyNotAKey(trimmed);
    if (wrong) {
      // Caught before it is stored, so the next reload does not retry it.
      setError(wrong);
      return;
    }
    setError(null);
    try {
      sessionStorage.setItem(KEY_STORE, trimmed);
    } catch {
      /* still works for this page load, just not across a reload */
    }
    setKey(trimmed);
  }

  function forgetKey() {
    try {
      sessionStorage.removeItem(KEY_STORE);
    } catch {
      /* nothing stored to remove */
    }
    setKey("");
    setTypedKey("");
    setProjects(null);
    setDetail(null);
    setError(null);
  }

  if (!key) {
    return (
      <div className={CARD + " p-6"}>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
          Staff key
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-[#b2b2b2]">
          The same key Waystone uses under Settings &rsaquo; Connections. Kept for this tab only,
          and forgotten when you close it.
        </p>
        {error && <p className="mb-3 text-sm text-[#f78645]">{error}</p>}
        <div className="flex gap-2">
          <input
            type="password"
            value={typedKey}
            onChange={(e) => setTypedKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveKey();
            }}
            placeholder="paste the key"
            className="flex-1 rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#f2f2f2] placeholder:text-[#6a6a6a]"
          />
          <button onClick={saveKey} disabled={!typedKey.trim()} className={PRIMARY}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  if (detail) {
    const link = window.location.origin + "/markup/" + detail.shareToken;
    const submitted = detail.status === "submitted";
    return (
      <div className={CARD + " p-6"}>
        <button
          onClick={() => setDetail(null)}
          className="mb-4 text-sm text-[#5286ff] hover:underline"
        >
          &larr; All projects
        </button>
        <h2 className="text-xl font-bold">{detail.name}</h2>
        <p className="mt-1 text-sm text-[#b2b2b2]">
          {detail.status} &middot; {detail.pages.length} page
          {detail.pages.length === 1 ? "" : "s"}
          {detail.pricePerIE !== null ? " · " + formatMoney(detail.pricePerIE) + " per IE" : ""}
        </p>

        <div className="mt-5 flex gap-2">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#b2b2b2]"
          />
          <button
            className={BTN}
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a href={link} target="_blank" rel="noreferrer" className={BTN}>
            Open
          </a>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {(["allowIE", "allowSection"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-2 text-sm text-[#b2b2b2]">
              <input
                type="checkbox"
                checked={detail[flag]}
                disabled={busy !== null}
                onChange={(e) => {
                  const next = e.target.checked;
                  void act(flag, async () => {
                    await call("/api/projects/" + detail.id, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ [flag]: next }),
                    });
                    setDetail({ ...detail, [flag]: next });
                  });
                }}
              />
              Allow {flag === "allowIE" ? "IE" : "Section"} requests
            </label>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <label className="text-sm text-[#b2b2b2]" htmlFor="price">
            Price per IE
          </label>
          <input
            id="price"
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            placeholder="none"
            inputMode="decimal"
            className="w-28 rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#f2f2f2] placeholder:text-[#6a6a6a]"
          />
          <button
            className={BTN}
            disabled={busy !== null}
            onClick={() =>
              void act("price", async () => {
                // Blank clears it: the client then sees no pricing at all,
                // which is a different thing from a price of zero.
                const raw = priceDraft.trim().replace(/^\$/, "").replace(/,/g, "");
                let next: number | null = null;
                if (raw !== "") {
                  const parsed = Number(raw);
                  if (!Number.isFinite(parsed) || parsed < 0) {
                    throw new Error("'" + priceDraft.trim() + "' isn't a price.");
                  }
                  next = parsed;
                }
                const res = await call("/api/projects/" + detail.id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ pricePerIE: next }),
                });
                const saved = await res.json();
                setPriceDraft(saved.pricePerIE === null ? "" : String(saved.pricePerIE));
                setDetail({ ...detail, pricePerIE: saved.pricePerIE });
              })
            }
          >
            {busy === "price" ? "Saving…" : "Save"}
          </button>
          <span className="text-xs text-[#8c8c8c]">blank shows the client no pricing</span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <a href={"/api/projects/" + detail.id + "/pdf"} className={BTN}>
            Download PDF
          </a>
          <button
            className={BTN}
            disabled={!submitted || busy !== null}
            onClick={() =>
              void act("reopen", async () => {
                await call("/api/markup/" + detail.shareToken + "/reopen", { method: "POST" });
                setDetail({ ...detail, status: "sent" });
                await loadProjects();
              })
            }
          >
            {busy === "reopen" ? "Reopening…" : "Reopen"}
          </button>
          <button
            className={
              BTN + (confirmDelete === detail.id ? " border-[#f78645] text-[#f78645]" : "")
            }
            disabled={busy !== null}
            onClick={() => {
              // Two presses, like Waystone's own Delete. The armed state expires,
              // so a click left behind cannot delete something later.
              if (confirmDelete !== detail.id) {
                setConfirmDelete(detail.id);
                setTimeout(() => setConfirmDelete(null), 4000);
                return;
              }
              void act("delete", async () => {
                await call("/api/projects/" + detail.id, { method: "DELETE" });
                setConfirmDelete(null);
                setDetail(null);
                await loadProjects();
              });
            }}
          >
            {busy === "delete"
              ? "Deleting…"
              : confirmDelete === detail.id
                ? "Click again to confirm"
                : "Delete project"}
          </button>
        </div>

        {detail.pages.length > 1 && (
          <div className="mt-6 border-t border-[#2e2e2e] pt-4">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
              Pages
            </h3>
            <p className="mb-3 text-xs text-[#8c8c8c]">
              Removing a page cannot be undone, and takes its markers with it.
            </p>
            <div className="flex flex-wrap gap-2">
              {detail.pages.map((page) => (
                <button
                  key={page.id}
                  className={BTN}
                  disabled={busy !== null}
                  onClick={() =>
                    void act("page-" + page.id, async () => {
                      await call("/api/projects/" + detail.id + "/pages/" + page.id, {
                        method: "DELETE",
                      });
                      setDetail({
                        ...detail,
                        pages: detail.pages.filter((p) => p.id !== page.id),
                      });
                    })
                  }
                >
                  {busy === "page-" + page.id
                    ? "Removing…"
                    : "Remove page " + page.pageNumber}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-[#f78645]">{error}</p>}
      </div>
    );
  }

  return (
    <div className={CARD + " p-6"}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
          Projects
        </h2>
        <div className="flex gap-2">
          <button className={BTN} onClick={() => void loadProjects()}>
            Refresh
          </button>
          <button className={BTN} onClick={forgetKey}>
            Forget key
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-[#f78645]">{error}</p>}

      {projects === null && !error && <p className="text-sm text-[#b2b2b2]">Loading&hellip;</p>}

      {/* Only when the list really came back empty. A failed load clears the
          list and shows the error above instead, so "none" and "could not ask"
          never look the same. */}
      {projects !== null && projects.length === 0 && (
        <p className="text-sm text-[#b2b2b2]">
          No projects yet. They are created from Waystone, on your desktop.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {(projects ?? []).map((project) => (
          <button
            key={project.id}
            className="rounded-lg border border-[#2e2e2e] bg-[#1f1f1f] p-3 text-left transition-colors hover:border-[#474747]"
            disabled={busy !== null}
            onClick={() =>
              void act("open-" + project.id, async () => {
                const res = await call("/api/projects/" + project.id);
                const loaded: Detail = await res.json();
                setPriceDraft(loaded.pricePerIE === null ? "" : String(loaded.pricePerIE));
                setDetail(loaded);
              })
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{project.name}</span>
              <span className="shrink-0 text-xs text-[#8c8c8c]">{project.status}</span>
            </div>
            <span className="text-xs text-[#8c8c8c]">
              {project.ieCount ?? 0} IE marker{project.ieCount === 1 ? "" : "s"} &middot;{" "}
              {project.ieViewCount ?? 0} view{project.ieViewCount === 1 ? "" : "s"} &middot;{" "}
              {project.markerCount ?? 0} marker{project.markerCount === 1 ? "" : "s"} total
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
