import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rune",
  description: "Client markup links for as-built drawings.",
};

/** The mark Waystone uses for this tool in its nav rail -- a sheet with a
 *  marker pinned to it -- redrawn at landing-page size. */
function RuneMark() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <path
        d="M9 5h17l9 9v25a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="#f2f2f2"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M26 5v9h9" fill="none" stroke="#f2f2f2" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="21" cy="26" r="4.5" fill="#d4a017" stroke="#171717" strokeWidth="1.6" />
      <path
        d="M21 21.5v-4M21 30.5v4M16.5 26h-4M25.5 26h4"
        stroke="#d4a017"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Deliberately not a dashboard. Projects are created and managed in Waystone;
// this page exists so the bare deployment URL says what it is rather than
// 404ing or redirecting somewhere that no longer exists.
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#171717] p-6 font-[system-ui,'Segoe_UI',sans-serif] text-[#f2f2f2]">
      <div className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-4">
          <RuneMark />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Rune</h1>
            <p className="text-sm text-[#b2b2b2]">Client markup links for as-built drawings.</p>
          </div>
        </div>

        <div className="rounded-[10px] border border-[#2e2e2e] bg-[#242424] p-6">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
            No dashboard here
          </h2>
          <p className="text-sm leading-relaxed text-[#b2b2b2]">
            Projects are created and managed in Waystone, on your desktop. This address serves
            the review links themselves &mdash; each client gets their own, and it opens the plan
            for them directly.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[#b2b2b2]">
            If you were sent a link and it brought you here instead of a drawing, the address is
            probably incomplete &mdash; ask whoever sent it for the full one.
          </p>
        </div>

        <div className="mt-4 rounded-[10px] border border-[#2e2e2e] bg-[#242424] p-6">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.9px] text-[#8c8c8c]">
            Waystone
          </h2>
          <p className="text-sm leading-relaxed text-[#b2b2b2]">
            The desktop app that creates these links, alongside project sync, lookups and screen
            capture.
          </p>
          <a
            href="https://getwaystone.vercel.app"
            className="mt-4 inline-block rounded-lg bg-[#5286ff] px-5 py-2.5 text-sm font-semibold text-[#171717] transition-colors hover:bg-[#7aa2ff]"
          >
            Get Waystone
          </a>
        </div>
      </div>
    </main>
  );
}
