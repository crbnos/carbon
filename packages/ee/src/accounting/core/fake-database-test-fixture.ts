// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ACCOUNT_MAPPING_ENTITY_TYPE } from "./account-mapping";

/**
 * An in-memory stand-in for the Kysely database the accounting syncers take.
 * It keeps rows per table, applies `where` filters, upserts on the conflict
 * columns, and runs `transaction()` (and the raw `SET LOCAL` inside
 * `withTriggersDisabled`) against the same rows, so a test seeds rows and
 * asserts the rows a push left behind. Joins are ignored and `orderBy` is a
 * no-op: it serves the single-table reads and writes the syncers make.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

/** "m.entityId" → "entityId"; "a.number as accountNumber" → [number, accountNumber]. */
const column = (ref: string) => ref.split(".").pop() as string;
function projection(ref: string): [string, string] {
  const [source, alias] = ref.split(/\s+as\s+/i) as [string, string?];
  return [column(source), alias ?? column(source)];
}

export type FakeDatabase = ReturnType<typeof fakeDatabase>;

export function fakeDatabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(seed))
    tables[table] = rows.map((row) => ({ ...row }));
  const failures: Record<string, Error[]> = {};
  let nextId = 0;

  // "externalIntegrationMapping as m" → "externalIntegrationMapping"
  const rowsOf = (table: string) =>
    (tables[table.split(/\s+as\s+/i)[0] as string] ??= []);

  /** Throws the next queued failure for a write to `table`, if any. */
  function guard(table: string) {
    const error = failures[table]?.shift();
    if (error) throw error;
  }

  function whereClause(filters: Filter[]) {
    return (ref: string, op: string, value: unknown) => {
      const key = column(ref);
      filters.push((row) => {
        const expected = typeof value === "function" ? subquery(value) : value;
        if (op === "in") return (expected as unknown[]).includes(row[key]);
        if (op === "is") return row[key] == null;
        if (op === "is not") return row[key] != null;
        if (op === "!=" || op === "<>") return row[key] !== expected;
        return row[key] === expected;
      });
    };
  }

  // `where("x", "=", (eb) => eb.selectFrom(...).select("c").where(...))`
  function subquery(build: unknown) {
    const query = (build as (eb: unknown) => { first(): unknown })({
      selectFrom: select
    });
    return query.first();
  }

  function select(table: string) {
    const filters: Filter[] = [];
    let columns: Array<[string, string]> | null = null;
    const matched = () =>
      rowsOf(table)
        .filter((row) => filters.every((f) => f(row)))
        .map((row) =>
          columns
            ? Object.fromEntries(columns.map(([from, to]) => [to, row[from]]))
            : { ...row }
        );
    const builder: any = {
      select(refs: string | string[]) {
        columns = [
          ...(columns ?? []),
          ...(Array.isArray(refs) ? refs : [refs]).map(projection)
        ];
        return builder;
      },
      selectAll: () => builder,
      leftJoin: () => builder,
      innerJoin: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      where(ref: string, op: string, value: unknown) {
        whereClause(filters)(ref, op, value);
        return builder;
      },
      /** First selected value of the first row, for a scalar subquery. */
      first: () => {
        const row = matched()[0];
        return row ? Object.values(row)[0] : undefined;
      },
      execute: async () => matched(),
      executeTakeFirst: async () => matched()[0],
      executeTakeFirstOrThrow: async () => {
        const row = matched()[0];
        if (!row) throw new Error(`no ${table} row`);
        return row;
      }
    };
    return builder;
  }

  function insert(table: string) {
    let values: Row[] = [];
    let conflict: { columns: string[]; patch: Row | null } | null = null;
    const run = async () => {
      guard(table);
      const rows = rowsOf(table);
      return values.map((value) => {
        const existing = conflict
          ? rows.find((row) =>
              conflict!.columns.every((c) => row[c] === value[c])
            )
          : undefined;
        if (existing) {
          if (conflict?.patch) Object.assign(existing, conflict.patch);
          return existing;
        }
        const row = { id: `${table}-${++nextId}`, ...value };
        rows.push(row);
        return row;
      });
    };
    const builder: any = {
      values(value: Row | Row[]) {
        values = Array.isArray(value) ? value : [value];
        return builder;
      },
      onConflict(build: (oc: unknown) => unknown) {
        const target = (columns: string[]) => ({
          doUpdateSet(patch: Row) {
            conflict = { columns, patch };
          },
          doNothing() {
            conflict = { columns, patch: null };
          }
        });
        build({
          columns: target,
          column: (c: string) => target([c])
        });
        return builder;
      },
      returning: () => builder,
      returningAll: () => builder,
      execute: run,
      executeTakeFirst: async () => (await run())[0],
      executeTakeFirstOrThrow: async () => (await run())[0] as Row
    };
    return builder;
  }

  function update(table: string) {
    const filters: Filter[] = [];
    let patch: Row = {};
    const run = async () => {
      guard(table);
      const rows = rowsOf(table).filter((row) => filters.every((f) => f(row)));
      for (const row of rows) Object.assign(row, patch);
      return [{ numUpdatedRows: BigInt(rows.length) }];
    };
    const builder: any = {
      set(value: Row) {
        patch = value;
        return builder;
      },
      where(ref: string, op: string, value: unknown) {
        whereClause(filters)(ref, op, value);
        return builder;
      },
      returning: () => builder,
      execute: run,
      executeTakeFirst: async () => (await run())[0]
    };
    return builder;
  }

  function remove(table: string) {
    const filters: Filter[] = [];
    const builder: any = {
      where(ref: string, op: string, value: unknown) {
        whereClause(filters)(ref, op, value);
        return builder;
      },
      execute: async () => {
        guard(table);
        const rows = rowsOf(table);
        const kept = rows.filter((row) => !filters.every((f) => f(row)));
        const deleted = rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
        return [{ numDeletedRows: BigInt(deleted) }];
      }
    };
    return builder;
  }

  // What `sql\`…\`.execute(db)` needs: the raw statement is a no-op here.
  const executor = {
    transformQuery: (node: unknown) => node,
    compileQuery: (node: unknown) => ({ query: node, sql: "", parameters: [] }),
    executeQuery: async () => ({ rows: [] })
  };

  const database = {
    selectFrom: select,
    insertInto: insert,
    updateTable: update,
    deleteFrom: remove,
    getExecutor: () => executor,
    transaction: () => ({
      execute: <T>(operation: (tx: unknown) => Promise<T>) =>
        operation(database)
    })
  };

  return {
    /** Pass as the syncer's `database`. */
    database: database as never,
    /** The rows a table holds now. */
    rows: (table: string) => rowsOf(table),
    /** The next write to `table` throws `error`. */
    failNextWrite(table: string, error: Error) {
      (failures[table] ??= []).push(error);
    }
  };
}

/** Account-mapping rows: each Carbon account id → the provider's account code. */
export function accountMappingRows(
  codes: Record<string, string>,
  integration: string,
  companyId = "company-1"
): Row[] {
  return Object.entries(codes).map(([accountId, externalCode]) => ({
    entityType: ACCOUNT_MAPPING_ENTITY_TYPE,
    entityId: accountId,
    integration,
    companyId,
    externalId: `remote-${accountId}`,
    metadata: { externalCode }
  }));
}
