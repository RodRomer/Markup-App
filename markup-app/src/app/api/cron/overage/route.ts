import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cronAuth";
import { runOverageCheck } from "@/lib/overage/run";

/** A run reads ~70 projects from Keap at a polite rate; about ten seconds. */
export const maxDuration = 120;

/**
 * The weekday morning run, called by Vercel's scheduler (see vercel.json).
 *
 * It only finds and records. Nothing is emailed from here: sending is an
 * admin's decision in Warden, which is what was settled with the user.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }
  const outcome = await runOverageCheck("cron", null);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}
