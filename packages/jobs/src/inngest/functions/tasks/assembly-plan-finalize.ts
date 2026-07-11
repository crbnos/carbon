import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
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
    const meta = event.data.meta as PlanDoneMeta | undefined;

    if (!meta?.companyId || !meta.planPath) {
      // A service that doesn't echo meta can't be finalized from the event
      // alone; the reconciler will fail the row if it stays Processing.
      throw new NonRetriableError(
        `assembly-plan-done for ${jobId} carries no meta; cannot finalize`
      );
    }

    const claimed = await step.run("claim-job", async () => {
      const client = getCarbonServiceRole();
      const row = await client
        .from("assemblyPlanJob")
        .select("id")
        .eq("id", jobId)
        .eq("companyId", meta.companyId)
        .eq("kind", "plan")
        .eq("status", "Processing")
        .maybeSingle();
      return Boolean(row.data?.id);
    });

    if (!claimed) {
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
      // The service uploads plan.json to the signed URL before pushing the
      // event; planUploaded=false means that contract broke — fail loudly
      // rather than record a Success pointing at a missing artifact.
      if (stats?.planUploaded !== true) {
        await client
          .from("assemblyPlanJob")
          .update({
            status: "Failed",
            error: "Planner reported done but did not upload plan.json",
            updatedAt: new Date().toISOString()
          })
          .eq("id", jobId)
          .eq("companyId", meta.companyId)
          .eq("status", "Processing");
        throw new NonRetriableError("plan-done event without uploaded plan");
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
