import { NextResponse } from "next/server";
import { getOpportunity, KeapUnavailable, opportunityUrl, searchOpportunities } from "@/lib/keap";
import { isDenied, requireTeam } from "@/lib/teamAuth";
import { requireTool } from "@/lib/toolAccess";

/**
 * Look one project up in Keap, for Oracle.
 *
 * Oracle used to do this with a Keap key kept on each machine. The key can
 * write to the CRM, and once a machine holds one, taking away that person's
 * login takes nothing away -- the key keeps working until it is rotated, which
 * means rotating it for everybody. Asking the server instead keeps the key in
 * one place, makes it read-only by construction, and makes a disabled login
 * lose its Keap access at the same moment it loses everything else.
 *
 * Unlike /api/keap/stages, this does take a number from the caller: typing a
 * project number in and getting that project back is the entire feature. That
 * is not a new capability -- it is the one every staff machine already had with
 * a key of its own -- but it is now rate-limited in one place, read-only, and
 * attached to a login that can be switched off.
 */

/** What a Keap project number can look like: 3524, 3524_BA, 11934 - J870002.
 *  Narrow because it goes into a query string, and because anything outside
 *  this is a typo rather than a project. */
const PROJECT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // A wake-up call, answered before anything else and without signing in.
  //
  // Vercel puts an idle function to sleep, and the first lookup of the day pays
  // to start it -- on the one click somebody is watching an empty form for.
  // Waystone pings this at startup instead, when nobody is waiting.
  //
  // Deliberately needs no credential: it does nothing, reads nothing and says
  // nothing about what exists. Requiring one would mean signing in at every
  // launch, and a session row for every launch, to run no query at all.
  if (body?.warm === true) {
    return NextResponse.json({ warmed: true });
  }

  const who = await requireTeam(request);
  if (isDenied(who)) return who;
  const refused = await requireTool(who, "lookup");
  if (refused) return refused;

  const number = typeof body?.number === "string" ? body.number.trim() : "";
  if (!PROJECT_NUMBER.test(number)) {
    return NextResponse.json({ error: "That is not a project number." }, { status: 400 });
  }

  try {
    // One call, with the custom fields on it. Fetching the record separately
    // afterwards was a second slow round trip for something the search will
    // hand over if asked -- and Keap's search is the slow part from anywhere.
    const matches = await searchOpportunities(number, { withCustomFields: true });
    // The whole title, exactly: 8704_BA and 8704_LA are different jobs, and
    // Keap's search returns both for either. Oracle has always insisted on an
    // exact title here rather than taking the first result.
    const wanted = number.toLowerCase();
    const match = matches.find(
      (o) => (o.opportunity_title ?? "").trim().toLowerCase() === wanted
    ) as (Record<string, unknown> & { id?: number }) | undefined;

    if (!match?.id) {
      return NextResponse.json({ opportunity: null, url: null });
    }
    // Keap has been known to leave custom_fields off a search result; the
    // separate fetch is the fallback rather than the normal path, so a thin
    // answer is slower but never wrong.
    const opportunity = "custom_fields" in match ? match : await getOpportunity(match.id);
    if (!opportunity) {
      return NextResponse.json({ opportunity: null, url: null });
    }
    // The link too: the account subdomain lives here, so no machine needs its
    // own copy of it either.
    return NextResponse.json({ opportunity, url: opportunityUrl(match.id) });
  } catch (err) {
    if (err instanceof KeapUnavailable) {
      // Said plainly, because Oracle shows it to the person who clicked.
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}
