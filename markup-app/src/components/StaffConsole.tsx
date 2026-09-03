"use client";

import { useCallback, useEffect, useState } from "react";

import { formatMoney } from "@/lib/money";
import NewProject from "@/components/NewProject";

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
  lastActivityAt: string;
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

const SESSION_STORE = "rune.session";
const SEEN_STORE = "rune.lastSeen";

/** When this browser last opened each project. Per-device on purpose: the
 *  question is "since *I* last looked", not since anyone did. */
function readSeen(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_STORE) ?? "{}") as Record<string, string>;
  } catch {
    // A private window, cleared site data, or storage switched off. No marks
    // means every project with activity shows as new, which is the safe way to
    // be wrong.
    return {};
  }
}

function markSeen(projectId: string) {
  try {
    const seen = readSeen();
    seen[projectId] = new Date().toISOString();
    window.localStorage.setItem(SEEN_STORE, JSON.stringify(seen));
  } catch {
    // Nothing to do; the badge simply keeps showing.
  }
}

/** A project has moved since this browser last looked at it.
 *
 *  Falls back to createdAt rather than to "never", so a project nobody has
 *  opened is only flagged once a client has actually done something to it --
 *  otherwise every project would arrive already shouting. */
function hasUnseenActivity(project: Project, seen: Record<string, string>): boolean {
  return new Date(project.lastActivityAt) > new Date(seen[project.id] ?? project.createdAt);
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString();
const dateAndTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

type Session = { token: string; teamName: string };

/** The signed-in team, for this tab only. sessionStorage rather than
 *  localStorage: this page is on a public address, and a session that outlives
 *  the tab is one left open on a shared machine. */
function readStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
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
  const [session, setSession] = useState<Session | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  // Empty on the server and on the first paint, then filled from
  // localStorage -- the same shape the staff key uses, for the same reason.
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => setSession(readStoredSession()), []);
  useEffect(() => setSeen(readSeen()), []);

  const call = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(path, {
        ...init,
        headers: { ...(init.headers ?? {}), "x-team-token": session?.token ?? "" },
      });
      if (!res.ok) {
        let message = "HTTP " + res.status;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* a non-JSON error body is still an error */
        }
        // A session that is gone or expired is not a failed action -- it is a
        // sign-in that has to happen again, and saying so is the only useful
        // response. Named so the caller can drop the session rather than leave
        // the page retrying with a token the server has stopped accepting.
        if (res.status === 401 || res.status === 403) {
          const rejected = new Error(message);
          rejected.name = "SessionRejected";
          throw rejected;
        }
        throw new Error(message);
      }
      return res;
    },
    [session],
  );

  const loadProjects = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const res = await call("/api/projects");
      setProjects(await res.json());
    } catch (e) {
      // Cleared, so a stale list cannot sit there looking current under an error.
      setProjects(null);
      const message = e instanceof Error ? e.message : String(e);
      // A refused session must not stick. It is stored the moment it is issued,
      // and a stored session sends this straight to the list view -- so the
      // sign-in form disappears and every reload lands back here with no way to
      // sign in again. Dropping it returns the form, with the reason on screen.
      if (e instanceof Error && e.name === "SessionRejected") {
        try {
          sessionStorage.removeItem(SESSION_STORE);
        } catch {
          /* nothing stored to remove */
        }
        setSession(null);
        setError(message);
        return;
      }
      // A TypeError from fetch means the request never reached the server at
      // all -- offline, blocked, an extension. That needs a different fix from
      // a key the server refused, and the two read identically otherwise. The
      // session is kept: it may well be good and the network wrong.
      setError(e instanceof TypeError
        ? "The request never reached the server (" + message + "). That is a " +
          "connection or browser problem rather than the key."
        : message);
    }
  }, [call, session]);

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

  async function signIn() {
    setError(null);
    setBusy("sign-in");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim(), password: passwordDraft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not sign in.");

      const next: Session = { token: body.token, teamName: body.team.name };
      try {
        sessionStorage.setItem(SESSION_STORE, JSON.stringify(next));
      } catch {
        /* still works for this page load, just not across a reload */
      }
      // Cleared straight away rather than left in state: nothing else on this
      // page ever needs the password again.
      setPasswordDraft("");
      setSession(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function signOut() {
    // Told to the server as well as forgotten here, so the token stops working
    // everywhere rather than just in this tab.
    const token = session?.token;
    if (token) {
      void fetch("/api/auth/logout", { method: "POST", headers: { "x-team-token": token } })
        .catch(() => {});
    }
    try {
      sessionStorage.removeItem(SESSION_STORE);
    } catch {
      /* nothing stored to remove */
    }
    setSession(null);
    setNameDraft("");
    setPasswordDraft("");
    setProjects(null);
    setDetail(null);
    setError(null);
  }

  if (!session) {
    return (
      <div className={CARD + " p-6"}>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
          Sign in
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-[#b2b2b2]">
          Your team name and its password. The same pair Waystone uses under Settings
          &rsaquo; Connections. Kept for this tab only, and forgotten when you close it.
        </p>
        {error && <p className="mb-3 text-sm text-[#f78645]">{error}</p>}
        <div className="flex flex-col gap-2">
          <input
            type="text"
            name="team"
            autoComplete="organization"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void signIn(); }}
            placeholder="Team"
            className="rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#f2f2f2] placeholder:text-[#6a6a6a]"
          />
          <input
            // Masked, unlike the staff key this replaced. That one was pasted
            // out of a variable you could already read, and hiding it only made
            // a mistyped paste impossible to spot. This is a real password,
            // typed rather than pasted, and a password manager offering to keep
            // it is the wanted behaviour rather than the feared one.
            type="password"
            name="password"
            autoComplete="current-password"
            value={passwordDraft}
            onChange={(e) => setPasswordDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void signIn(); }}
            placeholder="Password"
            className="rounded-lg border border-[#474747] bg-[#1f1f1f] px-3 py-2 text-sm text-[#f2f2f2] placeholder:text-[#6a6a6a]"
          />
          <button
            onClick={() => void signIn()}
            disabled={!nameDraft.trim() || !passwordDraft || busy !== null}
            className={PRIMARY}
          >
            {busy === "sign-in" ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  if (creating && session) {
    return (
      <NewProject
        token={session.token}
        onCancel={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          await loadProjects();
        }}
      />
    );
  }

  if (detail) {
    const link = window.location.origin + "/markup/" + detail.shareToken;
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
          <button className={PRIMARY} onClick={() => setCreating(true)}>
            New project
          </button>
          <button className={BTN} onClick={() => void loadProjects()}>
            Refresh
          </button>
          <button className={BTN} onClick={signOut}>
            Sign out
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
        {(projects ?? []).map((project) => {
          const unseen = hasUnseenActivity(project, seen);
          return (
          <button
            key={project.id}
            className="rounded-lg border border-[#2e2e2e] bg-[#1f1f1f] p-3 text-left transition-colors hover:border-[#474747]"
            disabled={busy !== null}
            onClick={() =>
              void act("open-" + project.id, async () => {
                const res = await call("/api/projects/" + project.id);
                const loaded: Detail = await res.json();
                setPriceDraft(loaded.pricePerIE === null ? "" : String(loaded.pricePerIE));
                markSeen(project.id);
                setSeen(readSeen());
                setDetail(loaded);
              })
            }
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {unseen && (
                  <span
                    title="Changed since you last opened this"
                    aria-label="Changed since you last opened this"
                    className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#f78645] text-[10px] font-bold text-[#171717]"
                  >
                    !
                  </span>
                )}
                {project.name}
              </span>
              <span className="shrink-0 text-xs text-[#8c8c8c]">{project.status}</span>
            </div>
            <span className="text-xs text-[#8c8c8c]">
              {project.ieCount ?? 0} IE marker{project.ieCount === 1 ? "" : "s"} &middot;{" "}
              {project.ieViewCount ?? 0} view{project.ieViewCount === 1 ? "" : "s"} &middot;{" "}
              {project.markerCount ?? 0} marker{project.markerCount === 1 ? "" : "s"} total
            </span>
            <span className={"text-xs " + (unseen ? "text-[#f78645]" : "text-[#8c8c8c]")}>
              Created {shortDate(project.createdAt)} &middot; Updated{" "}
              {dateAndTime(project.lastActivityAt)}
            </span>
          </button>
          );
        })}
      </div>
    </div>
  );
}
