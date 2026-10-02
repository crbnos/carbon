// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The one table the offline queue keeps, and the plain shapes every other file
 * in this folder talks in.
 *
 * Nothing here touches sqlite or the network — `policy.ts` decides over these
 * values, `store.ts` reads and writes them, `queue.ts` drives both. Keeping the
 * shapes in their own file is what lets the decisions be pure and really tested
 * (`policy.test.ts`) instead of tested through a hand-rolled fake database.
 */

/**
 * `queued → sending → (gone)`.
 *
 * A row that SENT is deleted rather than kept as `done`: nothing in the app
 * reads a sent command, and a table that only grows needs a purge pass that
 * would be the one piece of this feature no screen ever shows. The spec's
 * `done` state is therefore the row's absence.
 *
 * `needs_attention` is the terminal failure. It is a state and not a flag
 * because it is also the brake: the queue never looks past the first row of a
 * lane, so a `needs_attention` head stops its own lane and nothing else.
 */
export type OutboxState = "queued" | "sending" | "needs_attention";

/** One queued command, exactly as the table stores it. */
export type OutboxRow = {
  /**
   * Monotonic, assigned by sqlite (`INTEGER PRIMARY KEY AUTOINCREMENT`), and
   * the ONLY ordering key. `createdAt` cannot be it: two reports a second
   * apart are ordered by it, two reports in the same millisecond are not, and
   * "two reports on one operation apply in the order the operator made them"
   * is the guarantee this column exists for.
   */
  seq: number;
  id: string;
  /**
   * `(instanceId, companyId)` scopes every read and every write. A company id
   * is NOT unique across instances — a staging Carbon restored from a
   * production backup has the same ids — so the instance has to be in the key
   * or one tablet's two linked Carbons would share a queue.
   */
  instanceId: string;
  companyId: string;
  /** The signed-in user, which is half of the server's idempotency key. */
  sessionUserId: string;
  /**
   * On a shared tablet, WHICH operator made this command. Null on a
   * single-user device, and null for anything not attributed to an operator.
   *
   * The operator TOKEN is never persisted — AGENTS.md: memory only, never
   * sqlite, never the query cache — so this id is all the row carries, and it
   * is an id rather than a flag for a reason. Operator A reports five good,
   * the Wi-Fi drops, A pins out and B pins in: a row that only said "needs an
   * operator" would then go out under B's token and credit B with A's work.
   * The row sends only while this exact operator is still pinned in, and
   * otherwise waits in needs-attention.
   */
  operatorUserId: string | null;
  /** The lane this row belongs to. `null` means the shared "general" lane. */
  operationId: string | null;
  /** Stored rather than derived from `operationId` so the index can serve it. */
  lane: string;
  /** Only POSTs are queued — a GET is a read and the query cache owns it. */
  method: "POST";
  /** Path under `/api/v1`, exactly as `ApiClient.request` takes it. */
  path: string;
  /** The request body as JSON text. `parseOutboxBody` reads it back. */
  body: string;
  /**
   * A stable machine key for the command ("report-good", "clock-out"). Never
   * displayed: it is for grouping and for a caller that would rather translate
   * the row itself than trust `label`.
   */
  kind: string;
  /**
   * Operator words for one row, translated by the caller AT ENQUEUE TIME
   * ("Report 5 good"). It is stored already-translated, so it keeps the
   * language it was made in if the operator later switches the app's language.
   * That is the trade for not teaching this module every command there is —
   * a caller that minds translates from `kind` instead.
   */
  label: string;
  /**
   * Minted ONCE, when the row is enqueued, and reused verbatim on every
   * automatic retry. That reuse is the whole safety property: the server
   * replays its stored answer instead of running the command twice. Only the
   * operator's own Retry replaces it (`policy.afterOperatorRetry`).
   */
  idempotencyKey: string;
  /** ISO 8601 absolute instant. Age drives the 8-hour stale hold. */
  createdAt: string;
  attempts: number;
  state: OutboxState;
  /** The server's own message, shown to the operator as it came. */
  lastError: string | null;
  /**
   * The server's error code, or `operator_expired` when the app itself refused
   * to send. The UI translates from this when `lastError` is null — a message
   * the app invents must not be stored in one language.
   */
  lastErrorCode: string | null;
  /** ISO instant before which the row must not be retried (backoff). */
  nextAttemptAt: string | null;
  /**
   * Set when the operator okayed a row that had gone stale (older than one
   * shift). Until then such a row is never sent automatically, so a forgotten
   * "start labor" cannot post hours of time after the fact.
   */
  confirmedAt: string | null;
};

/** The columns a decision may change. Everything else is written once. */
export type OutboxPatch = Partial<
  Pick<
    OutboxRow,
    | "state"
    | "attempts"
    | "idempotencyKey"
    | "lastError"
    | "lastErrorCode"
    | "nextAttemptAt"
    | "confirmedAt"
  >
>;

/** What a caller hands `queue.enqueue`. */
export type OutboxCommand = {
  kind: string;
  label: string;
  /** Path under `/api/v1`, e.g. `/operations/op1/quantities`. */
  path: string;
  body: unknown;
  /** The operation this command belongs to, or `null` for the shared lane. */
  operationId?: string | null;
  /**
   * The pinned-in operator this command must be attributed to, read from the
   * in-memory terminal state. Omit it on a single-user device.
   */
  operatorUserId?: string | null;
};

/** `operationId ?? "general"` — clock-in and the like share one lane. */
export const GENERAL_LANE = "general";

export function laneOf(row: Pick<OutboxRow, "operationId">): string {
  return row.operationId ?? GENERAL_LANE;
}

/** The body as the API client wants it. Invalid JSON reads as `null`. */
export function parseOutboxBody(row: Pick<OutboxRow, "body">): unknown {
  try {
    return JSON.parse(row.body);
  } catch {
    return null;
  }
}

export const OUTBOX_TABLE = "outbox";

/**
 * Idempotent, so it runs on every open. There is no second version of this
 * table yet; when there is, add statements here rather than branching on
 * `PRAGMA user_version` — sqlite applies `IF NOT EXISTS` for free.
 */
export const OUTBOX_MIGRATION = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  instanceId TEXT NOT NULL,
  companyId TEXT NOT NULL,
  sessionUserId TEXT NOT NULL,
  operatorUserId TEXT,
  operationId TEXT,
  lane TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'queued',
  lastError TEXT,
  lastErrorCode TEXT,
  nextAttemptAt TEXT,
  confirmedAt TEXT
);
CREATE INDEX IF NOT EXISTS outbox_scope_lane_idx
  ON ${OUTBOX_TABLE} (instanceId, companyId, lane, seq);
`;
