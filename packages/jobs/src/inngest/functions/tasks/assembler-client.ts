// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assemblerCallbackToken } from "@carbon/api/internal-call";
import type { Database, Json } from "@carbon/database";
import { findStorageObjectBuckets } from "@carbon/database/storage-objects";
import {
  ASSEMBLER_JOB_CONCURRENCY,
  ASSEMBLER_SERVICE_API_KEY,
  ASSEMBLER_SERVICE_URL,
  ASSEMBLER_STORAGE_PUBLIC_URL,
  ERP_URL,
  PORT_API,
  SESSION_SECRET,
  SUPABASE_URL
} from "@carbon/env";
import {
  getCompanyPrivateBucket,
  isUnsafeStoragePath,
  TEMP_STAGING_BUCKET
} from "@carbon/files";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError, RetryAfterError } from "inngest";
import { getJobDatabaseClient } from "../../../db";

// Shared client for the assembler service's `/v1` action-RPC API. Submit
// creates a job (202) with upload URLs + a completion-callback URL in the
// request; the run then waits on the callback's event in slices, polling the
// job between slices. See .ai/specs/2026-07-15-assembler-deployment.md.

// Submits and polls are short; a tight per-request timeout catches an
// unreachable service. A poll may upload a parked output, which is why it is
// not shorter.
const REQUEST_TIMEOUT_MS = 60 * 1000;
// One wait for the completion callback. Between slices the run polls, which
// catches a callback that fired while no wait was registered.
const WAIT_SLICE_MS = 5 * 60 * 1000;
// How long a job may sit in the service's queue (waiting for memory) before
// the run gives up on it. Queue time does not count against the action's own
// budget, which starts when the service reports the job running.
const MAX_QUEUED_MS = 6 * 60 * 60 * 1000;
// Resubmits after a failure that is not reproducible (a crash, a lost record).
const MAX_RESUBMITS = 2;

export const assemblerAuthHeaders: Record<string, string> =
  ASSEMBLER_SERVICE_API_KEY
    ? { Authorization: `Bearer ${ASSEMBLER_SERVICE_API_KEY}` }
    : {};

// One shared concurrency key for every assembler-backed function. It bounds
// the steps that run at once (submits and polls, each a short request), so a
// burst of uploads cannot take the account's concurrency from
// the `event-queue` drainer. It does NOT bound the jobs in the service: a run
// waiting in `waitForEvent` holds no slot (Inngest counts executing steps
// only). The service bounds its own work by memory (`admission.rs`) and queues
// the rest. Default 5: a per-function limit above the Inngest plan's account
// concurrency fails app sync ("function has higher concurrency limits than
// your plan"), and 5 is the smallest plan cap in play. Override via
// ASSEMBLER_JOB_CONCURRENCY where the plan allows more.
export const ASSEMBLER_CONCURRENCY: [
  { scope: "env"; key: string; limit: number }
] = [
  {
    scope: "env",
    key: '"assembler"',
    limit: Number(ASSEMBLER_JOB_CONCURRENCY) || 5
  }
];

/**
 * The assembler feature flag IS the config: unset `ASSEMBLER_SERVICE_URL` means
 * the whole pipeline is off. Gate the Inngest functions on this so triggered
 * events skip cleanly (rows stay untouched, the viewer falls back to the raw
 * model tier) instead of failing runs and stamping rows `Failed`.
 */
export function assemblerEnabled(): boolean {
  return Boolean(ASSEMBLER_SERVICE_URL);
}

export function assemblerBaseUrl(): string {
  if (!ASSEMBLER_SERVICE_URL) {
    throw new Error("ASSEMBLER_SERVICE_URL is not configured");
  }
  return ASSEMBLER_SERVICE_URL;
}

/**
 * COPY a staged object into the durable bucket, same key, server-side (no
 * download — storage-js `copy` with `destinationBucket`). Deliberately not a
 * move: a move deletes the staging object instantly, and a concurrent
 * optimize/convert/plan that already resolved `temp-staging` as its source
 * bucket then signs a path that no longer exists ("Object not found") and
 * fails. The staged copy stays behind and the scheduled cleanup prunes it once
 * it's stale (see cleanup.ts `prune-staged-raw-models`). Idempotent: an
 * already-existing durable copy counts as success. Returns null on success,
 * else the storage error message.
 */
export async function copyRawToDurable(
  client: SupabaseClient<Database>,
  path: string
): Promise<string | null> {
  // The durable home is the company's own bucket; keys start with companyId.
  // A key with no companyId segment has no durable home — refuse rather than
  // resolve to a wrong bucket.
  const companySegment = path.split("/")[0] ?? "";
  if (!companySegment) return `path has no companyId prefix: ${path}`;
  const durableBucket = getCompanyPrivateBucket(companySegment);
  const { error } = await client.storage
    .from(TEMP_STAGING_BUCKET)
    .copy(path, path, { destinationBucket: durableBucket });
  if (!error) return null;
  return /already exists|duplicate/i.test(error.message) ? null : error.message;
}

/**
 * Sign a read URL for a job's source object. A missing object throws
 * `NonRetriableError` — the source is gone for good (deleted, staging cleared,
 * or the upload never completed), so retrying only delays the Failed stamp the
 * viewer needs before it can settle. Any other signing failure stays retriable.
 */
export async function signSourceUrl(
  client: SupabaseClient<Database>,
  bucket: string,
  path: string,
  expiresInSeconds: number
): Promise<string> {
  const source = await client.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (source.error) {
    if (/not.?found/i.test(source.error.message)) {
      throw new NonRetriableError(
        `Source file no longer exists in storage: ${bucket}/${path}`
      );
    }
    throw new Error(`Failed to sign source URL: ${source.error.message}`);
  }
  return source.data.signedUrl;
}

/**
 * Which bucket holds a model's raw source: the company's own bucket once it
 * is durable, else `temp-staging`. Null when it is in neither, so the caller
 * can fail the job for good instead of signing a path that does not exist.
 *
 * Null too for a path outside the row's company. Any insert path can name a
 * file (the forms insert under RLS, which does not check `modelPath`), and
 * these jobs read storage as the service role: `temp-staging` is shared, so
 * without this check one company could have another's upload processed into
 * its own bucket.
 */
export async function resolveModelSourceBucket(
  companyId: string,
  modelPath: string
): Promise<string | null> {
  if (
    !modelPath.startsWith(`${companyId}/`) ||
    isUnsafeStoragePath(modelPath)
  ) {
    return null;
  }
  const buckets = await findStorageObjectBuckets(getJobDatabaseClient(), {
    names: [modelPath],
    buckets: [getCompanyPrivateBucket(companyId), TEMP_STAGING_BUCKET]
  });
  return buckets.get(modelPath) ?? null;
}

/** The source bucket, or a non-retriable failure when the file is gone. */
export async function requireModelSourceBucket(
  companyId: string,
  modelPath: string
): Promise<string> {
  const bucket = await resolveModelSourceBucket(companyId, modelPath);
  if (!bucket) {
    throw new NonRetriableError(
      `Source file no longer exists in storage: ${modelPath}`
    );
  }
  return bucket;
}

/**
 * Dev-only URL surgery on assembler-bound signed storage URLs. The portless
 * `.dev` proxy exists only on this machine (/etc/hosts + local CA), so: a LOCAL
 * assembler gets a direct `localhost:<kong>` rewrite (the proxy also times out
 * on multi-GB transfers), and a REMOTE assembler (staging Lambda) gets the
 * public tunnel origin when one is configured. No-op in prod/preview.
 */
export function internalizeStorageUrl(url: string): string {
  if (!SUPABASE_URL) return url;
  let publicHost: string;
  try {
    publicHost = new URL(SUPABASE_URL).host;
  } catch {
    return url;
  }

  // Which host the assembler runs on decides the rewrite. Derived from
  // ASSEMBLER_SERVICE_URL rather than hand-editing the crbn-owned PORT_API out
  // of .env.local (which crbn up regenerates anyway).
  let assemblerIsLocal = true;
  try {
    const h = new URL(assemblerBaseUrl()).hostname;
    assemblerIsLocal = h === "localhost" || h === "127.0.0.1";
  } catch {
    return url; // no/invalid assembler URL -> nothing consumes the rewrite
  }

  if (!assemblerIsLocal) {
    if (!ASSEMBLER_STORAGE_PUBLIC_URL) return url;
    try {
      const parsed = new URL(url);
      if (parsed.host !== publicHost) return url;
      const pub = new URL(ASSEMBLER_STORAGE_PUBLIC_URL);
      parsed.protocol = pub.protocol;
      parsed.host = pub.host;
      return parsed.toString();
    } catch {
      return url;
    }
  }

  if (!PORT_API) return url;
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
  action: "convert" | "optimize" | "plan" | "compact" | "thumbnail";
  jobId: string;
  body: unknown;
  logger: { warn: (msg: string, meta?: unknown) => void };
  /** Override the target base (e.g. the ECS overflow service). Default: `ASSEMBLER_SERVICE_URL`. */
  baseUrl?: string;
  /** Signed upload URLs handed over AT SUBMIT, so the job can finalize the
   * moment compute ends — the Lambda worker has no instance left to poll. */
  uploadUrls?: Record<string, string>;
}): Promise<void> {
  const { action, jobId, body, logger } = opts;
  const base = opts.baseUrl ?? assemblerBaseUrl();
  const payload = JSON.stringify(body);

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

  // Busy: Inngest retries the step when the service says, without holding a
  // step (and its concurrency slot) asleep in the meantime.
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) || 15;
    logger.warn(`assembler /v1/${action} busy (429); retrying`, { jobId });
    throw new RetryAfterError(
      `Assembler service busy for ${action}`,
      `${retryAfter}s`
    );
  }

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: ErrorBody;
  } | null;
  if (!response.ok || !result?.ok) {
    const message = errorMessage(
      result?.error,
      `Assembler service returned ${response.status}`
    );
    // A 5xx is the service or its gateway (a cold Lambda, a restarting pod):
    // Inngest retries the step. A 4xx is a rejection a retry repeats.
    if (response.status >= 500) throw new Error(message);
    throw new NonRetriableError(message);
  }
}

export type JobResult = { result: Json; stats: Json };

/** What the service says about a job, as a run acts on it. */
export type JobOutcome =
  | { status: "done"; result: Json; stats: Json }
  | { status: "failed"; error: string; code?: string }
  | { status: "canceled" }
  /** Waiting for memory, or not started on the Lambda worker yet. */
  | { status: "queued" }
  | { status: "running" }
  /** The poll did not reach the service. */
  | { status: "unreachable" }
  /** The service has no record of the job. */
  | { status: "lost" };

/**
 * One GET /v1/jobs/{id} poll; it answers at once (the run waits between polls in
 * `waitForEvent`, which holds no concurrency slot). Mints fresh signed upload
 * URLs (late-mint) for this poll via `mintUploadUrls` and sends them in
 * X-Carbon-Upload-Urls, so the service PUTs a parked output with seconds-old
 * tokens.
 */
export async function pollAssemblerJobOnce(opts: {
  jobId: string;
  mintUploadUrls: () => Promise<Record<string, string>>;
  /** Override the target base (e.g. the ECS overflow service). Default: `ASSEMBLER_SERVICE_URL`. */
  baseUrl?: string;
}): Promise<JobOutcome> {
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
    response = await fetch(`${base}/v1/jobs/${jobId}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    return { status: "unreachable" };
  }
  if (response.status === 404) return { status: "lost" };
  // A 5xx is the service (or its load balancer) mid-deploy: wait it out
  // rather than fail a job that may still finish.
  if (response.status >= 500) return { status: "unreachable" };

  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    job?: {
      status?: string;
      result?: Json;
      stats?: Json;
      error?: { code?: string; message?: string };
    };
  } | null;
  if (!response.ok || !body?.job) {
    throw new Error(`GET /v1/jobs returned ${response.status}`);
  }
  return jobOutcome(body.job);
}

function jobOutcome(job: {
  status?: string;
  result?: Json;
  stats?: Json;
  error?: { code?: string; message?: string } | null;
}): JobOutcome {
  switch (job.status) {
    case "succeeded":
      return {
        status: "done",
        result: job.result ?? null,
        stats: job.stats ?? null
      };
    case "failed":
      return {
        status: "failed",
        error: job.error?.message ?? "Job failed",
        code: job.error?.code
      };
    case "canceled":
      return { status: "canceled" };
    case "queued":
      return { status: "queued" };
    default:
      return { status: "running" };
  }
}

/** Best-effort: a failed cancel only leaves the job to finish unread. */
async function cancelAssemblerJob(
  jobId: string,
  baseUrl: string | undefined,
  logger: AssemblerLogger
): Promise<void> {
  const base = baseUrl ?? assemblerBaseUrl();
  try {
    const response = await fetch(`${base}/v1/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: assemblerAuthHeaders,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      logger.warn("assembler job cancel refused", {
        jobId,
        status: response.status
      });
    }
  } catch (error) {
    logger.warn("assembler job cancel failed", { jobId, error });
  }
}

// The minimal Inngest step surface the router needs; keeps this module free of a
// version-pinned Inngest type import while staying structurally compatible with
// the real `step` tools. `run` returns `any` because Inngest wraps the result in
// `Jsonify<T>` (not a bare `T`) — call sites annotate the awaited value.
type StepTools = {
  run: (id: string, fn: () => unknown) => Promise<any>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string | number; if?: string }
  ) => Promise<any | null>;
};

/**
 * Failures a resubmit can fix: the source or an output could not travel, the
 * service could not start the job, or it gave no reason. Any other failure is
 * the input's, and a resubmit only repeats it.
 */
const TRANSIENT_FAILURES = new Set([
  "READ_FAILED",
  "UPLOAD_FAILED",
  "BUSY",
  "DISPATCH_FAILED"
]);

export type JobDecision =
  | { kind: "return"; result: Json; stats: Json }
  | { kind: "fail"; message: string }
  | { kind: "resubmit"; reason: string }
  | { kind: "wait"; runningSince: number | null };

/**
 * What a run does after the service's answer. Pure, so the budgets are
 * testable. `now`, `submittedAt` and `runningSince` are epoch ms read inside
 * steps, so a replay sees the same values.
 */
export function decideJobStep(
  outcome: JobOutcome,
  state: {
    action: string;
    now: number;
    submittedAt: number;
    runningSince: number | null;
    resubmits: number;
    maxWaitMs: number;
  }
): JobDecision {
  const { action, now, submittedAt, resubmits, maxWaitMs } = state;
  const canResubmit = resubmits < MAX_RESUBMITS;
  switch (outcome.status) {
    case "done":
      return { kind: "return", result: outcome.result, stats: outcome.stats };
    case "canceled":
      return { kind: "fail", message: `assembler ${action} canceled` };
    case "failed": {
      const transient =
        !outcome.code || TRANSIENT_FAILURES.has(outcome.code.toUpperCase());
      return transient && canResubmit
        ? { kind: "resubmit", reason: outcome.error }
        : { kind: "fail", message: outcome.error };
    }
    case "lost":
      return canResubmit
        ? { kind: "resubmit", reason: "the service has no record of the job" }
        : {
            kind: "fail",
            message: `assembler ${action} lost its job ${resubmits + 1} times`
          };
    default: {
      const runningSince =
        outcome.status === "running"
          ? (state.runningSince ?? now)
          : state.runningSince;
      if (runningSince !== null && now - runningSince > maxWaitMs) {
        return {
          kind: "fail",
          message: `assembler ${action} did not finish within ${maxWaitMs}ms of starting`
        };
      }
      if (now - submittedAt > MAX_QUEUED_MS + maxWaitMs) {
        return {
          kind: "fail",
          message: `assembler ${action} waited more than ${MAX_QUEUED_MS}ms for the service`
        };
      }
      return { kind: "wait", runningSince };
    }
  }
}

type AssemblerLogger = {
  warn: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
};

type AssemblerJobSpec = {
  /** Namespaces this job's Inngest step ids (a caller may run several). */
  idPrefix: string;
  action: "convert" | "optimize" | "plan" | "compact" | "thumbnail";
  jobId: string;
  /** Build the request body (signs a fresh source URL) — run inside a step. */
  buildBody: () => Promise<unknown>;
  /** Mint fresh signed upload URLs for the completion artifacts (late-mint). */
  mintUploadUrls: () => Promise<Record<string, string>>;
  /** How long the job may run once the service starts it. */
  maxWaitMs: number;
  logger: AssemblerLogger;
};

/** The completion-webhook URL minted into the job spec at submit. */
function callbackUrl(jobId: string): string {
  return `${ERP_URL}/api/assembler/callback?token=${assemblerCallbackToken(SESSION_SECRET ?? "", jobId)}`;
}

/**
 * Run an assembler action to completion: submit (with upload URLs and a
 * callback URL), then alternate a poll and a wait for the callback's event
 * until the job ends. The poll between waits catches a callback that fired
 * while no wait was registered. A transient failure or a lost job is
 * resubmitted under the same id; anything else throws `NonRetriableError`
 * (an Inngest retry would only replay the remembered steps).
 */
export async function runAssemblerJob(
  step: StepTools,
  spec: AssemblerJobSpec,
  baseUrl?: string
): Promise<JobResult> {
  const {
    idPrefix,
    action,
    jobId,
    buildBody,
    mintUploadUrls,
    maxWaitMs,
    logger
  } = spec;

  const submit = async () => {
    const [body, uploadUrls] = await Promise.all([
      buildBody(),
      mintUploadUrls()
    ]);
    await submitAssemblerJob({
      action,
      jobId,
      body: {
        ...(body as Record<string, unknown>),
        callback_url: callbackUrl(jobId)
      },
      logger,
      baseUrl,
      uploadUrls
    });
    return Date.now();
  };

  const submittedAt: number = await step.run(`${idPrefix}-submit`, submit);
  let runningSince: number | null = null;
  let resubmits = 0;

  for (let slice = 0; ; slice++) {
    const polled: { outcome: JobOutcome; now: number } = await step.run(
      `${idPrefix}-poll-${slice}`,
      async () => ({
        outcome: await pollAssemblerJobOnce({ jobId, mintUploadUrls, baseUrl }),
        now: Date.now()
      })
    );
    const state = {
      action,
      submittedAt,
      runningSince,
      resubmits,
      maxWaitMs,
      now: polled.now
    };
    let decision = decideJobStep(polled.outcome, state);

    if (decision.kind === "wait") {
      runningSince = decision.runningSince;
      const done = await step.waitForEvent(`${idPrefix}-wait-${slice}`, {
        event: "carbon/assembler-job-done",
        timeout: WAIT_SLICE_MS,
        if: `async.data.jobId == "${jobId}"`
      });
      if (!done) continue;
      decision = decideJobStep(jobOutcome(done.data ?? {}), {
        ...state,
        runningSince
      });
      if (decision.kind === "wait") continue;
    }

    if (decision.kind === "return") {
      return { result: decision.result, stats: decision.stats };
    }
    if (decision.kind === "fail") {
      // Given up on a job the service still holds (over budget, queued too
      // long): cancel it, so it stops taking memory nobody will read.
      if (["queued", "running"].includes(polled.outcome.status)) {
        await step.run(`${idPrefix}-cancel`, () =>
          cancelAssemblerJob(jobId, baseUrl, logger)
        );
      }
      throw new NonRetriableError(decision.message);
    }
    resubmits += 1;
    runningSince = null;
    logger.warn(`assembler ${action} resubmitted`, {
      jobId,
      reason: decision.reason,
      resubmits
    });
    await step.run(`${idPrefix}-resubmit-${resubmits}`, submit);
  }
}
