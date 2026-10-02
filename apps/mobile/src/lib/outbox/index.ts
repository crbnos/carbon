// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The offline outbox: an ordered, per-operation queue of commands that have
 * not reached the server yet.
 *
 * Wiring it up is three calls:
 *
 * ```ts
 * const db = await openOutboxDatabase();
 * const store = createOutboxStore(db, { instanceId, companyId });
 * const queue = createOutboxQueue({
 *   store,
 *   sessionUserId: () => session.userId,
 *   operatorUserId: () => terminal.operator?.id ?? null,
 *   send: (row) =>
 *     api.request(row.path, {
 *       method: "POST",
 *       body: parseOutboxBody(row),
 *       idempotencyKey: row.idempotencyKey
 *     })
 * });
 * const stop = queue.start();
 * ```
 *
 * A mutation then calls `queue.enqueue({ kind, label, path, body,
 * operationId })` instead of posting directly, and `OutboxBanner` renders
 * `queue.summary()`.
 *
 * `store.ts` and `queue.ts` reach native modules (sqlite, NetInfo, crypto), so
 * node tests import `./policy` directly rather than this barrel.
 */

export * from "./policy";
export * from "./queue";
export * from "./schema";
export * from "./store";
