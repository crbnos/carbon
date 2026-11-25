// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";

export type Row = Record<string, unknown> & { id: string; status: string };

/** One statement or transaction step, with the connection it ran on. */
export type LoggedStep = {
  connection: number;
  sql: string;
  parameters: readonly unknown[];
};

/**
 * A `plannedOrder` table in memory, for tests of the planning writers. It
 * records every statement and applies the ones the writers send: the
 * planned-order check (the Planned and Firm rows), a read by status, the
 * DELETE (by id and status), the `UPDATE … FROM (VALUES …)` and the
 * INSERT … RETURNING. A try of an advisory lock is refused while
 * `lockBusyTries` is above 0 (each try counts it down), else granted. Any
 * other statement reads nothing. `log` also records each transaction's
 * begin, commit and rollback, per connection.
 */
export class RecordingDriver implements Driver {
  readonly sent: CompiledQuery[] = [];
  readonly log: LoggedStep[] = [];
  /** How many more tries of an advisory lock another session wins. */
  lockBusyTries = 0;
  private nextId = 1;
  private connections = 0;
  private readonly connectionIds = new WeakMap<DatabaseConnection, number>();
  constructor(readonly rows: Row[]) {}

  // No pool to open, release or close.
  async init() {
    return;
  }

  async releaseConnection() {
    return;
  }

  async destroy() {
    return;
  }

  private apply(query: CompiledQuery): unknown[] {
    const params = query.parameters as unknown[];
    const sqlText = query.sql;
    if (sqlText.includes("pg_try_advisory_xact_lock")) {
      if (this.lockBusyTries > 0) {
        this.lockBusyTries--;
        return [{ locked: false }];
      }
      return [{ locked: true }];
    }
    if (sqlText.includes('"createdSinceRead"')) {
      return this.rows
        .filter((row) => row.status === "Planned" || row.status === "Firm")
        .map((row) => ({
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt ?? null,
          createdSinceRead: false
        }));
    }
    if (sqlText.startsWith("select")) {
      const status = params[1];
      return this.rows.filter((row) => row.status === status);
    }
    if (sqlText.startsWith("delete")) {
      const [, status, ...ids] = params;
      for (let i = this.rows.length - 1; i >= 0; i--) {
        const row = this.rows[i]!;
        if (row.status === status && ids.includes(row.id)) {
          this.rows.splice(i, 1);
        }
      }
      return [];
    }
    if (sqlText.trimStart().startsWith("UPDATE")) {
      // updatedBy, updatedAt, then 8 values per row, then companyId
      const values = params.slice(2, -1);
      for (let i = 0; i < values.length; i += 8) {
        const [id, quantity, scrapQuantity, dueDate, releaseDate] =
          values.slice(i, i + 8);
        const row = this.rows.find(
          (r) => r.id === id && r.status === "Planned"
        );
        if (!row) continue;
        Object.assign(row, {
          quantity,
          scrapQuantity,
          dueDate,
          releaseDate,
          updatedBy: params[0]
        });
      }
      return [];
    }
    if (sqlText.startsWith("insert")) {
      const columns = [
        ...(sqlText.match(/\(([^)]*)\) values/)?.[1] ?? "").matchAll(/"(\w+)"/g)
      ].map((m) => m[1]!);
      const inserted: Row[] = [];
      for (let i = 0; i < params.length; i += columns.length) {
        const row = Object.fromEntries(
          columns.map((column, j) => [column, params[i + j]])
        ) as Row;
        row.id = `new-${this.nextId++}`;
        this.rows.push(row);
        inserted.push(row);
      }
      return inserted;
    }
    return [];
  }

  private step(connection: DatabaseConnection, sql: string) {
    this.log.push({
      connection: this.connectionIds.get(connection) ?? 0,
      sql,
      parameters: []
    });
  }

  async beginTransaction(connection: DatabaseConnection) {
    this.step(connection, "begin");
  }

  async commitTransaction(connection: DatabaseConnection) {
    this.step(connection, "commit");
  }

  async rollbackTransaction(connection: DatabaseConnection) {
    this.step(connection, "rollback");
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const id = ++this.connections;
    const connection: DatabaseConnection = {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        this.log.push({
          connection: id,
          sql: query.sql,
          parameters: query.parameters
        });
        return { rows: this.apply(query) as R[] };
      },
      // oxlint-disable-next-line require-yield -- never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
    this.connectionIds.set(connection, id);
    return connection;
  }
}

export function recordingDatabase(rows: Row[] = []) {
  const driver = new RecordingDriver(rows);
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, driver };
}

/** What a statement is, for asserting the order of a write. */
export function kindOf(step: { sql: string; parameters: readonly unknown[] }) {
  if (step.sql.includes("advisory_xact_lock")) return "lock";
  if (step.sql.includes('"createdSinceRead"')) return "check";
  return step.sql.trimStart().split(/\s/)[0]!.toLowerCase();
}
