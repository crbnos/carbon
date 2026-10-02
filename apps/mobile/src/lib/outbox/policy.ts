// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HOUR_MS } from "@carbon/utils/date";
import { now, parseAbsolute } from "@internationalized/date";
import {
  type ApiClientError,
  isOperatorExpired,
  isRetrySameKey
} from "../api/errors";
import { laneOf, type OutboxPatch, type OutboxRow } from "./schema";

/**
 * Every decision the outbox makes, as pure functions over plain values.
 *
 * The queue in `queue.ts` does sqlite and HTTP and nothing else: it asks this
 * file what to do and then does it. That split is deliberate — the interesting
 * behaviour (what may be retried, in what order, what stops a lane) is testable
 * for real in `policy.test.ts` with no fake database and no fake API client.
 *
 * Time is always passed in as an ISO instant. `nowIso()` is the only reader of
 * the clock, and it goes through `@internationalized/date` rather than a JS
 * `Date` (project rule: no `Date` for parsing, formatting or arithmetic).
 */

/** First wait after a retry-safe failure. */
export const BACKOFF_BASE_MS = 2_000;
/** The wait never grows past this, so a long drop still recovers promptly. */
export const BACKOFF_MAX_MS = 60_000;
/**
 * One shift. A row older than this is never sent automatically — the operator
 * confirms or discards it, so a forgotten "start labor" cannot post hours
 * later against a job somebody else has since finished.
 */
export const STALE_AFTER_MS = 8 * HOUR_MS;

/** The code stored when the app itself refuses to send, having no operator. */
export const OPERATOR_REQUIRED_CODE = "operator_expired";

export function nowIso(): string {
  return now("UTC").toAbsoluteString();
}

/** `toIso − fromIso` in milliseconds. Positive when `toIso` is later. */
export function ageMs(fromIso: string, toIso: string): number {
  return parseAbsolute(toIso, "UTC").compare(parseAbsolute(fromIso, "UTC"));
}

/** `fromIso` advanced by `ms`, back as an ISO instant. */
export function plusMs(fromIso: string, ms: number): string {
  return parseAbsolute(fromIso, "UTC")
    .add({ milliseconds: ms })
    .toAbsoluteString();
}

/**
 * Strictly older than the hold, so exactly 8h is still sendable. A boundary
 * has to fall one way; falling towards "send it" keeps a row that was made
 * seconds before the cutoff from needing a tap for no reason.
 */
export function isStale(createdAtIso: string, nowIso: string): boolean {
  return ageMs(createdAtIso, nowIso) > STALE_AFTER_MS;
}

/** A backoff that has elapsed, or no backoff at all. */
export function isDue(nextAttemptAt: string | null, nowIso: string): boolean {
  if (!nextAttemptAt) return true;
  return ageMs(nextAttemptAt, nowIso) >= 0;
}

/**
 * `2s, 4s, 8s … 60s`, from the row's attempt count BEFORE this failure — so
 * `nextDelayMs(0)` is the first wait.
 */
export function nextDelayMs(attempts: number): number {
  const n = Math.max(0, attempts);
  return Math.min(BACKOFF_BASE_MS * 2 ** n, BACKOFF_MAX_MS);
}

export type OutboxFailureKind =
  | "retry_same_key"
  | "operator_expired"
  | "needs_attention";

/**
 * Which of the three things a failure is.
 *
 * `isRetrySameKey` (`~/lib/api/errors`) is the single definition of "the
 * command provably did not run, or the server de-duplicates it" and this
 * defers to it rather than restating the list. A second copy of that rule is
 * how a stored 5xx eventually gets retried by accident, and a stored 5xx
 * retried under its own key is a command applied twice (`.ai/lessons.md`:
 * "Retrying a 5xx from a non-idempotent Edge Function multiplies its side
 * effects").
 *
 * `operator_expired` is split out only so the UI can say "pin in again"
 * instead of showing a 401; it stops the lane exactly like any other refusal.
 */
export function classify(err: ApiClientError): OutboxFailureKind {
  if (isRetrySameKey(err)) return "retry_same_key";
  if (isOperatorExpired(err)) return "operator_expired";
  return "needs_attention";
}

/** What the queue should do with one row, right now. */
export type OutboxDisposition =
  /** Send it. */
  | "send"
  /** A send is in flight. */
  | "sending"
  /** Backing off; it will be due later with no operator involvement. */
  | "waiting"
  /** Failed in a way only the operator can resolve. Stops its lane. */
  | "needs_attention"
  /** Older than a shift and not yet okayed. Stops its lane. */
  | "needs_confirmation";

export function dispositionOf(
  row: Pick<OutboxRow, "state" | "nextAttemptAt" | "createdAt" | "confirmedAt">,
  nowIso: string
): OutboxDisposition {
  if (row.state === "sending") return "sending";
  if (row.state === "needs_attention") return "needs_attention";
  if (!row.confirmedAt && isStale(row.createdAt, nowIso)) {
    return "needs_confirmation";
  }
  return isDue(row.nextAttemptAt, nowIso) ? "send" : "waiting";
}

/**
 * The oldest unsent row of one lane.
 *
 * This is the whole ordering guarantee: the queue only ever looks at a lane's
 * head, so two commands on one operation can only apply in `seq` order, and a
 * head that cannot move stops its own lane and no other. One jammed operation
 * must not stop the floor.
 */
export function laneHead(rows: OutboxRow[], lane: string): OutboxRow | null {
  let head: OutboxRow | null = null;
  for (const row of rows) {
    if (laneOf(row) !== lane) continue;
    if (!head || row.seq < head.seq) head = row;
  }
  return head;
}

export type LaneHead = {
  lane: string;
  row: OutboxRow;
  disposition: OutboxDisposition;
};

/** Every lane with work, each with its head and what to do about it. */
export function selectLaneHeads(rows: OutboxRow[], nowIso: string): LaneHead[] {
  const lanes: string[] = [];
  for (const row of rows) {
    const lane = laneOf(row);
    if (!lanes.includes(lane)) lanes.push(lane);
  }
  const heads: LaneHead[] = [];
  for (const lane of lanes) {
    const row = laneHead(rows, lane);
    if (row) {
      heads.push({ lane, row, disposition: dispositionOf(row, nowIso) });
    }
  }
  return heads;
}

/**
 * The row's new state after a failed attempt.
 *
 * A retry-safe failure keeps the key and waits. Anything else — a 4xx, or a
 * 5xx the server has stored and will replay — becomes `needs_attention`, which
 * only the operator's Retry can leave, and that mints a new key.
 */
export function afterFailure(
  row: Pick<OutboxRow, "attempts">,
  err: ApiClientError,
  nowIso: string
): OutboxPatch {
  const kind = classify(err);
  const attempts = row.attempts + 1;
  if (kind === "retry_same_key") {
    return {
      state: "queued",
      attempts,
      nextAttemptAt: plusMs(nowIso, nextDelayMs(row.attempts)),
      lastError: err.message,
      lastErrorCode: err.code
    };
  }
  return {
    state: "needs_attention",
    attempts,
    nextAttemptAt: null,
    lastError: err.message,
    lastErrorCode: err.code
  };
}

/**
 * May this row go out right now, given who is pinned in?
 *
 * Only while the SAME operator who made it is still pinned in. "Somebody is
 * pinned in" is not enough: operator A reports five good, the Wi-Fi drops, A
 * pins out and B pins in — sending then credits B with A's work. The operator
 * token itself is never stored, so the row carries the id and the live token
 * comes from memory.
 */
export function canSendAsOperator(
  row: Pick<OutboxRow, "operatorUserId">,
  currentOperatorUserId: string | null
): boolean {
  if (!row.operatorUserId) return true;
  return row.operatorUserId === currentOperatorUserId;
}

/**
 * The row's new state when the operator who made it is not the one at the
 * tablet (or nobody is).
 *
 * Nothing was sent, so `attempts` does not move, and no message is stored:
 * `lastError` null with this code tells the UI to say "pin in again" in the
 * operator's own language rather than replay a sentence the app invented in
 * whatever language was active when the Wi-Fi dropped.
 */
export function operatorUnavailablePatch(): OutboxPatch {
  return {
    state: "needs_attention",
    nextAttemptAt: null,
    lastError: null,
    lastErrorCode: OPERATOR_REQUIRED_CODE
  };
}

/**
 * The operator pressed Retry.
 *
 * A NEW key, always — that is the only safe way out of `needs_attention`,
 * because the first attempt may have partly applied and the server would
 * otherwise replay its stored answer. The caller mints the key (so this stays
 * pure) and must not pass the row's own. Retrying also counts as okaying a
 * stale row: the operator just read what it was.
 */
export function afterOperatorRetry(
  newIdempotencyKey: string,
  nowIso: string
): OutboxPatch {
  return {
    state: "queued",
    attempts: 0,
    idempotencyKey: newIdempotencyKey,
    nextAttemptAt: null,
    lastError: null,
    lastErrorCode: null,
    confirmedAt: nowIso
  };
}

/** The operator okayed a stale row. It does not clear a failure. */
export function confirmPatch(nowIso: string): OutboxPatch {
  return { confirmedAt: nowIso };
}

/**
 * Recovery for a row the app was killed in the middle of sending.
 *
 * Back to `queued` with the SAME key — note the patch does not mention
 * `idempotencyKey` at all. The request may well have arrived, so the server
 * either answers `409 request_in_progress` (retry-safe) or replays what it
 * stored; both are correct, and both are only true while the key is unchanged.
 */
export function afterInterrupt(
  row: Pick<OutboxRow, "state">
): OutboxPatch | null {
  if (row.state !== "sending") return null;
  return { state: "queued", nextAttemptAt: null };
}

export type OutboxSummary = {
  /** Every row that has not been sent. Zero means no banner. */
  total: number;
  /**
   * Queued rows, whether due now or backing off — and including a row sitting
   * behind a stopped head, which is genuinely waiting: it moves as soon as the
   * operator resolves the row in front of it.
   */
  waiting: number;
  sending: number;
  needsAttention: number;
  needsConfirmation: number;
  /** How many operations have work queued, the "for what" behind the count. */
  lanes: number;
  /** The oldest unsent row, for a banner that wants to name one thing. */
  oldestLabel: string | null;
  oldestCreatedAt: string | null;
};

export const EMPTY_SUMMARY: OutboxSummary = {
  total: 0,
  waiting: 0,
  sending: 0,
  needsAttention: 0,
  needsConfirmation: 0,
  lanes: 0,
  oldestLabel: null,
  oldestCreatedAt: null
};

/** Everything the banner needs, counted once. */
export function summarize(rows: OutboxRow[], nowIso: string): OutboxSummary {
  const summary: OutboxSummary = { ...EMPTY_SUMMARY, total: rows.length };
  const lanes: string[] = [];
  let oldest: OutboxRow | null = null;

  for (const row of rows) {
    const lane = laneOf(row);
    if (!lanes.includes(lane)) lanes.push(lane);
    if (!oldest || row.seq < oldest.seq) oldest = row;

    switch (dispositionOf(row, nowIso)) {
      case "sending":
        summary.sending += 1;
        break;
      case "needs_attention":
        summary.needsAttention += 1;
        break;
      case "needs_confirmation":
        summary.needsConfirmation += 1;
        break;
      default:
        summary.waiting += 1;
    }
  }

  summary.lanes = lanes.length;
  summary.oldestLabel = oldest?.label ?? null;
  summary.oldestCreatedAt = oldest?.createdAt ?? null;
  return summary;
}
