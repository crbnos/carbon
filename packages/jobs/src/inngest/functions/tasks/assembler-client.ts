import type { Json } from "@carbon/database";
import { ASSEMBLER_SERVICE_API_KEY, ASSEMBLER_SERVICE_URL } from "@carbon/env";
import { NonRetriableError } from "inngest";

// Shared client for the assembler service's `/v1` action-RPC API. Every heavy
// action (convert / optimize / plan) creates an async job and the caller
// long-polls one uniform endpoint:
//   POST /v1/{action}   (Idempotency-Key: jobId)      -> 202 { ok, job }
//   GET  /v1/jobs/{id}?wait=N                          -> 200 { ok, job }
// Completion artifacts are late-mint uploaded to signed URLs handed over on each
// poll via the X-Carbon-Upload-Urls header. See
// .ai/specs/2026-07-04-animated-work-instructions-contracts.md.

// Submits are short; a tight per-request timeout catches an unreachable service.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// Bounded backoff when the service 429s (all slots busy), honoring Retry-After.
const BUSY_RETRIES = 4;
// GET /v1/jobs/{id}?wait=N holds the request open until the job finishes (or N
// elapses), so completion is near-immediate and a whole job costs a handful of
// checkpointed steps, not hundreds of short polls. Client timeout must exceed it.
export const LONG_POLL_WAIT_S = 25;
const LONG_POLL_TIMEOUT_MS = (LONG_POLL_WAIT_S + 10) * 1000;
// Floor between polls — negligible when the service holds ~25s, but stops a loop
// from hammering Inngest when a poll returns immediately (404, blip, no ?wait).
export const POLL_GAP = "3s";

export const assemblerAuthHeaders: Record<string, string> =
  ASSEMBLER_SERVICE_API_KEY
    ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
    : {};

export function assemblerBaseUrl(): string {
  if (!ASSEMBLER_SERVICE_URL) {
    throw new Error("ASSEMBLER_SERVICE_URL is not configured");
  }
  return ASSEMBLER_SERVICE_URL;
}

type ErrorBody = { message?: string } | string | null | undefined;

function errorMessage(error: ErrorBody, fallback: string): string {
  if (typeof error === "string") return error;
  return error?.message ?? fallback;
}

/**
 * POST /v1/{action} to create a job, idempotent on `jobId` (sent as
 * Idempotency-Key so a re-POST attaches to the running job). Bounded 429 backoff
 * honoring Retry-After; a genuine outage / permanent rejection fails fast.
 */
export async function submitAssemblerJob(opts: {
  action: "convert" | "optimize" | "plan";
  jobId: string;
  body: unknown;
  logger: { warn: (msg: string, meta?: unknown) => void };
}): Promise<void> {
  const { action, jobId, body, logger } = opts;
  const base = assemblerBaseUrl();
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${base}/v1/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": jobId,
          ...assemblerAuthHeaders
        },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (e) {
      const err = e as Error;
      // A timeout may be transient (briefly saturated) — let Inngest retry.
      // Genuine unreachability (down, DNS, TLS) is permanent — fail fast.
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        throw new Error(
          `Assembler service timed out after ${REQUEST_TIMEOUT_MS}ms`
        );
      }
      throw new NonRetriableError(
        `Assembler service unreachable: ${err.message}`
      );
    }

    if (response.status === 429 && attempt < BUSY_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after")) || 15;
      const waitMs = Math.min(retryAfter * 1000 * (attempt + 1), 120_000);
      logger.warn(`assembler /v1/${action} busy (429); backing off`, {
        jobId,
        attempt,
        waitMs
      });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: ErrorBody;
    } | null;
    if (!response.ok || !result?.ok) {
      // Non-429 errors are an outage (5xx) or permanent rejection (4xx):
      // retrying holds the job for nothing — fail fast.
      throw new NonRetriableError(
        errorMessage(
          result?.error,
          `Assembler service returned ${response.status}`
        )
      );
    }
    return;
  }
}

export type JobResult = { result: Json; stats: Json };

/**
 * One GET /v1/jobs/{id}?wait=N poll. Mints fresh signed upload URLs (late-mint)
 * for this poll via `mintUploadUrls` and sends them in X-Carbon-Upload-Urls, so
 * the service PUTs finished artifacts with seconds-old tokens. Transient
 * failures (dropped hold, 404 on a Redis-backed store, blip) read as "pending"
 * so the caller long-polls again rather than failing the run.
 */
export async function pollAssemblerJobOnce(opts: {
  jobId: string;
  mintUploadUrls: () => Promise<Record<string, string>>;
}): Promise<
  | { status: "pending" }
  | { status: "done"; result: Json; stats: Json }
  | { status: "error"; error: string }
> {
  const { jobId, mintUploadUrls } = opts;
  const base = assemblerBaseUrl();
  const uploadUrls = await mintUploadUrls();
  const headers: Record<string, string> = {
    ...assemblerAuthHeaders,
    ...(Object.keys(uploadUrls).length > 0
      ? { "X-Carbon-Upload-Urls": JSON.stringify(uploadUrls) }
      : {})
  };

  let response: Response;
  try {
    response = await fetch(
      `${base}/v1/jobs/${jobId}?wait=${LONG_POLL_WAIT_S}`,
      {
        headers,
        signal: AbortSignal.timeout(LONG_POLL_TIMEOUT_MS)
      }
    );
  } catch {
    return { status: "pending" };
  }
  if (response.status === 404) return { status: "pending" };

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    job?: {
      status?: string;
      result?: Json;
      stats?: Json;
      error?: { message?: string };
    };
  } | null;
  if (!response.ok || !body?.job) {
    throw new Error(`GET /v1/jobs returned ${response.status}`);
  }
  const job = body.job;
  if (job.status === "succeeded") {
    return {
      status: "done",
      result: job.result ?? null,
      stats: job.stats ?? null
    };
  }
  if (job.status === "failed") {
    return { status: "error", error: job.error?.message ?? "Job failed" };
  }
  return { status: "pending" };
}
