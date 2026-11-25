// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An in-memory Supabase client for the unit-write tests: it keeps rows per
// table, applies the filters a query names, and records every read, write and
// posting, so a test asserts what was (not) written. Like PostgREST's
// `max_rows`, a read returns at most 1000 rows (`range` pages past it).

type Row = Record<string, unknown>;
const MAX_ROWS = 1000;
export type Call = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  filters: [string, unknown][];
  values?: unknown;
};

function valueAt(row: Row, column: string): unknown {
  const json = column.match(/^(\w+)->>(.+)$/);
  if (json) return (row[json[1]!] as Row | null | undefined)?.[json[2]!];
  const [relation, field] = column.split(".");
  if (relation && field) return (row[relation] as Row | undefined)?.[field];
  return row[column];
}

/** A client over `tables`; `rpcs` answers `client.rpc(name)`. */
export function fakeClient(
  tables: Record<string, Row[]> = {},
  rpcs: Record<string, unknown> = {}
) {
  const calls: Call[] = [];
  const posts: { name: string; input: Row }[] = [];

  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    let rows = [...(tables[table] ?? [])];
    let shape: "many" | "maybe" | "one" = "many";
    let projection = "";
    let window: [number, number] = [0, MAX_ROWS - 1];
    const keep = (column: string, test: (value: unknown) => boolean) => {
      // An embedded filter excludes a parent row only with an inner join.
      const [relation] = column.split(".");
      if (!column.includes(".") || projection.includes(`${relation}!inner(`))
        rows = rows.filter((r) => test(valueAt(r, column)));
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const method of [
      "order",
      "or",
      "not",
      "ilike",
      "contains",
      "gt",
      "gte",
      "lt",
      "lte",
      "returns",
      "throwOnError"
    ]) {
      builder[method] = chain;
    }
    const write = (op: Call["op"]) => (values?: unknown) => {
      call.op = op;
      call.values = values;
      rows =
        op === "insert" || op === "upsert"
          ? ([] as Row[]).concat((values as Row) ?? [])
          : [];
      return builder;
    };
    builder.select = (columns = "*") => {
      projection = columns;
      return builder;
    };
    builder.insert = write("insert");
    builder.upsert = write("upsert");
    builder.update = write("update");
    builder.delete = write("delete");
    builder.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      keep(column, (v) => v === value);
      return builder;
    };
    builder.neq = (column: string, value: unknown) => {
      call.filters.push([column, `neq.${value}`]);
      keep(column, (v) => v !== value);
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      call.filters.push([column, values]);
      keep(column, (v) => values.includes(v));
      return builder;
    };
    builder.is = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      keep(column, (v) => (v ?? null) === value);
      return builder;
    };
    builder.range = (from: number, to: number) => {
      window = [from, Math.min(to, from + MAX_ROWS - 1)];
      return builder;
    };
    builder.limit = (count: number) => {
      window = [window[0], window[0] + Math.min(count, MAX_ROWS) - 1];
      return builder;
    };
    builder.maybeSingle = () => {
      shape = "maybe";
      return builder;
    };
    builder.single = () => {
      shape = "one";
      return builder;
    };
    builder.then = (resolve: (value: unknown) => void) => {
      if (shape === "many") {
        const page = rows.slice(window[0], window[1] + 1);
        return resolve({ data: page, error: null, count: rows.length });
      }
      const row = rows[0] ?? null;
      if (shape === "one" && !row) {
        return resolve({
          data: null,
          error: { message: "No rows", code: "PGRST116" }
        });
      }
      return resolve({ data: row, error: null });
    };
    return builder;
  };

  const client = {
    from,
    rpc(name: string, args?: unknown) {
      calls.push({ table: name, op: "rpc", filters: [], values: args });
      const data = rpcs[name] ?? [];
      const result = { data, error: null };
      return Object.assign(Promise.resolve(result), {
        maybeSingle: () =>
          Promise.resolve({
            data: Array.isArray(data) ? (data[0] ?? null) : data,
            error: null
          }),
        single: () =>
          Promise.resolve({
            data: Array.isArray(data) ? data[0] : data,
            error: null
          })
      });
    }
  };

  /** Stands in for `erpPosting`: records the posting and answers success. */
  const post = async (name: string, _caller: unknown, input: Row) => {
    posts.push({ name, input });
    return { data: {}, error: null };
  };

  const writes = () => [
    ...calls.filter((c) => c.op !== "select" && c.op !== "rpc"),
    ...posts.map((p) => ({
      table: p.name,
      op: "post" as const,
      filters: [],
      values: p.input
    }))
  ];

  return { client: client as never, calls, posts, post: post as never, writes };
}

/** A serial make method's units, axis order; `done` marks a unit complete at `operationId`. */
export function serialUnits(
  jobMakeMethodId: string,
  operationId: string,
  units: { id: string; done?: boolean }[]
) {
  return units.map((unit, index) => ({
    id: unit.id,
    companyId: "co",
    status: "Reserved",
    readableId: `SN-${index + 1}`,
    createdAt: `2026-01-01T00:00:0${index}Z`,
    attributes: {
      "Job Make Method": jobMakeMethodId,
      ...(unit.done ? { [`Operation ${operationId}`]: index } : {})
    }
  }));
}

/** A posted output as returned by PostgREST with its activity embedded. */
export function operationOutput(
  unitId: string,
  operationId: string,
  type: string
) {
  return {
    companyId: "co",
    trackedEntityId: unitId,
    trackedActivity: {
      companyId: "co",
      sourceDocument: "Job Operation",
      sourceDocumentId: operationId,
      type
    }
  };
}

/** An operation row with the embeds `readOperationUnitFacts` reads. */
export function serialOperation(args: {
  id: string;
  jobMakeMethodId: string;
  later: boolean;
  serial?: boolean;
  batch?: boolean;
  extra?: Row;
}) {
  return {
    id: args.id,
    companyId: "co",
    jobId: "job",
    jobMakeMethodId: args.jobMakeMethodId,
    workCenterId: null,
    operationType: "Operation",
    operationQuantity: 10,
    targetQuantity: 10,
    quantityComplete: 0,
    quantityReworked: 0,
    jobMakeMethod: {
      requiresSerialTracking: args.serial ?? true,
      requiresBatchTracking: args.batch ?? false
    },
    priors: args.later
      ? [{ dependsOn: { jobMakeMethodId: args.jobMakeMethodId } }]
      : [],
    ...args.extra
  };
}
