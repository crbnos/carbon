import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { inngest } from "../../client";

// A plan run younger than this is left alone — the completion event is almost
// certainly still in flight. Older Processing rows get one status check.
const STALE_AFTER_MS = 90 * 1000;
const SWEEP_LIMIT = 20;

/**
 * Safety net for the event-driven plan pipeline: finds plan jobs stuck in
 * Processing (lost completion event, misconfigured INNGEST_EVENT_KEY on the
 * service, or a service restart that dropped the in-memory job) and settles
 * them — by re-emitting `carbon/assembly-plan-done` from the service's status
 * (so assembly-plan-finalize stays the single completion codepath), or by
 * failing rows the service no longer knows about.
 */
export const assemblyPlanReconcileFunction = inngest.createFunction(
  {
    id: "assembly-plan-reconcile",
    retries: 0
  },
  { cron: "*/2 * * * *" },
  async ({ step, logger }) => {
    if (!ASSEMBLER_SERVICE_URL) return { checked: 0 };

    const stale = await step.run("find-stale", async () => {
      const client = getCarbonServiceRole();
      const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
      const rows = await client
        .from("assemblyPlanJob")
        .select("id, companyId, modelUploadId")
        .eq("kind", "plan")
        .eq("status", "Processing")
        .lt("updatedAt", cutoff)
        .order("updatedAt", { ascending: true })
        .limit(SWEEP_LIMIT);
      return rows.data ?? [];
    });

    if (stale.length === 0) return { checked: 0 };

    const results = await step.run("check-service", async () => {
      const client = getCarbonServiceRole();
      const settled: { jobId: string; outcome: string }[] = [];

      for (const row of stale) {
        let body: {
          status?: string;
          error?: string;
          stats?: Record<string, unknown>;
          planUploaded?: boolean;
          componentCount?: number;
          plannedCount?: number;
          plan?: unknown;
          meta?: Record<string, unknown>;
        } | null = null;
        let httpStatus = 0;
        try {
          const response = await fetch(
            `${ASSEMBLER_SERVICE_URL}/plan/${row.id}`,
            {
              headers: ASSEMBLER_SERVICE_API_KEY
                ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
                : {},
              signal: AbortSignal.timeout(10_000)
            }
          );
          httpStatus = response.status;
          body = await response.json().catch(() => null);
        } catch {
          // Service unreachable: leave the row for the next sweep — failing
          // jobs because of a transient outage would strand real runs.
          settled.push({ jobId: row.id, outcome: "service-unreachable" });
          continue;
        }

        if (httpStatus === 404) {
          // The service restarted and lost the in-memory job — it will never
          // finish. Fail the row so the UI unblocks.
          await client
            .from("assemblyPlanJob")
            .update({
              status: "Failed",
              error: "The geometry service lost the plan job (restarted?)",
              updatedAt: new Date().toISOString()
            })
            .eq("id", row.id)
            .eq("status", "Processing");
          settled.push({ jobId: row.id, outcome: "lost" });
          continue;
        }

        if (body?.status === "done" || body?.status === "error") {
          // Legacy Python service: it never uploads plan.json — the plan rides
          // the status body. Upload it to the deterministic path here so
          // finalize can treat every completion uniformly.
          let planUploaded = body.planUploaded === true;
          if (body.status === "done" && !planUploaded && body.plan != null) {
            const planPath = `${row.companyId}/models/${row.modelUploadId}/${row.id}/plan.json`;
            const upload = await client.storage
              .from("private")
              .upload(planPath, JSON.stringify(body.plan), {
                contentType: "application/json",
                upsert: true
              });
            if (upload.error) {
              settled.push({ jobId: row.id, outcome: "plan-upload-failed" });
              continue;
            }
            planUploaded = true;
          }

          // Re-emit the completion event the push should have delivered;
          // finalize handles it exactly like a service push (meta included in
          // the status body).
          await inngest.send({
            name: "carbon/assembly-plan-done",
            data: {
              jobId: row.id,
              status: body.status as "done" | "error",
              ...(body.error ? { error: body.error } : {}),
              stats: {
                ...(body.stats ?? {}),
                planUploaded,
                componentCount: body.componentCount,
                plannedCount: body.plannedCount
              },
              ...(body.meta ? { meta: body.meta } : {})
            }
          });
          settled.push({ jobId: row.id, outcome: `re-emitted:${body.status}` });
          continue;
        }

        // pending/running: genuinely still working — touch updatedAt so the
        // row leaves the stale window until the next real change.
        await client
          .from("assemblyPlanJob")
          .update({ updatedAt: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "Processing");
        settled.push({ jobId: row.id, outcome: "still-running" });
      }
      return settled;
    });

    logger.info("plan reconcile sweep", { checked: stale.length, results });
    return { checked: stale.length, results };
  }
);
