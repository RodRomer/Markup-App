/**
 * One run of the overage check: read Keap, decide, write.
 *
 * The deciding is in plan.ts and rules.ts, pure and tested. This is only the
 * reading and writing around it, and the one rule that lives nowhere else:
 * a run that fails is recorded as failed, and changes no alert. Warden has to
 * be able to tell "found nothing" from "could not look".
 */
import { prisma } from "@/lib/db";
import { listOpportunitiesInStage } from "@/lib/keap";
import { enteredStageDates } from "@/lib/keapStageHistory";
import { localDay, planAlertChanges, reportRows } from "@/lib/overage/plan";
import { evaluate, projectFromOpportunity, type Alert } from "@/lib/overage/rules";
import { STAGE_CAD_LIVE } from "@/lib/overage/settings";

/** PPM's day, for counting business days. See localDay. */
const TIME_ZONE = "America/Denver";

export type RunOutcome = {
  runId: string;
  ok: boolean;
  error: string | null;
  projects: number;
  alerts: number;
};

/** The figures an alert row is refreshed with on every run that sees it. */
function figures(alert: Alert) {
  const p = alert.project;
  return {
    projectNumber: p.number,
    drafter: p.drafter,
    pmEmail: p.pmEmail,
    overage: p.overage,
    sfEst: p.sfEst,
    notesSf: alert.notesSf,
    threshold: alert.threshold,
    businessDays: alert.businessDays,
  };
}

export async function runOverageCheck(
  trigger: "cron" | "manual",
  byMemberId: string | null,
): Promise<RunOutcome> {
  const now = new Date();
  const today = localDay(now, TIME_ZONE);

  try {
    const raws = await listOpportunitiesInStage(STAGE_CAD_LIVE);
    const entered = await enteredStageDates(raws.map((r) => r.id), STAGE_CAD_LIVE);
    const results = raws.map((raw) =>
      evaluate(projectFromOpportunity(raw), entered.get(raw.id) ?? null, today));
    const active = results.flatMap((r) => r.alerts);

    const run = await prisma.$transaction(async (tx) => {
      const existing = await tx.overageAlert.findMany({
        where: { OR: [{ resolvedAt: null }, { oppId: { in: active.map((a) => a.project.oppId) } }] },
        select: { oppId: true, kind: true, firstSeenAt: true, lastSeenAt: true, resolvedAt: true, sentAt: true },
      });
      const changes = planAlertChanges(
        existing.map((row) => ({
          oppId: row.oppId,
          kind: row.kind,
          firstSeenAt: row.firstSeenAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
          sentAt: row.sentAt?.toISOString() ?? null,
        })),
        active,
        now.toISOString(),
      );

      for (const change of changes) {
        const when = {
          lastSeenAt: new Date(change.state.lastSeenAt),
          resolvedAt: change.state.resolvedAt ? new Date(change.state.resolvedAt) : null,
        };
        // sentAt, sentByMemberId and sentTo are never written here -- see
        // AlertChange in plan.ts. An upsert rather than a create, because a
        // second run racing this one may have created the row a moment ago.
        if (change.op === "create") {
          await tx.overageAlert.upsert({
            where: { oppId_kind: { oppId: change.alert.project.oppId, kind: change.alert.kind } },
            create: {
              oppId: change.alert.project.oppId,
              kind: change.alert.kind,
              ...figures(change.alert),
              firstSeenAt: new Date(change.state.firstSeenAt),
              ...when,
            },
            update: { ...figures(change.alert), ...when },
          });
        } else {
          await tx.overageAlert.update({
            where: { oppId_kind: { oppId: change.oppId, kind: change.kind } },
            data: { ...(change.alert ? figures(change.alert) : {}), ...when },
          });
        }
      }

      return tx.overageRun.create({
        data: { trigger, byMemberId, ok: true, report: reportRows(results) },
      });
      // About seventy writes against a database that may be waking up. The
      // default five seconds is not always enough, and a run that times out
      // here has written nothing -- the transaction is the point.
    }, { timeout: 60_000, maxWait: 15_000 });

    return { runId: run.id, ok: true, error: null, projects: results.length, alerts: active.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = await prisma.overageRun.create({
      data: { trigger, byMemberId, ok: false, error: message.slice(0, 2000) },
    });
    return { runId: run.id, ok: false, error: message, projects: 0, alerts: 0 };
  }
}
