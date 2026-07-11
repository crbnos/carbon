import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

type PlanDoneMeta = {
  companyId: string;
  userId: string;
  modelUploadId: string;
  reMotionFor: string | null;
  graphPath: string | null;
  planPath: string;
};

/**
 * Pull a completed plan straight from the service (GET /plan/{jobId} returns the
 * plan body while the job stays in memory). Used when the signed upload URL
 * expired before the service could PUT plan.json, so the worker uploads it with
 * the service role instead. Returns null if the service is unreachable or no
 * longer holds the job (a restart).
 */
async function fetchPlanFromService(
  jobId: string
): Promise<AssemblyPlan | null> {
  if (!ASSEMBLER_SERVICE_URL) return null;
  try {
    const response = await fetch(`${ASSEMBLER_SERVICE_URL}/plan/${jobId}`, {
      headers: ASSEMBLER_SERVICE_API_KEY
        ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      plan?: AssemblyPlan;
    } | null;
    if (body?.status !== "done" || body.plan == null) return null;
    return body.plan;
  } catch {
    return null;
  }
}

/**
 * Finalizes a motion-plan run when the geometry service pushes
 * `carbon/assembly-plan-done` (assembly-plan-reconcile re-emits the same event
 * for jobs whose push was lost, so this is the ONLY completion codepath).
 * Idempotent: it only acts while the job row is still Processing — a cancelled
 * job, a duplicate event, or an event racing the reconciler all no-op here.
 * All context rides the event's `meta` (echoed verbatim from the submit).
 */
export const assemblyPlanFinalizeFunction = inngest.createFunction(
  {
    id: "assembly-plan-finalize",
    retries: 2
  },
  { event: "carbon/assembly-plan-done" },
  async ({ event, step, logger }) => {
    const { jobId, status, error, stats } = event.data;
    const eventMeta = event.data.meta as PlanDoneMeta | undefined;

    // Claim + context in one lookup. `meta` (echoed from the submit) is the
    // fast path; a meta-less event — the legacy Python service via the
    // reconciler — reconstructs everything except reMotionFor from the job
    // row (planPath is deterministic, userId = the row's creator). Without
    // this fallback a meta-less completion loops forever: reconcile re-emits,
    // finalize rejects, the row never leaves Processing.
    const meta = await step.run(
      "claim-job",
      async (): Promise<PlanDoneMeta | null> => {
        const client = getCarbonServiceRole();
        const row = await client
          .from("assemblyPlanJob")
          .select(
            "id, companyId, modelUploadId, createdBy, modelUpload(graphPath)"
          )
          .eq("id", jobId)
          .eq("kind", "plan")
          .eq("status", "Processing")
          .maybeSingle();
        if (!row.data?.id) return null;
        if (eventMeta?.companyId && eventMeta.planPath) {
          if (eventMeta.companyId !== row.data.companyId) return null;
          return eventMeta;
        }
        logger.warn(
          "plan-done event carries no meta (legacy service); reconstructed from the job row — re-motion unavailable for this run",
          { jobId }
        );
        return {
          companyId: row.data.companyId,
          userId: row.data.createdBy,
          modelUploadId: row.data.modelUploadId,
          reMotionFor: null,
          graphPath: row.data.modelUpload?.graphPath ?? null,
          planPath: `${row.data.companyId}/models/${row.data.modelUploadId}/${jobId}/plan.json`
        };
      }
    );

    if (!meta) {
      logger.info("plan-done event skipped (job not Processing)", { jobId });
      return { finalized: false };
    }

    if (status === "error") {
      await step.run("mark-failed", async () => {
        const client = getCarbonServiceRole();
        await client
          .from("assemblyPlanJob")
          .update({
            status: "Failed",
            error: error ?? "Motion planning failed",
            updatedAt: new Date().toISOString()
          })
          .eq("id", jobId)
          .eq("companyId", meta.companyId)
          .eq("status", "Processing");
      });
      return { finalized: true, status: "Failed" };
    }

    await step.run("persist-plan", async () => {
      const client = getCarbonServiceRole();
      // The service PUTs plan.json to a signed upload URL before pushing the
      // event, but that token is short-lived (~60s) — an async plan that
      // finishes after it expires can't upload there. planUploaded=false is
      // therefore NOT a lost plan: the service still holds it at
      // GET /plan/{jobId}, so pull it and upload with the service role (no
      // token expiry). Only a plan we genuinely can't recover fails the job.
      if (stats?.planUploaded !== true) {
        const recovered = await fetchPlanFromService(jobId);
        if (!recovered) {
          await client
            .from("assemblyPlanJob")
            .update({
              status: "Failed",
              error: "Planner finished but plan.json could not be recovered",
              updatedAt: new Date().toISOString()
            })
            .eq("id", jobId)
            .eq("companyId", meta.companyId)
            .eq("status", "Processing");
          throw new NonRetriableError(
            "plan-done event without recoverable plan"
          );
        }
        const upload = await client.storage
          .from("private")
          .upload(meta.planPath, JSON.stringify(recovered), {
            contentType: "application/json",
            upsert: true
          });
        if (upload.error) {
          throw new Error(
            `Failed to upload recovered plan.json: ${upload.error.message}`
          );
        }
        logger.info("uploaded plan.json worker-side (signed URL expired)", {
          jobId
        });
      }

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          planPath: meta.planPath,
          stats: (stats ?? null) as Json,
          updatedAt: new Date().toISOString()
        })
        .eq("id", jobId)
        .eq("companyId", meta.companyId)
        .eq("status", "Processing");
    });

    // Re-motion: preserve step order, refresh each step's motion from the new
    // plan (Done steps kept, titles/typed fields untouched).
    if (meta.reMotionFor) {
      await step.run("update-step-motions", async () => {
        const client = getCarbonServiceRole();
        const planFile = await client.storage
          .from("private")
          .download(meta.planPath);
        if (planFile.error || !planFile.data) {
          throw new Error(
            `Failed to download plan for re-motion: ${planFile.error?.message ?? "no data"}`
          );
        }
        const plan = JSON.parse(await planFile.data.text()) as AssemblyPlan;
        await updateAssemblyStepMotionsFromPlan(client, {
          assemblyInstructionId: meta.reMotionFor!,
          plan,
          graphPath: meta.graphPath,
          companyId: meta.companyId,
          userId: meta.userId
        });
      });
    }

    logger.info("plan finalized", {
      jobId,
      reMotion: Boolean(meta.reMotionFor)
    });
    return { finalized: true, status: "Success" };
  }
);
