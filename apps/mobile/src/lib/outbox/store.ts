// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { nowIso } from "./policy";
import {
  laneOf,
  OUTBOX_MIGRATION,
  OUTBOX_TABLE,
  type OutboxCommand,
  type OutboxPatch,
  type OutboxRow
} from "./schema";

/**
 * The outbox's sqlite layer, and the ONLY file that knows SQL.
 *
 * It decides nothing: `policy.ts` holds every rule and this just reads and
 * writes rows. Two things it does enforce, because only the database can:
 *
 *  - **Scope.** Every statement carries `instanceId` AND `companyId`. A company
 *    id is not unique across instances (staging restored from a production
 *    backup has the same ids), so one tablet linked to two Carbons would
 *    otherwise share one queue and send a company's commands to the wrong
 *    server. The store is built around a scope and cannot be asked for another.
 *  - **Single flight.** `claim` is a conditional UPDATE, so two overlapping
 *    sender passes cannot both take the same row — the second one's `changes`
 *    comes back 0. A flag in JavaScript would not survive two `flush`es racing.
 */

export type OutboxScope = { instanceId: string; companyId: string };

/** Everything the caller must supply beyond the command itself. */
export type EnqueueInput = OutboxCommand & {
  sessionUserId: string;
  /**
   * Minted by the CALLER, once, with `newIdempotencyKey()` from
   * `~/lib/api/client`. It is an argument rather than something this file
   * generates so the store stays free of native crypto and so there is exactly
   * one place a key is created per row.
   */
  idempotencyKey: string;
  /** Defaults to now. Injectable so a dev build can backdate a row. */
  createdAt?: string;
};

export type OutboxStore = {
  scope: OutboxScope;
  /** Appends a row. `seq` comes from sqlite, so order is never ambiguous. */
  insert(input: EnqueueInput): Promise<OutboxRow>;
  /** Every unsent row of this scope, oldest first. */
  list(): Promise<OutboxRow[]>;
  get(id: string): Promise<OutboxRow | null>;
  patch(id: string, patch: OutboxPatch): Promise<void>;
  /** `queued → sending`. False when the row was not queued any more. */
  claim(id: string): Promise<boolean>;
  /** A sent row is deleted — see `OutboxState` for why there is no `done`. */
  remove(id: string): Promise<void>;
  /** Discard everything queued for this scope (an unlink or a wipe). */
  clear(): Promise<void>;
};

export const OUTBOX_DB_NAME = "carbon-outbox.db";

/** Opens the device's one outbox database and brings its schema up to date. */
export async function openOutboxDatabase(
  databaseName: string = OUTBOX_DB_NAME
): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(databaseName);
  await db.execAsync(OUTBOX_MIGRATION);
  return db;
}

/** Column order is shared by the SELECTs so the row shape has one source. */
const COLUMNS = `seq, id, instanceId, companyId, sessionUserId,
  operatorUserId, operationId, lane, method, path, body, kind, label,
  idempotencyKey, createdAt, attempts, state, lastError, lastErrorCode,
  nextAttemptAt, confirmedAt`;

/** The columns a patch may touch, and nothing else. */
const PATCHABLE = [
  "state",
  "attempts",
  "idempotencyKey",
  "lastError",
  "lastErrorCode",
  "nextAttemptAt",
  "confirmedAt"
] as const satisfies readonly (keyof OutboxPatch)[];

export function createOutboxStore(
  db: SQLiteDatabase,
  scope: OutboxScope
): OutboxStore {
  const where = "instanceId = ? AND companyId = ?";
  const scoped = [scope.instanceId, scope.companyId];

  async function get(id: string): Promise<OutboxRow | null> {
    return await db.getFirstAsync<OutboxRow>(
      `SELECT ${COLUMNS} FROM ${OUTBOX_TABLE} WHERE id = ? AND ${where}`,
      [id, ...scoped]
    );
  }

  return {
    scope,

    async insert(input) {
      const createdAt = input.createdAt ?? nowIso();
      const lane = laneOf({ operationId: input.operationId ?? null });
      // The row's handle is the key it was FIRST enqueued with: already a
      // unique id, and stable afterwards — the operator's Retry replaces
      // `idempotencyKey` but must not change what the UI is pointing at.
      const id = `ob_${input.idempotencyKey}`;
      await db.runAsync(
        `INSERT INTO ${OUTBOX_TABLE}
          (id, instanceId, companyId, sessionUserId, operatorUserId,
           operationId, lane, method, path, body, kind, label,
           idempotencyKey, createdAt, attempts, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'POST', ?, ?, ?, ?, ?, ?, 0, 'queued')`,
        [
          id,
          scope.instanceId,
          scope.companyId,
          input.sessionUserId,
          // The operator's ID, never their token (AGENTS.md: memory only).
          input.operatorUserId ?? null,
          input.operationId ?? null,
          lane,
          input.path,
          JSON.stringify(input.body ?? null),
          input.kind,
          input.label,
          input.idempotencyKey,
          createdAt
        ]
      );
      const inserted = await get(id);
      if (!inserted) {
        // The INSERT reported no error, so a missing row means the scope moved
        // under us. Say so rather than hand the queue a half-made row.
        throw new Error("Outbox row vanished immediately after insert");
      }
      return inserted;
    },

    async list() {
      return await db.getAllAsync<OutboxRow>(
        `SELECT ${COLUMNS} FROM ${OUTBOX_TABLE} WHERE ${where} ORDER BY seq ASC`,
        scoped
      );
    },

    get,

    async patch(id, patch) {
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const column of PATCHABLE) {
        const value = patch[column];
        if (value === undefined) continue;
        sets.push(`${column} = ?`);
        values.push(value);
      }
      if (!sets.length) return;
      await db.runAsync(
        `UPDATE ${OUTBOX_TABLE} SET ${sets.join(", ")}
         WHERE id = ? AND ${where}`,
        [...values, id, ...scoped]
      );
    },

    async claim(id) {
      const result = await db.runAsync(
        `UPDATE ${OUTBOX_TABLE} SET state = 'sending'
         WHERE id = ? AND ${where} AND state = 'queued'`,
        [id, ...scoped]
      );
      return result.changes === 1;
    },

    async remove(id) {
      await db.runAsync(
        `DELETE FROM ${OUTBOX_TABLE} WHERE id = ? AND ${where}`,
        [id, ...scoped]
      );
    },

    async clear() {
      await db.runAsync(`DELETE FROM ${OUTBOX_TABLE} WHERE ${where}`, scoped);
    }
  };
}
