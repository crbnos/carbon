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

type VendorErrorItem = { reason?: unknown; message?: unknown };

type VendorError = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  errors?: VendorErrorItem[];
  response?: {
    status?: unknown;
    data?: { error?: { message?: unknown; errors?: VendorErrorItem[] } };
  };
};

/** The HTTP statuses, `reason`s and messages googleapis may put on an error. */
function readVendorError(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const { status, code, message, errors, response } = error as VendorError;
  const items = [...(errors ?? []), ...(response?.data?.error?.errors ?? [])];
  const strings = (values: unknown[]) =>
    values.filter((v): v is string => typeof v === "string");
  return {
    statuses: [status, code, response?.status].map(String),
    reasons: strings(items.map((item) => item.reason)),
    messages: strings([
      message,
      response?.data?.error?.message,
      ...items.map((item) => item.message)
    ]).map((m) => m.toLowerCase())
  };
}

/**
 * Gmail refused the send because the account hit its sending limit: a 429
 * "User-rate limit exceeded (Mail sending)", or a 403 `dailyLimitExceeded`.
 * It lasts up to a day, so a retry within the job cannot help.
 */
export const isSendingLimitResponse = (error: unknown): boolean => {
  const parts = readVendorError(error);
  if (!parts) return false;
  if (parts.statuses.includes("403")) {
    return parts.reasons.includes("dailyLimitExceeded");
  }
  return (
    parts.statuses.includes("429") &&
    parts.messages.some((m) => m.includes("mail sending"))
  );
};

/**
 * A vendor API refused the request over a short-lived rate limit (Gmail
 * through googleapis), so nothing was sent and a replay cannot duplicate: an
 * HTTP 429, or a 403 whose reason is a rate limit. A sending-limit refusal is
 * not one: it lasts up to a day (`isSendingLimitResponse`).
 */
export const isRateLimitedResponse = (error: unknown): boolean => {
  const parts = readVendorError(error);
  if (!parts || isSendingLimitResponse(error)) return false;
  if (parts.statuses.includes("429")) return true;
  return (
    parts.statuses.includes("403") &&
    parts.reasons.some((reason) => RATE_LIMIT_REASONS.has(reason))
  );
};

/** The error to throw for a failed email send, classified. */
export const emailDeliveryFailure = (error: unknown): Error =>
  failure("Email", error, isRetryableEmailFailure(error));

/** The error to throw for a failed Slack post, classified. */
export const slackDeliveryFailure = (error: unknown): Error =>
  failure("Slack", error, isRetryableSlackFailure(error));
