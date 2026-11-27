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

/** One WHERE predicate of a statement, with its bound value(s). */
type Predicate = {
  column: string;
  test: (value: unknown) => boolean;
};

/**
 * The WHERE predicates of a compiled statement that compare a column with
 * bound parameters: `= $n`, `!= $n`, `in ($n, …)` and `= any($n)`. A
 * predicate on a column a fixture row does not carry is not applied to it,
 * so a test states only the columns it is about.
 */
function predicatesOf(sqlText: string, params: unknown[]): Predicate[] {
  const where = sqlText.split(/ where /i)[1] ?? "";
  const param = (n: string) => params[Number(n) - 1];
  const predicates: Predicate[] = [];
  for (const m of where.matchAll(/"(\w+)" = any\(\$(\d+)\)/g)) {
    const values = param(m[2]!) as unknown[];
    predicates.push({ column: m[1]!, test: (v) => values.includes(v) });
  }
  for (const m of where.matchAll(/"(\w+)" (=|!=|<>) \$(\d+)/g)) {
    const value = param(m[3]!);
    const equal = m[2] === "=";
    predicates.push({
      column: m[1]!,
      test: (v) => (v === value) === equal
    });
  }
  for (const m of where.matchAll(/"(\w+)" in \(([^)]*)\)/g)) {
    const values = [...m[2]!.matchAll(/\$(\d+)/g)].map((n) => param(n[1]!));
    predicates.push({ column: m[1]!, test: (v) => values.includes(v) });
  }
  return predicates;
}

function matches(row: Record<string, unknown>, predicates: Predicate[]) {
  return predicates.every(
    ({ column, test }) => !(column in row) || test(row[column])
  );
}

/**
 * A `plannedOrder` table in memory, for tests of the planning writers. It
 * records every statement and applies the ones the writers send: the
 * planned-order check (the Planned and Firm rows), a SELECT and a DELETE by
 * their WHERE predicates (`predicatesOf`: every column a row carries,
 * `companyId` and `locationId` included), the `UPDATE … FROM (VALUES …)`
 * and the INSERT … RETURNING. A SELECT from another table reads `tables`
 * (none by default). Any other statement reads nothing. `log` also records
 * each transaction's begin, commit and rollback, per connection.
 */
export class RecordingDriver implements Driver {
  readonly sent: CompiledQuery[] = [];
  readonly log: LoggedStep[] = [];
  private nextId = 1;
  private connections = 0;
  private readonly connectionIds = new WeakMap<DatabaseConnection, number>();
  constructor(
    readonly rows: Row[],
    /** Rows of the other tables a SELECT reads (`job`, `purchaseOrderLine`). */
    readonly tables: Record<string, Record<string, unknown>[]> = {}
  ) {}

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
    const table = sqlText.match(/ from "(\w+)"/)?.[1];
    if (sqlText.includes('"createdSinceRead"')) {
      const companyId = params[0];
      return this.rows
        .filter(
          (row) =>
            (!("companyId" in row) || row.companyId === companyId) &&
            (row.status === "Planned" || row.status === "Firm")
        )
        .map((row) => ({
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt ?? null,
          createdSinceRead: false
        }));
    }
    if (sqlText.startsWith("select")) {
      const rows = table === "plannedOrder" ? this.rows : this.tables[table!];
      const predicates = predicatesOf(sqlText, params);
      return (rows ?? []).filter((row) => matches(row, predicates));
    }
    if (sqlText.startsWith("delete") && table === "plannedOrder") {
      const predicates = predicatesOf(sqlText, params);
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (matches(this.rows[i]!, predicates)) this.rows.splice(i, 1);
      }
      return [];
    }
    if (sqlText.trimStart().startsWith("UPDATE")) {
      // updatedBy, updatedAt, then 8 values per row, then companyId
      const values = params.slice(2, -1);
      const companyId = params.at(-1);
      for (let i = 0; i < values.length; i += 8) {
        const [id, quantity, scrapQuantity, dueDate, releaseDate] =
          values.slice(i, i + 8);
        const row = this.rows.find(
          (r) =>
            r.id === id &&
            r.status === "Planned" &&
            (!("companyId" in r) || r.companyId === companyId)
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

export function recordingDatabase(
  rows: Row[] = [],
  tables: Record<string, Record<string, unknown>[]> = {}
) {
  const driver = new RecordingDriver(rows, tables);
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
