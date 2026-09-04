import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { KeapUnavailable, searchOpportunities } from "@/lib/keap";
import { findOpportunity, isDelivered, numberFor, stageName } from "@/lib/keapDelivery";
import { isDenied, requireTeam } from "@/lib/teamAuth";

/**
 * What Keap says about this team's projects.
 *
 * Its own route rather than part of the project list, so the list does not wait
 * on a third party to render and a Keap outage costs a column rather than the
 * page. Waystone loads it the same way and for the same reason.
 *
 * The numbers are read from the database, not taken from the caller. A number
 * arriving in the request body would let anyone signed in ask Keap about any
 * project they cared to name, using the server's key -- which is a Keap search
 * endpoint with extra steps.
 */
export async function POST(request: Request) {
  const who = await requireTeam(request);
  if (isDenied(who)) return who;

  if (!process.env.KEAP_API_KEY) {
    // Not an error. A deployment without a Keap key is a working deployment;
    // the column simply does not appear.
    return NextResponse.json({ configured: false, stages: {} });
  }

  const projects = await prisma.project.findMany({
    where: { teamId: who.teamId },
    select: { id: true, name: true, projectNumber: true },
  });

  const stages: Record<string, { stage: string; delivered: boolean }> = {};
  try {
    // One search per project that has something to search on, in sequence:
    // this is a handful of requests against someone else's rate limit, not a
    // fan-out worth saving milliseconds on.
    for (const project of projects) {
      if (!numberFor(project)) continue;
      const match = await findOpportunity(project, searchOpportunities);
      const stage = stageName(match);
      if (stage) stages[project.id] = { stage, delivered: isDelivered(match) };
    }
  } catch (err) {
    if (err instanceof KeapUnavailable) {
      // Whatever was found before the failure is still true, and a partial
      // answer beats an empty one.
      return NextResponse.json({ configured: true, stages, error: err.message });
    }
    throw err;
  }

  return NextResponse.json({ configured: true, stages });
}
