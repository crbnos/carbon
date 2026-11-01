// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { NonRetriableError } from "inngest";

/**
 * Deciding whether a failed message delivery may be replayed.
 *
 * Neither SMTP nor `chat.postMessage` carries an idempotency key, so "did that
 * one land?" is not a question we can ask after the fact. The rule is therefore
 * asymmetric on purpose: replay only failures that PROVABLY delivered nothing,
 * and treat every other failure as terminal. A missed message is recoverable by
 * re-sending; a duplicated one is a customer receiving the same quote three
 * times, which is not.
 *
 * Pure so the decision can be pinned by tests — the callers own the I/O.
 */

/**
 * Ours, not nodemailer's: the company sender stopped before any vendor call
 * (a Gmail token refresh another caller holds).
 */
export const NOT_SENT = "ENOTSENT";

/**
 * Nodemailer codes raised while connecting, greeting or authenticating, i.e.
 * before a single recipient or byte of DATA reaches the relay.
 *
 * `ETIMEDOUT` and `ESOCKET` are deliberately absent: nodemailer raises those at
 * ANY phase, so either can mean the relay accepted the message and then dropped
 * the connection before the final ack.
 */
const RETRYABLE_SMTP_CODES = new Set([
  "ECONNECTION",
  "EDNS",
  "EAUTH",
  "ETLS",
  // An attachment URL that failed to download: the message never finished, and
  // a relay accepts nothing until it does.
  "EFETCH",
  NOT_SENT
]);

/**
 * The only Slack failure that provably posted nothing. A platform error is
 * deterministic (`channel_not_found` will not fix itself) and a request or HTTP
 * error is ambiguous — Slack may have accepted the message before the response
 * was lost.
 *
 * Reaching this requires `rejectRateLimitedCalls: true` on the client: at the
 * SDK default a 429 sleeps the whole Retry-After and then throws a bare Error
 * with no `code`, which lands in the ambiguous branch below.
 */
const RETRYABLE_SLACK_CODES = new Set(["slack_webapi_rate_limited_error"]);

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code === undefined
      ? undefined
      : String((error as { code?: unknown }).code)
    : undefined;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Throwing this lets Inngest retry; a `NonRetriableError` ends the run. */
const failure = (label: string, error: unknown, retryable: boolean): Error => {
  const code = codeOf(error);
  const message = `${label} error${code ? ` (${code})` : ""}: ${messageOf(error)}`;
  return retryable ? new Error(message) : new NonRetriableError(message);
};

/** True only when the send provably never reached the relay. */
export const isRetryableEmailFailure = (error: unknown): boolean => {
  const code = codeOf(error);
  return code !== undefined && RETRYABLE_SMTP_CODES.has(code);
};

/** True only when Slack provably did not post the message. */
export const isRetryableSlackFailure = (error: unknown): boolean => {
  const code = codeOf(error);
  return code !== undefined && RETRYABLE_SLACK_CODES.has(code);
};

/** Gmail's 403 reasons for a request it refused over a rate limit; it asks to retry them. */
const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded"
]);

type VendorError = {
  status?: unknown;
  code?: unknown;
  errors?: Array<{ reason?: unknown }>;
  response?: {
    status?: unknown;
    data?: { error?: { errors?: Array<{ reason?: unknown }> } };
  };
};

/**
 * A vendor API refused the request over a rate limit (Gmail through
 * googleapis), so nothing was sent and a replay cannot duplicate: an HTTP 429,
 * or a 403 whose reason is a rate limit. A 403 `dailyLimitExceeded` stays
 * terminal: Google says not to retry it.
 */
export const isRateLimitedResponse = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { status, code, errors, response } = error as VendorError;
  const statuses = [status, code, response?.status].map(String);
  if (statuses.includes("429")) return true;
  if (!statuses.includes("403")) return false;
  return [...(errors ?? []), ...(response?.data?.error?.errors ?? [])].some(
    (e) => typeof e?.reason === "string" && RATE_LIMIT_REASONS.has(e.reason)
  );
};

/** The error to throw for a failed email send, classified. */
export const emailDeliveryFailure = (error: unknown): Error =>
  failure("Email", error, isRetryableEmailFailure(error));

/** The error to throw for a failed Slack post, classified. */
export const slackDeliveryFailure = (error: unknown): Error =>
  failure("Slack", error, isRetryableSlackFailure(error));
