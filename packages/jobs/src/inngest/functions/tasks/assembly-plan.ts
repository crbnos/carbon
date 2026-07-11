import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { GEOMETRY_SERVICE_API_KEY, GEOMETRY_SERVICE_URL } from "@carbon/env";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { inngest } from "../../client";
import { loadPlanUnits } from "./plan-units";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds
// Every geometry HTTP call is short (submit or a status check), so a tight
// per-request timeout is safe and catches a genuinely unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// The geometry service pushes `carbon/assembly-plan-done` when the job
// finishes. We interleave waitForEvent with a status poll: an event-capable
// service resolves the wait instantly; a service that doesn't push (Python,
// or Rust without INNGEST_EVENT_KEY) degrades to a ~60s poll cadence instead
// of stalling a full event-timeout. 30 rounds x 60s = 30 min budget.
const PLAN_WAIT_ROUNDS = 30;
const PLAN_WAIT_INTERVAL = "60s";
// Bounded backoff when the service 429s a submit (all slots busy) — honors
// Retry-After so Inngest's own retries don't hammer the semaphore.
const BUSY_RETRIES = 4;

const authHeaders: Record<string, string> = GEOMETRY_SERVICE_API_KEY
  ? { Authorization: `Bearer ${GEOMETRY_SERVICE_API_KEY}` }
  : {};

/**
 * Runs the geometry service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored
 * as plan.json next to the model artifacts. See
 * docs/specs/animated-work-instructions-contracts.md (POST /plan).
 */
export const assemblyPlanFunction = inngest.createFunction(
  {
    id: "assembly-plan",
    retries: 2,
    concurrency: [{ limit: 4 }, { key: "event.data.companyId", limit: 1 }],
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
    const { modelUploadId, companyId, userId, reMotionFor, planJobId } =
      event.data;

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

    if (!GEOMETRY_SERVICE_URL) {
      throw new Error("GEOMETRY_SERVICE_URL is not configured");
    }
    const geometryUrl = GEOMETRY_SERVICE_URL;

    // Re-motion mode (order-preserving): take the existing step order as the
    // fixed assembly sequence and let the planner only recompute each step's
    // motion (forward-collision against earlier steps). Otherwise plan fresh:
    // collapse the model's leaf soup into rigid-body units so a 400-part model
    // plans as its ~7 assembled units. Best-effort: no units → every leaf.
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
        : await step.run("derive-units", () =>
            loadPlanUnits({
              modelUploadId,
              companyId,
              graphPath: job.graphPath
            })
          );

    // Where the service uploads plan.json directly (mirrors /convert's signed
    // artifact PUTs) — the large plan body never rides the event/poll payloads.
    const planPath = `${companyId}/models/${modelUploadId}/${job.id}/plan.json`;

    // Kick off the planner. The service starts it in the background and returns
    // immediately, so the request is short — no connection is held open across
    // the multi-minute run (which no HTTP hop survives). A fresh signed source
    // URL is minted per submit so retries don't reuse an expired one.
    const submitPlan = async () => {
      const client = getCarbonServiceRole();

      const source = await client.storage
        .from("private")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }
      // upsert: retries re-upload to the same path
      const planUpload = await client.storage
        .from("private")
        .createSignedUploadUrl(planPath, { upsert: true });
      if (planUpload.error) {
        throw new Error(
          `Failed to sign plan upload URL: ${planUpload.error.message}`
        );
      }

      const body = JSON.stringify({
        jobId: job.id,
        source: { url: source.data.signedUrl, format: "step" },
        outputs: { plan: { url: planUpload.data.signedUrl } },
        ...(sequence != null
          ? { options: { sequence } }
          : units.length > 0
            ? { options: { units } }
            : {})
      });

      // Bounded 429 backoff honoring Retry-After: the service sheds load with
      // BUSY when its slots are full; hammering it via instant retries only
      // extends the outage.
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${geometryUrl}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });

        if (response.status === 429 && attempt < BUSY_RETRIES) {
          const retryAfter = Number(response.headers.get("retry-after")) || 15;
          const waitMs = Math.min(retryAfter * 1000 * (attempt + 1), 120_000);
          logger.warn("geometry /plan busy (429); backing off", {
            jobId: job.id,
            attempt,
            waitMs
          });
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
        } | null;
        if (!response.ok || !result?.ok) {
          throw new Error(
            result?.error ?? `Geometry service returned ${response.status}`
          );
        }
        logger.info("plan submitted to geometry service", { jobId: job.id });
        return { ok: true };
      }
    };

    await step.run("start-plan", submitPlan);

    // Interleaved wait: each round arms waitForEvent for one interval, then
    // (if no event) polls the status endpoint once. An event-capable service
    // resolves round 0 the moment the plan finishes; a legacy service that
    // never pushes completes via the poll at a ~60s cadence. Either way the
    // step count stays tiny next to the old 15s busy-poll.
    let stats: Json = null;
    let planUploaded = false;
    let planFromPoll: Json | null = null;
    let finished = false;

    for (let round = 0; round < PLAN_WAIT_ROUNDS && !finished; round++) {
      const done = await step.waitForEvent(`await-plan-${round}`, {
        event: "carbon/assembly-plan-done",
        if: `async.data.jobId == "${job.id}"`,
        timeout: PLAN_WAIT_INTERVAL
      });

      if (done != null) {
        logger.info("plan completion event received", {
          jobId: job.id,
          round,
          status: done.data.status
        });
        if (done.data.status === "error") {
          throw new Error(done.data.error ?? "Motion planning failed");
        }
        const s = (done.data.stats ?? {}) as Record<string, unknown>;
        planUploaded = s.planUploaded === true;
        stats = {
          planMs: s.planMs,
          tiers: s.tiers,
          warnings: s.warnings,
          verifiedCount: s.verifiedCount
        } as Json;
        finished = true;
        break;
      }

      const status = await step.run(`plan-poll-${round}`, async () => {
        const response = await fetch(`${geometryUrl}/plan/${job.id}`, {
          headers: authHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (response.status === 404) return { status: "missing" as const };
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          status?: string;
          plan?: Json;
          planUploaded?: boolean;
          stats?: Record<string, unknown>;
          error?: string;
        } | null;
        if (!response.ok || !body?.ok) {
          throw new Error(
            body?.error ?? `Geometry status check returned ${response.status}`
          );
        }
        return body;
      });
      logger.info("plan status poll", {
        jobId: job.id,
        round,
        status: status.status
      });
      if (status.status === "missing") {
        // Service restarted and lost the job (in-process registry). Failing
        // here hands recovery to Inngest's function retry, which re-submits.
        throw new Error("The geometry service lost the plan job (restarted?)");
      }
      if (status.status === "error") {
        throw new Error(status.error ?? "Motion planning failed");
      }
      if (status.status === "done") {
        planUploaded = status.planUploaded === true;
        planFromPoll = (status.plan ?? null) as Json;
        stats = (status.stats ?? null) as Json;
        finished = true;
      }
    }

    if (!finished) {
      throw new Error("Motion planning did not finish in time");
    }

    logger.info("persisting plan", { jobId: job.id, planUploaded });
    await step.run("persist-plan", async () => {
      const client = getCarbonServiceRole();

      // The service normally uploads plan.json to the signed URL itself; the
      // app upload only remains for the fallback-poll path against a service
      // that returned the plan by value without uploading.
      if (!planUploaded) {
        if (planFromPoll == null) {
          throw new Error("Planner reported done but no plan was uploaded");
        }
        const upload = await client.storage
          .from("private")
          .upload(planPath, JSON.stringify(planFromPoll), {
            contentType: "application/json",
            upsert: true
          });
        if (upload.error) {
          throw new Error(`Failed to upload plan: ${upload.error.message}`);
        }
      }

      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          planPath,
          stats,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id);
    });

    // Re-motion: the plan preserved the step order — update each step's motion
    // in place (Done steps kept, order/titles/typed fields untouched). The plan
    // lives in storage (uploaded by the service, or by persist-plan above).
    if (reMotionFor) {
      await step.run("update-step-motions", async () => {
        const client = getCarbonServiceRole();
        const planFile = await client.storage
          .from("private")
          .download(planPath);
        if (planFile.error || !planFile.data) {
          throw new Error(
            `Failed to download plan for re-motion: ${planFile.error?.message ?? "no data"}`
          );
        }
        const plan = JSON.parse(await planFile.data.text()) as AssemblyPlan;
        await updateAssemblyStepMotionsFromPlan(client, {
          assemblyInstructionId: reMotionFor,
          plan,
          graphPath: job.graphPath,
          companyId,
          userId
        });
      });
    }
  }
);
