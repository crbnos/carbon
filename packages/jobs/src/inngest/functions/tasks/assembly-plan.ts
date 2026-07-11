import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";
import { loadPlanUnits } from "./plan-units";

const SIGNED_URL_EXPIRY = 60 * 60; // seconds
// Every geometry HTTP call is short (submit or a status check), so a tight
// per-request timeout is safe and catches a genuinely unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// Bounded backoff when the service 429s a submit (all slots busy) — honors
// Retry-After so Inngest's own retries don't hammer the semaphore.
const BUSY_RETRIES = 4;

const authHeaders: Record<string, string> = ASSEMBLER_SERVICE_API_KEY
  ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
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

    if (!ASSEMBLER_SERVICE_URL) {
      throw new Error("ASSEMBLER_SERVICE_URL is not configured");
    }
    const geometryUrl = ASSEMBLER_SERVICE_URL;

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
        // Echoed verbatim in carbon/assembly-plan-done and GET /plan/{id}:
        // everything assembly-plan-finalize needs, so completion handling is
        // fully event-driven with no held run and no extra lookups.
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

    await step.run("start-plan", submitPlan);

    // Done: the run ends at submission. Completion is fully event-driven —
    // the service pushes `carbon/assembly-plan-done` (handled by
    // assembly-plan-finalize), and assembly-plan-reconcile sweeps up jobs
    // whose event was lost or whose service restarted. No held run, no
    // wait-loop steps.
    logger.info("plan submitted; completion is event-driven", {
      jobId: job.id
    });
    return { submitted: true, jobId: job.id };
  }
);
