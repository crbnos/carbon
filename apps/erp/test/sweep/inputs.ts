// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Arguments for calling a tool against real data, worked out without guessing
 * at what its parameters mean.
 *
 * In order, for each required argument:
 *
 *  1. The column the service itself compares it to (`.eq("id", jobId)` on
 *     `job`, read off the body by `paramFilters`): a value of that column.
 *  2. What its type alone settles: an enum, a boolean, a number, a date, the
 *     first alternative of a union.
 *  3. What the REST of the codebase compares a parameter of that name to.
 *  4. What the database says the name is: `shipmentId` is `shipment.id` when
 *     there is a `shipment` table, else any column called `shipmentId`.
 *
 *  5. `null`, when the argument is required but may be null.
 *
 * The plan records which it used (`column` for 1, `name` for 3 and 4). An
 * argument none of them answers is left missing, and the tool is reported as
 * not called rather than called with something invented. The few that need a
 * value only a person knows are written down in `read-tools.inputs.ts`.
 */

export interface Column {
  table: string;
  column: string;
}

export type Planned =
  | { kind: "value"; value: unknown; source: "type" | "name" }
  | {
      kind: "sample";
      /** Columns to take a value from, most trusted first. */
      from: Column[];
      many: boolean;
      source: "column" | "name";
    }
  | { kind: "object"; fields: Record<string, Planned> };

export interface InputPlan {
  /** Top-level argument → how its value is obtained. */
  args: Record<string, Planned>;
  /** Required arguments nothing could supply, as a path (`args.report`). */
  missing: string[];
}

export interface Knowledge {
  /** A parameter name → the column the codebase compares it to (`consensusByName`). */
  consensus: Map<string, Column>;
  /** Every table and view of the database → its columns. */
  tables: Map<string, Set<string>>;
}

interface Property {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  items?: Property;
  anyOf?: Property[];
  oneOf?: Property[];
  properties?: Record<string, Property>;
  required?: string[];
}

interface ToolSchema {
  properties?: Record<string, Property>;
  required?: string[];
}

/** `args.jobId` and `jobId` both name the argument `jobId`. */
const fieldOf = (path: string) => path.slice(path.lastIndexOf(".") + 1);

/**
 * A filter on a plain column. PostgREST also filters on an embedded table's
 * column (`job.status`) and on a JSON path (`attributes->>Receipt`); neither
 * is a column a value can be sampled from.
 */
const isPlainColumn = (filter: Column) => /^[A-Za-z_]\w*$/.test(filter.column);

/** One column per argument name, preferring a comparison to a table's own `id`. */
export function columnsByArgument(
  filters: ReadonlyArray<{ path: string } & Column>
): Map<string, Column> {
  const columns = new Map<string, Column>();
  for (const { path, table, column } of filters.filter(isPlainColumn)) {
    const field = fieldOf(path);
    if (!columns.has(field) || column === "id") {
      columns.set(field, { table, column });
    }
  }
  return columns;
}

/**
 * What a parameter name means across every service. A name compared to exactly
 * one table's own `id` is that table's record id, whatever else it is compared
 * to (the rest are foreign keys holding the same ids). Otherwise the column it
 * is compared to most often; a name used two ways equally is left out.
 */
export function consensusByName(
  everyFilter: ReadonlyArray<{ path: string } & Column>
): Map<string, Column> {
  const counts = new Map<string, Map<string, number>>();
  for (const { path, table, column } of everyFilter.filter(isPlainColumn)) {
    const field = fieldOf(path);
    const key = `${table}.${column}`;
    const forField = counts.get(field) ?? new Map<string, number>();
    forField.set(key, (forField.get(key) ?? 0) + 1);
    counts.set(field, forField);
  }

  const consensus = new Map<string, Column>();
  const toColumn = (key: string): Column | undefined => {
    const [table, column] = key.split(".");
    return table && column ? { table, column } : undefined;
  };
  for (const [field, forField] of counts) {
    const ids = [...forField.keys()].filter((key) => key.endsWith(".id"));
    const ranked = [...forField].sort((a, b) => b[1] - a[1]);
    const [best, second] = ranked;
    const chosen =
      ids.length === 1
        ? ids[0]
        : best && !(second && second[1] === best[1])
          ? best[0]
          : undefined;
    const column = chosen ? toColumn(chosen) : undefined;
    if (column) consensus.set(field, column);
  }
  return consensus;
}

/** `shipmentId` → `shipment.id`, then every table with a `shipmentId` column. */
function columnsNamedFor(
  name: string,
  tables: Map<string, Set<string>>
): Column[] {
  const columns: Column[] = [];
  if (name.endsWith("Id")) {
    const table = name.slice(0, -2);
    if (tables.get(table)?.has("id")) columns.push({ table, column: "id" });
  }
  for (const table of [...tables.keys()].sort()) {
    if (tables.get(table)?.has(name)) columns.push({ table, column: name });
  }
  return columns;
}

const typeOf = (property: Property) =>
  Array.isArray(property.type)
    ? property.type.find((type) => type !== "null")
    : property.type;

const NULL: Planned = { kind: "value", value: null, source: "type" };

function planProperty(
  path: string,
  property: Property,
  own: Map<string, Column>,
  knowledge: Knowledge,
  today: string,
  missing: string[]
): Planned | undefined {
  const name = fieldOf(path);
  const type = typeOf(property);
  const many = type === "array";

  const compared = own.get(name);
  if (compared) {
    return { kind: "sample", from: [compared], many, source: "column" };
  }

  // A union: its first alternative that is not null, else null when allowed.
  const alternatives = property.anyOf ?? property.oneOf;
  if (alternatives) {
    const nullable = alternatives.some((branch) => branch.type === "null");
    const first = alternatives.find((branch) => branch.type !== "null");
    if (!first) return NULL;
    const unanswered: string[] = [];
    const planned = planProperty(path, first, own, knowledge, today, unanswered);
    if (planned && unanswered.length === 0) return planned;
    if (nullable) return NULL;
    missing.push(...unanswered);
    return planned;
  }

  if (property.enum && property.enum.length > 0) {
    return { kind: "value", value: property.enum[0], source: "type" };
  }
  if (many && property.items?.enum && property.items.enum.length > 0) {
    return { kind: "value", value: [property.items.enum[0]], source: "type" };
  }
  if (type === "boolean") return { kind: "value", value: false, source: "type" };
  if (type === "number" || type === "integer") {
    // The first page: an offset past the end is PostgREST's 416, not a list.
    return { kind: "value", value: name === "offset" ? 0 : 1, source: "type" };
  }
  if (property.format === "date" || property.format === "date-time") {
    return { kind: "value", value: today, source: "type" };
  }

  if (type === "object") {
    const fields: Record<string, Planned> = {};
    for (const required of property.required ?? []) {
      const planned = planProperty(
        `${path}.${required}`,
        property.properties?.[required] ?? {},
        own,
        knowledge,
        today,
        missing
      );
      if (planned) fields[required] = planned;
    }
    return { kind: "object", fields };
  }

  const byName = knowledge.consensus.get(name);
  const named = [
    ...(byName ? [byName] : []),
    ...columnsNamedFor(name, knowledge.tables)
  ];
  if (named.length > 0) {
    return { kind: "sample", from: named, many, source: "name" };
  }

  if (many) return { kind: "value", value: [], source: "type" };
  if (/date$/i.test(name)) return { kind: "value", value: today, source: "name" };
  // A search term that is required but empty means "do not search".
  if (name === "search" || name === "q") {
    return { kind: "value", value: "", source: "name" };
  }
  if (Array.isArray(property.type) && property.type.includes("null")) {
    return NULL;
  }
  missing.push(path);
  return undefined;
}

export function planInputs(
  schema: ToolSchema,
  filters: ReadonlyArray<{ path: string } & Column>,
  knowledge: Knowledge,
  today: string
): InputPlan {
  const own = columnsByArgument(filters);
  const properties = schema.properties ?? {};
  const plan: InputPlan = { args: {}, missing: [] };

  for (const name of schema.required ?? []) {
    const planned = planProperty(
      name,
      properties[name] ?? {},
      own,
      knowledge,
      today,
      plan.missing
    );
    if (planned) plan.args[name] = planned;
  }

  // A list read is bounded so the sweep stays quick; nothing else optional is sent.
  if (properties.limit && !plan.args.limit) {
    plan.args.limit = { kind: "value", value: 5, source: "type" };
  }
  return plan;
}

/** Whether any part of the plan takes its value from a parameter name. */
export function usesNames(planned: Planned): boolean {
  if (planned.kind === "object") {
    return Object.values(planned.fields).some(usesNames);
  }
  return planned.source === "name";
}
