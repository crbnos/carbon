import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { inngest } from "../../client";
import {
  assemblerEnabled,
  internalizeStorageUrl,
  POLL_GAP,
  pollAssemblerJobOnce,
  submitAssemblerJob
} from "./assembler-client";
import { loadPlanUnits } from "./plan-units";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// This function holds its run for the whole plan (it long-polls to completion),
// so the global concurrency limit caps concurrent long-running plans
// cluster-wide. Keep it aligned with the service's ASSEMBLER_MAX_CONCURRENCY
// (default 2) so Inngest queues surplus plans instead of 429-storming.
const PLAN_CONCURRENCY = 2;
// Total wall-clock budget before giving up, bounded by time (not a fixed poll
// count) so it holds whether the service long-polls or returns immediately.
const MAX_PLAN_WAIT_MS = 40 * 60 * 1000;

/**
 * Runs the assembler service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored as
 * plan.json next to the model artifacts. See
 * .ai/specs/2026-07-04-animated-work-instructions-contracts.md (POST /v1/plan,
 * GET /v1/jobs/{id}).
 *
 * One durable function owns the whole lifecycle: create job → long-poll
 * GET /v1/jobs/{id} until the service finishes → flip the job row. Each poll
 * carries a freshly minted signed upload URL (X-Carbon-Upload-Urls {plan}); the
 * service PUTs plan.json to it (late-mint offload) and stores only a
 * {result, stats} pointer in its Redis-backed store, so a restart still answers
 * the poll (no 404-on-restart loss).
 */
export const assemblyPlanFunction = inngest.createFunction(
  {
    id: "assembly-plan",
    retries: 2,
    concurrency: [
      { limit: PLAN_CONCURRENCY },
      { key: "event.data.companyId", limit: 1 }
    ],
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

    // Where plan.json lands. The service PUTs it here itself (offload) via a
    // signed upload URL minted fresh on each poll (below); this run just records
    // the pointer the service reports back.
    const planPath = `${companyId}/models/${modelUploadId}/${job.id}/plan.json`;

    const failJob = async (label: string, error: string) => {
      await step.run(label, async () => {
        const client = getCarbonServiceRole();
        await client
          .from("assemblyPlanJob")
          .update({
            status: "Failed",
            error,
            updatedAt: new Date().toISOString()
          })
          .eq("id", job.id)
          .eq("companyId", companyId)
          .eq("status", "Processing");
      });
      logger.warn("plan failed", { jobId: job.id, error });
      return { jobId: job.id, status: "Failed" as const, error };
    };

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

    // Create the plan job. The service starts it in the background and returns
    // 202; we then long-poll GET /v1/jobs/{id}. A fresh signed source URL is
    // minted here so retries don't reuse an expired one. Idempotent on job.id.
    await step.run("submit", async () => {
      const client = getCarbonServiceRole();

      // Raw source lives in `temp-staging` (2.5 GB cap).
      const source = await client.storage
        .from("temp-staging")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }

      await submitAssemblerJob({
        action: "plan",
        jobId: job.id,
        logger,
        body: {
          source: {
            url: internalizeStorageUrl(source.data.signedUrl),
            format: "step"
          },
          // No upload URL here — it's minted fresh on each poll (late-mint) so
          // the token is only seconds old when the service PUTs plan.json. The
          // service reads planPath (completion pointer) and modelUploadId (to
          // scope its content-hash result cache) out of meta.
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
        }
      });
      logger.info("plan submitted to assembler service", { jobId: job.id });
    });

    // Long-poll GET /v1/jobs/{id}?wait until the service finishes. Each request
    // holds open server-side until the plan lands (or ~25s elapses), so
    // completion is near-immediate and each is a checkpointed step (a worker
    // restart resumes the loop). The service offloaded plan.json to storage, so
    // the result carries only a { planPath } pointer — not the plan body.
    let resolvedPlanPath: string | null = null;
    let inlinePlan: AssemblyPlan | null = null;
    let stats: Json = null;
    let finished = false;
    const planStartedAt = await step.run("plan-poll-start", () => Date.now());
    let i = 0;
    while (Date.now() - planStartedAt < MAX_PLAN_WAIT_MS) {
      const poll = await step.run(`poll-${i}`, () =>
        pollAssemblerJobOnce({
          jobId: job.id,
          // Mint a fresh upload URL for THIS poll (late-mint). The service holds
          // the finished plan until a poll carries a URL, then PUTs plan.json
          // with this seconds-old token.
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
        })
      );

      if (poll.status === "done") {
        const result = (poll.result ?? {}) as {
          planPath?: string;
          plan?: AssemblyPlan | null;
        };
        resolvedPlanPath = result.planPath ?? planPath;
        inlinePlan = result.plan ?? null;
        stats = poll.stats;
        finished = true;
        break;
      }
      if (poll.status === "error") {
        return failJob("mark-failed", poll.error);
      }
      await step.sleep(`gap-${i}`, POLL_GAP);
      i++;
    }

    if (!finished) {
      return failJob(
        "mark-failed",
        "Planner did not finish in the expected time"
      );
    }
    const donePlanPath = resolvedPlanPath ?? planPath;

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
