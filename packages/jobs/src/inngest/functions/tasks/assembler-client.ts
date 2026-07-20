import type { Json } from "@carbon/database";
import {
  ASSEMBLER_ECS_SERVICE_URL,
  ASSEMBLER_SERVICE_API_KEY,
  ASSEMBLER_SERVICE_URL,
  PORT_API,
  SUPABASE_URL
} from "@carbon/env";
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

/** The uncapped ECS overflow service URL, or `undefined` when not deployed. */
export function assemblerEcsUrl(): string | undefined {
  return ASSEMBLER_ECS_SERVICE_URL || undefined;
}

/**
 * The assembler runs on the host and pulls (and pushes) storage objects over
 * HTTP. In dev `SUPABASE_URL` is the public `portless` `.dev` proxy, which times
 * out on large (multi-GB) transfers and uses a self-signed TLS cert the Rust
 * client rejects. When the local kong port is known (`PORT_API`, dev only),
 * rewrite a storage signed URL to hit kong directly. No-op in prod (no
 * `PORT_API`, and prod's proxy handles large transfers) or on a non-`.dev` host.
 */
export function internalizeStorageUrl(url: string): string {
  if (!PORT_API || !SUPABASE_URL) return url;
  let publicHost: string;
  try {
    publicHost = new URL(SUPABASE_URL).host;
  } catch {
    return url;
  }
  if (!/\.dev(?::\d+)?$/.test(publicHost)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.host !== publicHost) return url;
    parsed.protocol = "http:";
    parsed.host = `localhost:${PORT_API}`;
    return parsed.toString();
  } catch {
    return url;
  }
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
  action: "convert" | "optimize" | "plan" | "compact";
  jobId: string;
  body: unknown;
  logger: { warn: (msg: string, meta?: unknown) => void };
  /** Override the target base (e.g. the ECS overflow service). Default: `ASSEMBLER_SERVICE_URL`. */
  baseUrl?: string;
  /**
   * Signed upload URLs handed over AT SUBMIT (long-expiry). On the Lambda
   * deployment the detached worker invocation uploads artifacts directly with
   * these — no serving instance survives to answer a late-mint poll with bytes.
   * The per-poll late-mint stays as the fallback (ECS/dev), so pass both.
   */
  uploadUrls?: Record<string, string>;
}): Promise<void> {
  const { action, jobId, body, logger } = opts;
  const base = opts.baseUrl ?? assemblerBaseUrl();
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${base}/v1/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": jobId,
          ...assemblerAuthHeaders,
          ...(opts.uploadUrls && Object.keys(opts.uploadUrls).length > 0
            ? { "X-Carbon-Upload-Urls": JSON.stringify(opts.uploadUrls) }
            : {})
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
  /** Override the target base (e.g. the ECS overflow service). Default: `ASSEMBLER_SERVICE_URL`. */
  baseUrl?: string;
}): Promise<
  | { status: "pending" }
  | { status: "done"; result: Json; stats: Json }
  | { status: "error"; error: string }
> {
  const { jobId, mintUploadUrls } = opts;
  const base = opts.baseUrl ?? assemblerBaseUrl();
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

// The minimal Inngest step surface the router needs; keeps this module free of a
// version-pinned Inngest type import while staying structurally compatible with
// the real `step` tools. `run` returns `any` because Inngest wraps the result in
// `Jsonify<T>` (not a bare `T`) — call sites annotate the awaited value.
type StepTools = {
  run: (id: string, fn: () => unknown) => Promise<any>;
  sleep: (id: string, duration: string | number) => Promise<unknown>;
};

type PollOutcome = Awaited<ReturnType<typeof pollAssemblerJobOnce>>;

type AssemblerLogger = {
  warn: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
};

type AssemblerJobSpec = {
  /** Namespaces this job's Inngest step ids (a caller may run several). */
  idPrefix: string;
  action: "convert" | "optimize" | "plan" | "compact";
  jobId: string;
  /** Build the request body (signs a fresh source URL) — run inside a step. */
  buildBody: () => Promise<unknown>;
  /** Mint fresh signed upload URLs for the completion artifacts (late-mint). */
  mintUploadUrls: () => Promise<Record<string, string>>;
  maxWaitMs: number;
  logger: AssemblerLogger;
};

/**
 * Run an assembler action to completion: submit -> long-poll, the one contract
 * every deployment speaks (Lambda self-invoke worker, the ECS service, the dev
 * container). Upload URLs are handed over twice, covering both runtimes:
 *
 *  - **at submit** — on Lambda the detached worker invocation uploads artifacts
 *    directly with these (no serving instance survives to answer a late-mint
 *    poll with the bytes in hand);
 *  - **per poll** (late-mint) — the ECS/dev path PUTs with seconds-old tokens,
 *    and it's the retry path if the worker's submit-time URLs expired.
 *
 * Returns the terminal `{ result, stats }`; throws on job error / timeout.
 */
export async function runAssemblerJob(
  step: StepTools,
  spec: AssemblerJobSpec,
  baseUrl?: string
): Promise<{ result: Json; stats: Json }> {
  const {
    idPrefix,
    action,
    jobId,
    buildBody,
    mintUploadUrls,
    maxWaitMs,
    logger
  } = spec;

  await step.run(`${idPrefix}-submit`, async () => {
    const [body, uploadUrls] = await Promise.all([
      buildBody(),
      mintUploadUrls()
    ]);
    await submitAssemblerJob({
      action,
      jobId,
      body,
      logger,
      baseUrl,
      uploadUrls
    });
  });

  const startedAt: number = await step.run(`${idPrefix}-poll-start`, () =>
    Date.now()
  );
  let i = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    const poll: PollOutcome = await step.run(`${idPrefix}-poll-${i}`, () =>
      pollAssemblerJobOnce({ jobId, mintUploadUrls, baseUrl })
    );
    if (poll.status === "done") {
      return { result: poll.result, stats: poll.stats };
    }
    if (poll.status === "error") {
      throw new Error(poll.error);
    }
    await step.sleep(`${idPrefix}-gap-${i}`, POLL_GAP);
    i++;
  }
  throw new Error(`assembler ${action} did not finish within ${maxWaitMs}ms`);
}
