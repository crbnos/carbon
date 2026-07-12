import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import type { AssemblyPlan } from "@carbon/viewer/steps";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import { loadPlanUnits } from "./plan-units";
import { updateAssemblyStepMotionsFromPlan } from "./update-step-motions";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds — the source (read) URL only.
// Every geometry HTTP call is short (a submit), so a tight per-request timeout
// is safe and catches a genuinely unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// Bounded backoff when the service 429s a submit (all slots busy) — honors
// Retry-After so Inngest's own retries don't hammer the semaphore.
const BUSY_RETRIES = 4;
// This function holds its run for the whole plan (it long-polls to completion),
// so the global concurrency limit caps concurrent long-running plans
// cluster-wide. Keep it aligned with the service's ASSEMBLER_MAX_CONCURRENCY
// (default 2) so Inngest queues surplus plans instead of 429-storming.
const PLAN_CONCURRENCY = 2;
// Long-poll: GET /plan/{id}?wait=N holds the request open until the plan
// finishes (or N elapses), so completion is near-immediate and a whole plan
// costs a handful of checkpointed steps, not ~180 short polls. The client
// timeout must exceed the server hold.
const LONG_POLL_WAIT_S = 25;
const LONG_POLL_TIMEOUT_MS = (LONG_POLL_WAIT_S + 10) * 1000;
// Floor between polls. When the service actually holds the request for ~25s this
// is negligible; when a poll returns immediately (a service without ?wait
// support, a 404, or a network blip) this is what stops the loop from hammering
// Inngest with back-to-back re-invocations.
const POLL_GAP = "3s";
// Total wall-clock budget before giving up, bounded by time (not a fixed poll
// count) so it holds whether the service long-polls or returns immediately.
const MAX_PLAN_WAIT_MS = 40 * 60 * 1000;

const authHeaders: Record<string, string> = ASSEMBLER_SERVICE_API_KEY
  ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
  : {};

/**
 * Runs the geometry service motion planner over a converted model: computes a
 * collision-free insertion motion per part plus an assembly sequence, stored as
 * plan.json next to the model artifacts. See
 * .ai/specs/2026-07-04-animated-work-instructions-contracts.md (POST /plan, GET /plan).
 *
 * One durable function owns the whole lifecycle: submit → long-poll GET /plan
 * until the service finishes → flip the job row. Each poll carries a freshly
 * minted signed upload URL (X-Plan-Upload-Url); the service PUTs plan.json to it
 * (late-mint offload) and stores only a {status, planPath, stats} pointer in its
 * Redis-backed store, so a restart still answers the poll (no 404-on-restart
 * loss). Long-poll (rather than short-poll or a pushed completion event) keeps
 * the whole flow inside this run with no dependency on service→Inngest events.
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
        // No upload URL here — it's minted fresh on each poll (late-mint) so the
        // token is only seconds old when the service PUTs plan.json. The service
        // reads planPath (for the completion pointer) and modelUploadId (to scope
        // its content-hash result cache) out of meta.
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
          const err = e as Error;
          // A timeout may be transient (the service was briefly saturated) — let
          // Inngest retry it. Genuine unreachability (down, DNS, TLS) is
          // permanent, so fail fast → onFailure releases the job row now instead
          // of after the retry backoff.
          if (err.name === "TimeoutError" || err.name === "AbortError") {
            throw new Error(
              `Geometry service timed out after ${REQUEST_TIMEOUT_MS}ms`
            );
          }
          throw new NonRetriableError(
            `Geometry service unreachable: ${err.message}`
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

    // Long-poll GET /plan?wait until the service finishes. Each request holds
    // open server-side until the plan lands (or ~25s elapses), so completion is
    // near-immediate and each is a checkpointed step (a worker restart resumes
    // the loop). The service offloaded plan.json to storage, so "done" carries
    // only a { planPath, stats } pointer — not the plan body. A legacy service
    // that ignored outputs.plan.url still returns the plan inline; handle both.
    let resolvedPlanPath: string | null = null;
    let inlinePlan: AssemblyPlan | null = null;
    let stats: Json = null;
    let finished = false;
    // Bound by elapsed time, not a fixed poll count: the loop must behave whether
    // the service long-polls (few iterations) or returns immediately (many).
    const planStartedAt = await step.run("plan-poll-start", () => Date.now());
    let i = 0;
    while (Date.now() - planStartedAt < MAX_PLAN_WAIT_MS) {
      const poll = await step.run(`poll-${i}`, async () => {
        // Mint a fresh upload URL for THIS poll (late-mint). The service holds
        // the finished plan until a poll carries a URL, then PUTs plan.json with
        // this seconds-old token. Best-effort: a poll without it just keeps the
        // service waiting for the next one.
        const client = getCarbonServiceRole();
        const upload = await client.storage
          .from("private")
          .createSignedUploadUrl(planPath, { upsert: true });
        const headers: Record<string, string> = {
          ...authHeaders,
          ...(upload.data ? { "X-Plan-Upload-Url": upload.data.signedUrl } : {})
        };
        let response: Response;
        try {
          response = await fetch(
            `${geometryUrl}/plan/${job.id}?wait=${LONG_POLL_WAIT_S}`,
            {
              headers,
              signal: AbortSignal.timeout(LONG_POLL_TIMEOUT_MS)
            }
          );
        } catch {
          // A dropped/timed-out hold (service restart mid-hold, brief network
          // blip) is transient with the Redis-backed store — treat as "still
          // waiting" and long-poll again rather than failing the run.
          return { status: "pending" as const };
        }
        // 404 with the Redis store is rare (only a genuinely unknown/expired
        // job); treat as transient within the wall-clock window.
        if (response.status === 404) return { status: "pending" as const };
        const bodyJson = (await response.json().catch(() => null)) as {
          status?: string;
          planPath?: string;
          plan?: AssemblyPlan;
          stats?: Json;
          error?: string;
        } | null;
        if (!response.ok || !bodyJson) {
          throw new Error(`GET /plan returned ${response.status}`);
        }
        if (bodyJson.status === "done") {
          return {
            status: "done" as const,
            planPath: bodyJson.planPath ?? null,
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
        resolvedPlanPath = poll.planPath ?? planPath;
        inlinePlan = poll.plan;
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
    // service returned the plan inline instead of offloading — upload it here in
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
