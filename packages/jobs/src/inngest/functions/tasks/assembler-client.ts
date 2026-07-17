import type { Json } from "@carbon/database";
import {
  ASSEMBLER_ECS_SERVICE_URL,
  ASSEMBLER_SERVICE_API_KEY,
  ASSEMBLER_SERVICE_URL,
  ASSEMBLER_SYNC_ENABLED,
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
// A `?sync` invoke runs the whole job inline in one request (the Lambda path).
// Must exceed the runtime's own cap (Lambda's 900s hard timeout) so the wall is
// the runtime's, not the client's — a client cut-off before then would drop a
// job the runtime is still finishing.
const SYNC_TIMEOUT_MS = (15 * 60 + 60) * 1000;
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

/** Whether the synchronous invoke path (Lambda) is enabled for the default base. */
export function assemblerSyncEnabled(): boolean {
  return ASSEMBLER_SYNC_ENABLED;
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
 * Outcome of a synchronous `?sync` invoke (the Lambda path). `done`/`error` are
 * terminal; `overflow` means the runtime could not finish here (its wall-clock
 * cut it off, or it signalled busy/unavailable) and the caller should re-dispatch
 * to the standing ECS service (no 15-min cap) or let Inngest retry.
 */
export type SyncJobOutcome =
  | { status: "done"; result: Json; stats: Json }
  | { status: "error"; error: string }
  | { status: "overflow"; reason: string };

/**
 * POST /v1/{action}?sync — run the job INLINE and return the terminal result in
 * one request (the Lambda path: Lambda freezes after the response, so a detached
 * 202 job would never finish). Upload URLs are minted ONCE up front (they must
 * outlast the whole inline run, unlike the async path's fresh-per-poll URLs) and
 * handed over in X-Carbon-Upload-Urls, so the service late-mint uploads within
 * the request. Idempotent on `jobId`. A runtime cut-off / busy / unavailable maps
 * to `overflow` for the router to fall back on; a genuine outage throws.
 */
export async function invokeAssemblerJobSync(opts: {
  action: "convert" | "optimize" | "plan" | "compact";
  jobId: string;
  body: unknown;
  uploadUrls: Record<string, string>;
  logger: { warn: (msg: string, meta?: unknown) => void };
  /** Override the target base. Default: `ASSEMBLER_SERVICE_URL` (the Lambda). */
  baseUrl?: string;
}): Promise<SyncJobOutcome> {
  const { action, jobId, body, uploadUrls } = opts;
  const base = opts.baseUrl ?? assemblerBaseUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": jobId,
    ...assemblerAuthHeaders,
    ...(Object.keys(uploadUrls).length > 0
      ? { "X-Carbon-Upload-Urls": JSON.stringify(uploadUrls) }
      : {})
  };

  let response: Response;
  try {
    response = await fetch(`${base}/v1/${action}?sync`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS)
    });
  } catch (e) {
    const err = e as Error;
    // The runtime's own timeout should fire first; a client-side cut-off means
    // the job outran even that window — overflow it rather than fail the run.
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return {
        status: "overflow",
        reason: `sync invoke exceeded ${SYNC_TIMEOUT_MS}ms`
      };
    }
    throw new NonRetriableError(
      `Assembler service unreachable: ${err.message}`
    );
  }

  // A gateway/runtime cut-off (502/504) or busy/unavailable (429/503) is not a
  // job failure — overflow to the uncapped ECS service (or Inngest retry).
  if ([429, 502, 503, 504].includes(response.status)) {
    return {
      status: "overflow",
      reason: `sync invoke returned ${response.status}`
    };
  }

  const parsed = (await response.json().catch(() => null)) as {
    ok?: boolean;
    job?: {
      status?: string;
      result?: Json;
      stats?: Json;
      error?: { message?: string };
    };
  } | null;
  if (!response.ok || !parsed?.job) {
    throw new NonRetriableError(
      `POST /v1/${action}?sync returned ${response.status}`
    );
  }
  const job = parsed.job;
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
  // A sync response is expected terminal; anything else means the runtime
  // returned before finishing — treat as overflow.
  return {
    status: "overflow",
    reason: `sync invoke returned non-terminal status '${job.status ?? "?"}'`
  };
}

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
 * Run an assembler action to completion the right way for the deployment:
 *
 *  - **sync** (Lambda) when `ASSEMBLER_SYNC_ENABLED` and the caller allows it —
 *    one inline `?sync` invoke (upload URLs minted once up front). On `overflow`
 *    (the runtime's wall-clock cut it off / it was busy) fall back to the async
 *    ECS path; with no ECS service configured, fail (Inngest `onFailure`
 *    degrades the model to its poster tier).
 *  - **async** (submit -> long-poll) otherwise — the standing service / dev
 *    container, unchanged. This is the default: with sync off, behavior is
 *    exactly today's.
 *
 * Returns the terminal `{ result, stats }`; throws on job error / timeout.
 */
export async function runAssemblerJob(
  step: StepTools,
  spec: AssemblerJobSpec & { preferSync?: boolean }
): Promise<{ result: Json; stats: Json }> {
  const { idPrefix, action, jobId, buildBody, mintUploadUrls, logger } = spec;
  const wantSync = (spec.preferSync ?? true) && assemblerSyncEnabled();

  if (wantSync) {
    const outcome: SyncJobOutcome = await step.run(
      `${idPrefix}-sync`,
      async () => {
        const [body, uploadUrls] = await Promise.all([
          buildBody(),
          mintUploadUrls()
        ]);
        return invokeAssemblerJobSync({
          action,
          jobId,
          body,
          uploadUrls,
          logger
        });
      }
    );
    if (outcome.status === "done") {
      return { result: outcome.result, stats: outcome.stats };
    }
    if (outcome.status === "error") {
      throw new Error(outcome.error);
    }
    // overflow — re-dispatch to the uncapped ECS service (async); if it isn't
    // deployed, nothing can run this job, so fail loud rather than hang.
    const ecs = assemblerEcsUrl();
    logger.warn(`assembler ${action} overflowed the sync runtime`, {
      jobId,
      reason: outcome.reason,
      overflowToEcs: Boolean(ecs)
    });
    if (!ecs) {
      throw new Error(
        `assembler ${action} exceeded the sync runtime and no ECS overflow service is configured: ${outcome.reason}`
      );
    }
    return runAssemblerJobAsync(step, spec, ecs);
  }

  return runAssemblerJobAsync(step, spec);
}

/** The async submit -> long-poll path, optionally pinned to an overflow base. */
async function runAssemblerJobAsync(
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
    const body = await buildBody();
    await submitAssemblerJob({ action, jobId, body, logger, baseUrl });
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
