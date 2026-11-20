// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * A Supabase client fake that applies the filters a query names. Each table
 * is a list of rows; `eq`, `neq`, `in` and `is` keep only the rows that
 * match, so a query that leaves out its `companyId` filter reads another
 * company's row and the test sees it. A filter on a column a row does not
 * carry keeps the row (fixtures name only what a test needs). `select`
 * returns whole rows, embeds included. Writes are recorded, not applied.
 *
 * A read of a table whose rows carry `companyId` throws
 * when the query names no `companyId` filter, whatever the fixture holds.
 * `unscoped` lists the tables a code path reads by another key on purpose
 * (a record by its id, to learn its company).
 */

export type FakeWrite = {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  value: any;
  filters: Array<[string, unknown]>;
};

export function filteringSupabase(
  tables: Record<string, any[]>,
  options: { unscoped?: string[] } = {}
) {
  const writes: FakeWrite[] = [];
  const from = (table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    const named: Array<[string, unknown]> = [];
    let scoped = false;
    let write: FakeWrite | null = null;
    const keep =
      (column: string, test: (value: unknown) => boolean) => (row: any) =>
        !(column in row) || test(row[column]);
    const rows = () =>
      (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const name = (column: string) => {
      if (column === "companyId") scoped = true;
    };
    const assertScoped = () => {
      if (scoped || options.unscoped?.includes(table)) return;
      if ((tables[table] ?? []).some((row) => "companyId" in row)) {
        throw new Error(`${table} was queried without a companyId filter`);
      }
    };

    const chain: Record<string, any> = {};
    for (const method of ["select", "order", "limit", "range", "or", "not"]) {
      chain[method] = () => chain;
    }
    chain.eq = (column: string, value: unknown) => {
      name(column);
      named.push([column, value]);
      filters.push(keep(column, (v) => v === value));
      return chain;
    };
    chain.match = (values: Record<string, unknown>) => {
      for (const [column, value] of Object.entries(values)) {
        chain.eq(column, value);
      }
      return chain;
    };
    chain.lte = (column: string, value: any) => {
      filters.push(keep(column, (v: any) => v <= value));
      return chain;
    };
    chain.gte = (column: string, value: any) => {
      filters.push(keep(column, (v: any) => v >= value));
      return chain;
    };
    chain.neq = (column: string, value: unknown) => {
      filters.push(keep(column, (v) => v !== value));
      return chain;
    };
    chain.is = (column: string, value: unknown) => {
      filters.push(keep(column, (v) => (v ?? null) === value));
      return chain;
    };
    chain.in = (column: string, values: unknown[]) => {
      name(column);
      filters.push(keep(column, (v) => values.includes(v)));
      return chain;
    };
    for (const op of ["insert", "update", "upsert"] as const) {
      chain[op] = (value: unknown) => {
        write = { table, op, value, filters: named };
        writes.push(write);
        return chain;
      };
    }
    chain.delete = () => {
      write = { table, op: "delete", value: null, filters: named };
      writes.push(write);
      return chain;
    };
    const result = (many: boolean) => {
      if (write && (write.op === "update" || write.op === "delete")) {
        // The rows the filters reach, as the write would return them.
        const reached = rows().map((row) => ({ ...row, ...write!.value }));
        return {
          data: many ? reached : (reached[0] ?? null),
          error: null
        };
      }
      if (write) {
        const value = Array.isArray(write.value) ? write.value : [write.value];
        const data = value.map((row: any, index: number) => ({
          id: `${table}-${index + 1}`,
          ...row
        }));
        return { data: many ? data : (data[0] ?? null), error: null };
      }
      assertScoped();
      const found = rows();
      return { data: many ? found : (found[0] ?? null), error: null };
    };
    chain.maybeSingle = async () => result(false);
    chain.single = async () => {
      const found = result(false);
      return found.data === null
        ? { data: null, error: { message: `No ${table} row` } }
        : found;
    };
    chain.then = (resolve: (value: unknown) => unknown, reject?: any) =>
      Promise.resolve()
        .then(() => result(true))
        .then(resolve, reject);
    return chain;
  };
  return { client: { from } as any, writes };
}
