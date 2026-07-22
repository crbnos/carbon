import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { inngest } from "../../client";
import {
  assemblerEnabled,
  internalizeStorageUrl,
  resolveModelSourceBucket,
  runAssemblerJob
} from "./assembler-client";
import { loadPlanUnits } from "./plan-units";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// Total wall-clock budget before giving up, bounded by time (not a fixed poll
// count) so it holds whether the service long-polls or returns immediately.
const MAX_PLAN_WAIT_MS = 40 * 60 * 1000;

/**
 * Runs the assembler service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored as
 * plan.json next to the model artifacts. See
 * .ai/specs/2026-07-04-assembler-deployment.md (POST /v1/plan, callback).
 *
 * Event-driven like optimize/convert (`runAssemblerJob`): submit with
 * submit-time signed upload URLs + a callback URL, park on waitForEvent until
 * the service's completion callback fires, one late-mint fallback poll on
 * timeout. The service PUTs plan.json to the upload URL itself and reports a
 * { planPath } pointer; this run just flips the job row.
 */
export const assemblyPlanFunction = inngest.createFunction(
  {
    id: "assembly-plan",
    retries: 2,
    onFailure: async ({ event }) => {
      const { modelUploadId } = event.data.event.data;
      const client = getCarbonServiceRole();

      // Queued included: a pre-created row (planJobId) stays Queued when the
      // function fails before its "queue" step promotes it to Processing.
      await client
        .from("assemblyPlanJob")
        .update({
          status: "Failed",
          error: event.data.error.message,
          updatedAt: new Date().toISOString()
        })
        .eq("modelUploadId", modelUploadId)
        .eq("kind", "plan")
        .in("status", ["Queued", "Processing"]);
    }
  },
  { event: "carbon/assembly-plan" },
  async ({ event, step, logger }) => {
    const {
      modelUploadId,
      companyId,
      userId,
      reMotionFor,
      planJobId,
      reDetectUnits
    } = event.data;

    // Feature-gated. Plan is an explicit user action ("Generate Steps"), so a
    // pre-created Queued row is failed with a clear reason instead of hanging.
    if (!assemblerEnabled()) {
      if (planJobId) {
        await step.run("mark-unconfigured", async () => {
          const client = getCarbonServiceRole();
          await client
            .from("assemblyPlanJob")
            .update({
              status: "Failed",
              error: "Assembler service is not configured",
              updatedAt: new Date().toISOString()
            })
            .eq("id", planJobId)
            .eq("companyId", companyId);
        });
      }
      logger.info("assembly plan skipped — assembler is not configured", {
        modelUploadId
      });
      return { jobId: planJobId ?? null, status: "Skipped" as const };
    }

    const job = await step.run("queue", async () => {
      const client = getCarbonServiceRole();

      const modelUpload = await client
        .from("modelUpload")
        .select("id, modelPath, graphPath, processingStatus")
        .eq("id", modelUploadId)
        .eq("companyId", companyId)
        .single();

      if (modelUpload.error || !modelUpload.data?.modelPath) {
        throw new Error(
          `Model upload ${modelUploadId} not found or has no file`
        );
      }

      // Adopt the trigger's pre-created row when given (created Queued so the
      // UI shows "planning" from the moment of the click); fall back to
      // inserting a row when adoption fails.
      if (planJobId) {
        const adopted = await client
          .from("assemblyPlanJob")
          .update({ status: "Processing", updatedAt: new Date().toISOString() })
          .eq("id", planJobId)
          .eq("companyId", companyId)
          .select("id")
          .maybeSingle();

        if (adopted.data?.id) {
          return {
            id: adopted.data.id,
            modelPath: modelUpload.data.modelPath,
            graphPath: modelUpload.data.graphPath
          };
        }
      }

      const planJob = await client
        .from("assemblyPlanJob")
        .insert({
          modelUploadId,
          kind: "plan",
          status: "Processing",
          companyId,
          createdBy: userId
        })
        .select("id")
        .single();

      if (planJob.error) {
        throw new Error(
          `Failed to create assembly plan job: ${planJob.error.message}`
        );
      }

      return {
        id: planJob.data.id,
        modelPath: modelUpload.data.modelPath,
        graphPath: modelUpload.data.graphPath
      };
    });

    // Where plan.json lands. The service PUTs it here itself (offload) via the
    // submit-time signed upload URL; this run just records the pointer the
    // service reports back.
    const planPath = `${companyId}/models/${modelUploadId}/${job.id}/plan.json`;

    // Re-motion mode (order-preserving): take the existing step order as the
    // fixed assembly sequence and let the planner only recompute each step's
    // motion (forward-collision against earlier steps). Otherwise plan fresh:
    // send the user-authored "plan as one component" overrides as units — the
    // planner auto-detects PCB detail swarms from geometry on its own.
    const sequence = reMotionFor
      ? await step.run("derive-sequence", async () => {
          const client = getCarbonServiceRole();
          const steps = await client
            .from("assemblyInstructionStep")
            .select("componentNodeIds")
            .eq("assemblyInstructionId", reMotionFor)
            .eq("companyId", companyId)
            .order("sortOrder", { ascending: true });
          // Every step's parts (Done included — they're obstacles) in order.
          return (steps.data ?? [])
            .map((row) => row.componentNodeIds ?? [])
            .filter((group) => group.length > 0);
        })
      : null;
    const units =
      sequence != null
        ? []
        : await step.run("load-authored-units", () =>
            loadPlanUnits({
              modelUploadId,
              companyId,
              excludeAuto: reDetectUnits
            })
          );

    // Submit with submit-time upload URLs + callback, then park on the
    // completion event (one late-mint fallback poll on timeout). A failure or
    // cancel throws — retries then onFailure flip the job row to Failed.
    const plan = await runAssemblerJob(step, {
      idPrefix: "plan",
      action: "plan",
      jobId: job.id,
      maxWaitMs: MAX_PLAN_WAIT_MS,
      logger,
      buildBody: async () => {
        const client = getCarbonServiceRole();
        // Legacy (pre-assembler) raws live in `private`, current ones in
        // `temp-staging`.
        const sourceBucket = await resolveModelSourceBucket(
          client,
          job.modelPath
        );
        const source = await client.storage
          .from(sourceBucket)
          .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
        if (source.error) {
          throw new Error(`Failed to sign source URL: ${source.error.message}`);
        }
        return {
          source: {
            url: internalizeStorageUrl(source.data.signedUrl),
            format: "step"
          },
          // The service reads planPath (completion pointer) and modelUploadId
          // (to scope its content-hash result cache) out of meta.
          meta: {
            companyId,
            userId,
            modelUploadId,
            reMotionFor: reMotionFor ?? null,
            graphPath: job.graphPath ?? null,
            planPath
          },
          ...(sequence != null
            ? { options: { sequence } }
            : units.length > 0
              ? { options: { units } }
              : {})
        };
      },
      mintUploadUrls: async () => {
        const client = getCarbonServiceRole();
        const upload = await client.storage
          .from("private")
          .createSignedUploadUrl(planPath, { upsert: true });
        const urls: Record<string, string> = {};
        if (upload.data)
          urls.plan = internalizeStorageUrl(upload.data.signedUrl);
        return urls;
      }
    });

    const planResult = (plan.result ?? {}) as {
      planPath?: string;
      plan?: AssemblyPlan | null;
    };
    const donePlanPath = planResult.planPath ?? planPath;
    const inlinePlan = planResult.plan ?? null;
    const stats: Json = plan.stats;

    // Persist: flip the row to the pointer the service reported. A legacy
    // response returned the plan inline instead of offloading — upload it here in
    // that case. Guarded by status=Processing so a cancel/racing-retry no-ops.
    await step.run("persist-plan", async () => {
      const client = getCarbonServiceRole();
      if (inlinePlan) {
        const upload = await client.storage
          .from("private")
          .upload(donePlanPath, JSON.stringify(inlinePlan), {
            contentType: "application/json",
            upsert: true
          });
        if (upload.error) {
          throw new Error(
            `Failed to upload plan.json: ${upload.error.message}`
          );
        }
      }
      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          planPath: donePlanPath,
          stats,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id)
        .eq("companyId", companyId)
        .eq("status", "Processing");
    });

    // Re-motion: preserve step order, refresh each step's motion from the new
    // plan (Done steps kept, titles/typed fields untouched). The plan lives in
    // storage now (offloaded), so download it unless the legacy inline path
    // already has it in memory.
    if (reMotionFor) {
      await step.run("update-step-motions", async () => {
        const client = getCarbonServiceRole();
        let plan = inlinePlan;
        if (!plan) {
          const download = await client.storage
            .from("private")
            .download(donePlanPath);
          if (download.error || !download.data) {
            throw new Error(
              `Failed to download plan.json for re-motion: ${download.error?.message ?? "not found"}`
            );
          }
          plan = JSON.parse(await download.data.text()) as AssemblyPlan;
        }
        await updateAssemblyStepMotionsFromPlan(client, {
          assemblyInstructionId: reMotionFor,
          plan,
          graphPath: job.graphPath ?? null,
          companyId,
          userId
        });
      });
    }

    logger.info("plan finalized", {
      jobId: job.id,
      reMotion: Boolean(reMotionFor)
    });
    return { jobId: job.id, status: "Success" as const };
  }
);
