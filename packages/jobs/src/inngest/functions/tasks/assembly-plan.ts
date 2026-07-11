import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import { loadPlanUnits } from "./plan-units";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// Every geometry HTTP call is short (a submit or a status poll), so a tight
// per-request timeout is safe and catches a genuinely unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
const GET_TIMEOUT_MS = 10 * 1000;
// Bounded backoff when the service 429s a submit (all slots busy) — honors
// Retry-After so Inngest's own retries don't hammer the semaphore.
const BUSY_RETRIES = 4;
// This function holds its run for the whole plan (it polls to completion), so
// the global concurrency limit caps concurrent long-running plans cluster-wide.
// Keep it aligned with the geometry service's ASSEMBLER_MAX_CONCURRENCY (default
// 2) so Inngest queues surplus plans instead of the service 429-storming them.
const PLAN_CONCURRENCY = 2;
// Poll cadence for GET /plan. A real plan runs for minutes, so the first check
// waits a beat; MAX_POLLS bounds total wait (~30 min) before giving up.
const FIRST_POLL_DELAY = "15s";
const POLL_INTERVAL = "10s";
const MAX_POLLS = 180;

const authHeaders: Record<string, string> = ASSEMBLER_SERVICE_API_KEY
  ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
  : {};

/**
 * Runs the geometry service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored as
 * plan.json next to the model artifacts. See
 * .ai/specs/2026-07-04-animated-work-instructions-contracts.md (POST /plan, GET /plan).
 *
 * One durable function owns the whole lifecycle: submit → poll GET /plan until
 * the service finishes → upload plan.json with the service role → flip the job.
 * The geometry service holds the finished plan in memory at GET /plan/{jobId}
 * and never uploads it itself (it has no storage credentials, and a caller-
 * minted upload URL expires long before a multi-minute plan finishes). Polling
 * (rather than a pushed completion event) keeps the whole flow inside this run
 * with no dependency on service→Inngest event delivery.
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

    if (!ASSEMBLER_SERVICE_URL) {
      throw new Error("ASSEMBLER_SERVICE_URL is not configured");
    }
    const geometryUrl = ASSEMBLER_SERVICE_URL;

    // The service role uploads plan.json here once the plan is done — no signed
    // upload URL (its token would expire mid-plan), no service-side upload.
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

    // Kick off the planner. The service starts it in the background and returns
    // 202 immediately; we then poll GET /plan below. A fresh signed source URL
    // is minted per submit so retries don't reuse an expired one.
    const submitPlan = async () => {
      const client = getCarbonServiceRole();

      const source = await client.storage
        .from("private")
        .createSignedUrl(job.modelPath, SIGNED_URL_EXPIRY);
      if (source.error) {
        throw new Error(`Failed to sign source URL: ${source.error.message}`);
      }

      const body = JSON.stringify({
        jobId: job.id,
        source: { url: source.data.signedUrl, format: "step" },
        // Echoed by the service in GET /plan/{id} for debugging; nothing reads
        // it back — this run knows planPath and handles completion itself.
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
      });

      // Bounded 429 backoff honoring Retry-After: the service sheds load with
      // BUSY when its slots are full; hammering it via instant retries only
      // extends the outage.
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetch(`${geometryUrl}/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          });
        } catch (e) {
          // Service unreachable (down, DNS, TLS): fail fast so onFailure
          // releases the job row now instead of after the retry backoff.
          throw new NonRetriableError(
            `Geometry service unreachable: ${(e as Error).message}`
          );
        }

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
          // Non-429 errors are an outage (5xx) or a permanent rejection (4xx):
          // retrying holds the job in Processing for nothing — fail fast.
          throw new NonRetriableError(
            result?.error ?? `Geometry service returned ${response.status}`
          );
        }
        logger.info("plan submitted to geometry service", { jobId: job.id });
        return { ok: true };
      }
    };

    await step.run("submit", submitPlan);

    // Poll GET /plan until the service finishes. Each poll is a checkpointed
    // step, so a worker restart resumes the loop where it left off. The plan
    // body only rides the final "done" poll (non-done polls return status only).
    let plan: AssemblyPlan | null = null;
    let stats: Json = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await step.sleep(`wait-${i}`, i === 0 ? FIRST_POLL_DELAY : POLL_INTERVAL);

      const poll = await step.run(`poll-${i}`, async () => {
        const response = await fetch(`${geometryUrl}/plan/${job.id}`, {
          headers: authHeaders,
          signal: AbortSignal.timeout(GET_TIMEOUT_MS)
        });
        // The service holds the job in memory; a 404 means it restarted and
        // lost it — the plan will never land.
        if (response.status === 404) return { status: "not_found" as const };
        const bodyJson = (await response.json().catch(() => null)) as {
          status?: string;
          plan?: AssemblyPlan;
          stats?: Json;
          error?: string;
        } | null;
        if (!response.ok || !bodyJson) {
          // Transient GET failure — throw so the step (not the whole run)
          // retries; the loop continues on success.
          throw new Error(`GET /plan returned ${response.status}`);
        }
        if (bodyJson.status === "done") {
          return {
            status: "done" as const,
            plan: bodyJson.plan ?? null,
            stats: bodyJson.stats ?? null
          };
        }
        if (bodyJson.status === "error") {
          return {
            status: "error" as const,
            error: bodyJson.error ?? "Motion planning failed"
          };
        }
        return { status: "pending" as const };
      });

      if (poll.status === "done") {
        plan = poll.plan;
        stats = poll.stats;
        break;
      }
      if (poll.status === "error") {
        return failJob("mark-failed", poll.error);
      }
      if (poll.status === "not_found") {
        return failJob(
          "mark-failed",
          "The geometry service lost the plan job (restarted?)"
        );
      }
    }

    if (!plan) {
      return failJob(
        "mark-failed",
        `Planner did not finish within ${MAX_POLLS} polls`
      );
    }
    const donePlan = plan;

    // Persist: upload plan.json with the service role (no token, no expiry),
    // then flip the row. Guarded by status=Processing so a cancel or a racing
    // retry no-ops.
    await step.run("persist-plan", async () => {
      const client = getCarbonServiceRole();
      const upload = await client.storage
        .from("private")
        .upload(planPath, JSON.stringify(donePlan), {
          contentType: "application/json",
          upsert: true
        });
      if (upload.error) {
        throw new Error(`Failed to upload plan.json: ${upload.error.message}`);
      }
      await client
        .from("assemblyPlanJob")
        .update({
          status: "Success",
          planPath,
          stats,
          updatedAt: new Date().toISOString()
        })
        .eq("id", job.id)
        .eq("companyId", companyId)
        .eq("status", "Processing");
    });

    // Re-motion: preserve step order, refresh each step's motion from the new
    // plan (Done steps kept, titles/typed fields untouched).
    if (reMotionFor) {
      await step.run("update-step-motions", async () => {
        const client = getCarbonServiceRole();
        await updateAssemblyStepMotionsFromPlan(client, {
          assemblyInstructionId: reMotionFor,
          plan: donePlan,
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
