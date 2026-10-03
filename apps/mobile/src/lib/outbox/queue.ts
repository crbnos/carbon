// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import NetInfo from "@react-native-community/netinfo";
import { newIdempotencyKey } from "../api/client";
import { ApiClientError } from "../api/errors";
import {
  afterFailure,
  afterInterrupt,
  afterOperatorRetry,
  canSendAsOperator,
  confirmPatch,
  dispositionOf,
  EMPTY_SUMMARY,
  laneHead,
  nowIso,
  type OutboxSummary,
  operatorUnavailablePatch,
  summarize
} from "./policy";
import { laneOf, type OutboxCommand, type OutboxRow } from "./schema";
import type { OutboxStore } from "./store";

/**
 * The sender: the only part of the outbox with moving parts.
 *
 * It owns no rules. Every decision it makes comes from `policy.ts` and every
 * row it touches comes from `store.ts`, which is what keeps the interesting
 * behaviour testable without faking either one.
 *
 * Three properties it is built to hold:
 *
 *  - **One row at a time per lane, oldest first.** A lane is one operation
 *    (`operationId`), or the shared `general` lane for commands with no
 *    operation. The sender only ever looks at a lane's HEAD, so two reports on
 *    one operation cannot overtake each other.
 *  - **Lanes run in parallel.** A jammed operation stops its own lane and
 *    nothing else; the rest of the floor keeps sending.
 *  - **One key per row, minted once.** An automatic retry reuses it, so the
 *    server replays its stored answer instead of running the command again.
 *    Only `retry()` — the operator's own decision — mints a new one.
 */

export type OutboxQueueDeps = {
  store: OutboxStore;
  /** The signed-in user. Half of the server's idempotency key. */
  sessionUserId: () => string;
  /**
   * Performs one queued command. Build it from the API client and pass the
   * row's `idempotencyKey` through VERBATIM:
   *
   * ```ts
   * send: (row) =>
   *   api.request(row.path, {
   *     method: "POST",
   *     body: parseOutboxBody(row),
   *     idempotencyKey: row.idempotencyKey
   *   })
   * ```
   */
  send: (row: OutboxRow) => Promise<unknown>;
  /**
   * WHO is pinned in at the tablet right now, from the in-memory terminal
   * state (`useTerminal`). Omit it on a single-user device.
   *
   * It is an id and not a "someone is pinned in" boolean because a row only
   * goes out while the operator who MADE it is still at the tablet — otherwise
   * a queued report sent after a PIN switch credits the wrong person. The
   * operator's token stays in memory and is never persisted; `send` reads it
   * from the API scope at the moment it sends.
   */
  operatorUserId?: () => string | null;
  /** Overridable for a dev build; defaults to `expo-crypto`'s randomUUID. */
  newKey?: () => string;
  /** Overridable for a dev build that wants to move the clock. */
  now?: () => string;
  /** Replaces the NetInfo subscription (a dev toggle, or a test harness). */
  watchNetwork?: (onChange: (online: boolean) => void) => () => void;
  /**
   * How often `start()` re-checks for a row whose backoff has expired. A
   * backoff ends with no event to hang a listener on, so something has to tick.
   */
  tickMs?: number;
};

export type OutboxQueue = {
  /** Writes the command down and tries to send it at once. */
  enqueue(command: OutboxCommand): Promise<OutboxRow>;
  /** One pass over every lane. Safe to call at any time; overlaps coalesce. */
  flush(): Promise<void>;
  /**
   * The operator's Retry: a NEW key, then straight back into the lane. Call it
   * only from a screen that has just refetched — the first attempt may have
   * applied, and a new key means the server will run the command again.
   */
  retry(id: string): Promise<void>;
  /** The operator okayed a row left over from an earlier shift. */
  confirm(id: string): Promise<void>;
  /**
   * Deletes the row. A row already in flight is not cancelled — the request is
   * away and the server will do whatever it does; only the queue forgets it.
   */
  discard(id: string): Promise<void>;
  rows(): Promise<OutboxRow[]>;
  summary(): Promise<OutboxSummary>;
  /** The last summary computed, for a first render with no await. */
  lastSummary(): OutboxSummary;
  isOnline(): boolean;
  /** Fires after every change, and whenever the summary moves on a tick. */
  subscribe(listener: (summary: OutboxSummary) => void): () => void;
  /** Recovers interrupted rows, flushes, and watches the network. */
  start(): () => void;
};

const DEFAULT_TICK_MS = 5_000;

function watchWithNetInfo(onChange: (online: boolean) => void) {
  return NetInfo.addEventListener((state) => {
    // `isInternetReachable` is null while it is still being determined, and a
    // shop-floor AP often answers before the reachability probe does. Treating
    // null as online is the right bet: an attempt that fails is retry-safe.
    onChange(state.isConnected === true && state.isInternetReachable !== false);
  });
}

export function createOutboxQueue(deps: OutboxQueueDeps): OutboxQueue {
  const {
    store,
    send,
    sessionUserId,
    operatorUserId,
    newKey = newIdempotencyKey,
    now = nowIso,
    watchNetwork = watchWithNetInfo,
    tickMs = DEFAULT_TICK_MS
  } = deps;

  const listeners = new Set<(summary: OutboxSummary) => void>();
  let summaryCache: OutboxSummary = EMPTY_SUMMARY;
  let signature = "";
  // Optimistic until NetInfo says otherwise: a send that fails offline is
  // retry-safe, and refusing to try before the first event would stall the
  // very first command on a cold start.
  let online = true;
  let flushing = false;
  let flushAgain = false;

  async function notify() {
    const summary = summarize(await store.list(), now());
    const next = [
      summary.total,
      summary.waiting,
      summary.sending,
      summary.needsAttention,
      summary.needsConfirmation,
      summary.oldestLabel ?? ""
    ].join("|");
    summaryCache = summary;
    // Only on a real change: the tick runs every few seconds and a banner that
    // re-renders on every one of them for an identical count is just churn.
    if (next === signature) return;
    signature = next;
    for (const listener of listeners) listener(summary);
  }

  /** Anything we did not recognise is NOT safe to retry under the same key. */
  function asApiError(err: unknown): ApiClientError {
    if (err instanceof ApiClientError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new ApiClientError(0, "internal", message);
  }

  /** Returns true when the row went, so its lane may continue. */
  async function attempt(row: OutboxRow): Promise<boolean> {
    if (!canSendAsOperator(row, operatorUserId?.() ?? null)) {
      await store.patch(row.id, operatorUnavailablePatch());
      return false;
    }
    // The claim is the database's own conditional UPDATE, so two overlapping
    // passes cannot both send this row.
    if (!(await store.claim(row.id))) return false;
    try {
      await send({ ...row, state: "sending" });
      await store.remove(row.id);
      return true;
    } catch (err) {
      await store.patch(row.id, afterFailure(row, asApiError(err), now()));
      return false;
    }
  }

  async function runLane(lane: string): Promise<void> {
    let previous: string | null = null;
    for (;;) {
      const head = laneHead(await store.list(), lane);
      if (!head) return;
      // A sent row is deleted, so the head always moves on. If it somehow
      // does not, stop: a tight loop re-POSTing one row on a tablet is far
      // worse than a lane that waits for the next tick.
      if (head.id === previous) return;
      previous = head.id;
      if (dispositionOf(head, now()) !== "send") return;
      if (!(await attempt(head))) return;
    }
  }

  async function recover(): Promise<void> {
    for (const row of await store.list()) {
      const patch = afterInterrupt(row);
      if (patch) await store.patch(row.id, patch);
    }
  }

  async function flush(): Promise<void> {
    if (flushing) {
      // Coalesce rather than queue: a second pass started now would read the
      // same rows and lose every claim race anyway.
      flushAgain = true;
      return;
    }
    flushing = true;
    try {
      if (!online) return;
      await recover();
      const lanes = new Set((await store.list()).map(laneOf));
      await Promise.all([...lanes].map(runLane));
    } finally {
      flushing = false;
      await notify();
    }
    if (flushAgain) {
      flushAgain = false;
      await flush();
    }
  }

  return {
    async enqueue(command) {
      const row = await store.insert({
        ...command,
        sessionUserId: sessionUserId(),
        // Stamped from the live terminal state unless the caller named an
        // operator, so a mutation cannot forget to attribute itself — and the
        // row then refuses to go out under anybody else's PIN session.
        operatorUserId: command.operatorUserId ?? operatorUserId?.() ?? null,
        // Minted HERE, once per row, and reused by every automatic retry.
        idempotencyKey: newKey(),
        createdAt: now()
      });
      await notify();
      void flush();
      return row;
    },

    flush,

    async retry(id) {
      const row = await store.get(id);
      if (!row) return;
      await store.patch(id, afterOperatorRetry(newKey(), now()));
      await notify();
      void flush();
    },

    async confirm(id) {
      await store.patch(id, confirmPatch(now()));
      await notify();
      void flush();
    },

    async discard(id) {
      await store.remove(id);
      await notify();
    },

    rows: () => store.list(),

    async summary() {
      await notify();
      return summaryCache;
    },

    lastSummary: () => summaryCache,

    isOnline: () => online,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      const unwatch = watchNetwork((next) => {
        const reconnected = next && !online;
        online = next;
        if (reconnected) void flush();
        else void notify();
      });
      const timer = setInterval(() => void flush(), tickMs);
      void flush();
      return () => {
        unwatch();
        clearInterval(timer);
      };
    }
  };
}
