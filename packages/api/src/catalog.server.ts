// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The operation catalog, built from the service-function registry at runtime:
// one entry per `defineServiceFn` const with `publish` set. The HTTP router, the
// MCP tool list and the OpenAPI document are views of this list. Nothing here
// reads generated output: the name comes from the router, the input schema
// from the function's own zod validator, the classification from its
// permission literal, the title and description from the definition.

import { z } from "zod";
import type {
  Classification,
  ManifestEntry,
  PermissionAction,
  ToolPermission
} from "./manifest-types";
import type { Permissions } from "./permissions";
import type { Publish, ServiceFn } from "./service-fn.server";

/** A published operation: a manifest entry with the function it dispatches to. */
export type Operation = ManifestEntry & {
  fn: ServiceFn<z.ZodType, unknown>;
  publish: Publish;
};

/** A module namespace as `router.server.ts` exports it: service functions by const name. */
export type ServiceRegistry = Record<string, Record<string, unknown>>;

const ACTIONS: readonly PermissionAction[] = [
  "view",
  "create",
  "update",
  "delete"
];

function isServiceFn(value: unknown): value is ServiceFn<z.ZodType, unknown> {
  return (
    typeof value === "function" &&
    "input" in value &&
    "permission" in value &&
    value.input instanceof z.ZodType
  );
}

/**
 * The permission as the catalog publishes it: the actions of a literal rule,
 * and its module when exactly one module is named. Membership alone (`{}`) and
 * a rule across modules publish `module: null`; the function's own gate still
 * decides at call time.
 */
export function publishedPermission(
  name: string,
  permission: unknown
): { published: ToolPermission; actions: PermissionAction[] } {
  if (permission === "system") {
    throw new Error(
      `${name}: a system-only service function cannot be published`
    );
  }
  if (typeof permission !== "object" || permission === null) {
    throw new Error(
      `${name}: a published service function names its permission ({ update: "<module>" }), not ${String(permission)}`
    );
  }
  if ("by" in permission) {
    throw new Error(`${name}: a keyed permission cannot be published yet`);
  }
  const rule = permission as Permissions & object;
  const actions: PermissionAction[] = [];
  const modules = new Set<string>();
  for (const action of ACTIONS) {
    const value = rule[action];
    if (value === undefined) continue;
    actions.push(action);
    for (const module of Array.isArray(value) ? value : [value]) {
      modules.add(module);
    }
  }
  const published: ToolPermission =
    modules.size === 1
      ? { module: [...modules][0]!, actions }
      : { module: null, actions: [] };
  return { published, actions };
}

/** READ when only `view` is required, DESTRUCTIVE when anything is deleted, else WRITE. */
export function classify(
  name: string,
  publish: Publish,
  actions: PermissionAction[]
): Classification {
  if (publish === "destructive") return "DESTRUCTIVE";
  if (publish === "read") {
    const writes = actions.filter((action) => action !== "view");
    if (writes.length > 0) {
      throw new Error(
        `${name}: publish "read" on a permission that requires ${writes.join(", ")}; a READ is offered as safe to run unasked`
      );
    }
    return "READ";
  }
  if (actions.includes("delete")) return "DESTRUCTIVE";
  if (actions.length > 0 && actions.every((action) => action === "view")) {
    return "READ";
  }
  return "WRITE";
}

/**
 * The input's JSON Schema, from the zod validator, as a request is written:
 * an optional or defaulted field is not required, a `z.object` lists its
 * properties and nothing else (an unknown key is refused by the MCP before
 * dispatch), a `z.looseObject` carries `additionalProperties`. Field
 * descriptions are the validator's `.describe()` texts.
 */
export function inputJsonSchema(input: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(input, {
    io: "input",
    unrepresentable: "any"
  }) as Record<string, unknown>;
  return schema;
}

/**
 * `GenericQueryFilters.filters` (`apps/erp/app/utils/query.ts`): what a paged
 * list read takes beside `limit` and `offset`. Published here and by the
 * generator from the one definition.
 */
export const GENERIC_FILTERS_SCHEMA: Record<string, unknown> = {
  type: "array",
  description:
    "Narrows the list: each filter names a column of the query the list is read from, usually one of the returned fields (a view may name its source columns differently). `in` and `contains` take a comma-separated list, `between` takes `from,to`.",
  items: {
    type: "object",
    properties: {
      column: { type: "string" },
      operator: {
        type: "string",
        enum: [
          "between",
          "contains",
          "eq",
          "gt",
          "gte",
          "in",
          "lt",
          "lte",
          "neq",
          "startsWith"
        ]
      },
      value: { type: "string" }
    },
    required: ["column", "operator", "value"]
  }
};

/** `GenericQueryFilters.sorts`. */
export const GENERIC_SORTS_SCHEMA: Record<string, unknown> = {
  type: "array",
  description:
    "Orders the list by columns of the query it is read from, first to last.",
  items: {
    type: "object",
    properties: {
      sortBy: { type: "string" },
      sortAsc: { type: "boolean" }
    },
    required: ["sortBy", "sortAsc"]
  }
};

/**
 * A paged list read's input also takes `filters` and `sorts`: the building
 * block applies them through `setGenericQueryFilters`, which the loose input
 * lets through unnamed. Published so `describe_tool` and the API document
 * list them (every paged read of the generated manifest had them).
 */
function withListFilters(
  schema: Record<string, unknown>,
  paginates: boolean
): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!paginates || !properties || schema.additionalProperties === undefined) {
    return schema;
  }
  properties.filters ??= GENERIC_FILTERS_SCHEMA;
  properties.sorts ??= GENERIC_SORTS_SCHEMA;
  return schema;
}

/** Whether the input declares both `limit` and `offset`: the MCP then pages the call. */
function declaresPaging(input: z.ZodType): boolean {
  if (input instanceof z.ZodObject) {
    const keys = Object.keys(input.shape);
    return keys.includes("limit") && keys.includes("offset");
  }
  const properties = inputJsonSchema(input).properties;
  return (
    typeof properties === "object" &&
    properties !== null &&
    "limit" in properties &&
    "offset" in properties
  );
}

/**
 * The response JSON Schema of a declared `output`, as the API sends it. The
 * row schemas' `meta` (`table`, `view`) and zod's `additionalProperties: false`
 * are stripped: they describe the source, not the wire.
 */
export function outputJsonSchema(output: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(output, {
    io: "output",
    unrepresentable: "any"
  }) as Record<string, unknown>;
  // Walks schema nodes only: a `properties` map's keys are field names, and a
  // field may well be called `table` or `view`.
  const strip = (node: unknown): void => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    delete record.$schema;
    delete record.table;
    delete record.view;
    if (record.additionalProperties === false) {
      delete record.additionalProperties;
    }
    strip(record.items);
    strip(record.additionalProperties);
    for (const member of (record.anyOf as unknown[] | undefined) ?? []) {
      strip(member);
    }
    for (const member of (record.prefixItems as unknown[] | undefined) ?? []) {
      strip(member);
    }
    const properties = record.properties as Record<string, unknown> | undefined;
    if (properties) for (const value of Object.values(properties)) strip(value);
  };
  strip(schema);
  return schema;
}

/** The schema inside `.nullable()` / `.optional()` wrappers. */
function unwrapped(schema: z.ZodType): z.ZodType {
  let inner: z.ZodType = schema;
  while (inner instanceof z.ZodNullable || inner instanceof z.ZodOptional) {
    inner = inner.unwrap() as z.ZodType;
  }
  return inner;
}

/** The table a row schema's `id` belongs to (`meta.table` of `rows.*`), if any. */
function tableOfRow(schema: z.ZodType): string | undefined {
  const table = unwrapped(schema).meta()?.table;
  return typeof table === "string" ? table : undefined;
}

/**
 * What a declared output says about the table it returns: the row's table,
 * and whether it is a list of rows carrying an `id`.
 */
function outputRows(
  output: z.ZodType | undefined
): { table: string; list: boolean; hasId: boolean } | undefined {
  if (!output) return undefined;
  const inner = unwrapped(output);
  const list = inner instanceof z.ZodArray;
  const row = unwrapped(list ? (inner.element as z.ZodType) : inner);
  const table = tableOfRow(row);
  if (!table) return undefined;
  const hasId = row instanceof z.ZodObject && "id" in row.shape;
  return { table, list, hasId };
}

const ID_FIELD = /^(.*?)(Id|Ids)$/;

/** The sentence a looked-up field gets: `See sales_getCustomersList.` */
export function lookupSentence(lookups: string[]): string {
  const names =
    lookups.length > 1
      ? `${lookups.slice(0, -1).join(", ")} or ${lookups[lookups.length - 1]}`
      : lookups[0];
  return `See ${names}.`;
}

/**
 * The READ list that returns a table's ids, for every table one does: a
 * general list — paged, a `…List`, or needing no input but parent ids —
 * whose output is an array of that table's rows with an `id`. The best is one
 * named after the table (`getProjectElements` over `getRdComponents`, which
 * lists a selection of them), then the fewest required inputs, then a
 * `…List`, then a paged one, then the shortest name.
 */
function listsByTable(operations: Operation[]): Map<string, string> {
  const candidates = new Map<
    string,
    {
      name: string;
      required: number;
      list: boolean;
      paged: boolean;
      named: boolean;
    }[]
  >();
  for (const op of operations) {
    if (op.classification !== "READ") continue;
    const rows = outputRows(op.fn.output);
    if (!rows?.list || !rows.hasId) continue;
    const required = (
      (inputJsonSchema(op.fn.input).required as string[] | undefined) ?? []
    ).filter((field) => !["limit", "offset"].includes(field));
    const general =
      op.paginates ||
      op.name.endsWith("List") ||
      required.every((field) => ID_FIELD.test(field));
    if (!general) continue;
    const entry = candidates.get(rows.table) ?? [];
    candidates.set(rows.table, entry);
    entry.push({
      name: op.name,
      required: required.length,
      list: op.name.endsWith("List"),
      paged: op.paginates,
      named: op.name.toLowerCase().includes(rows.table.toLowerCase())
    });
  }
  const best = new Map<string, string>();
  for (const [table, entries] of candidates) {
    entries.sort(
      (a, b) =>
        Number(b.named) - Number(a.named) ||
        a.required - b.required ||
        Number(b.list) - Number(a.list) ||
        Number(b.paged) - Number(a.paged) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name)
    );
    best.set(table, entries[0]!.name);
  }
  return best;
}

/**
 * Each operation's id lookups: an input `fooId` / `fooIds` points at the list
 * of table `foo`; `id` / `ids` at the list of the operation's own row table
 * (its output). Written as `lookups`, and as `See …` on the field when its
 * schema is built.
 */
function linkLookups(operations: Operation[]): void {
  const lists = listsByTable(operations);
  if (lists.size === 0) return;
  for (const op of operations) {
    const input = op.fn.input;
    const fields =
      input instanceof z.ZodObject
        ? Object.keys(input.shape)
        : Object.keys(
            (inputJsonSchema(input).properties as object | undefined) ?? {}
          );
    const own = outputRows(op.fn.output)?.table;
    const lookups: Record<string, string[]> = {};
    for (const field of fields) {
      const table =
        field === "id" || field === "ids" ? own : ID_FIELD.exec(field)?.[1];
      const list = table ? lists.get(table) : undefined;
      if (list && list !== op.name) lookups[field] = [list];
    }
    if (Object.keys(lookups).length > 0) op.lookups = lookups;
  }
}

/** Appends each looked-up field's `See …` sentence to its description. */
function withLookupSentences(
  schema: Record<string, unknown>,
  lookups: Record<string, string[]> | undefined
): Record<string, unknown> {
  const properties = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!lookups || !properties) return schema;
  for (const [field, names] of Object.entries(lookups)) {
    const property = properties[field];
    if (!property) continue;
    const sentence = lookupSentence(names);
    const description = property.description;
    property.description =
      typeof description === "string" && description.trim()
        ? `${description.trim().replace(/\.?$/, ".")} ${sentence}`
        : sentence;
  }
  return schema;
}

/** The operation's description: the title as a sentence, then the prose. */
export function operationDescription(
  title: string,
  description: string | undefined
): string {
  const sentence = /[.!?]$/.test(title) ? title : `${title}.`;
  return description ? `${sentence}\n\n${description}` : sentence;
}

/**
 * Every published operation of a registry, in router order. Throws on a
 * definition that cannot be published (no title, a system or keyed
 * permission, a `"read"` that writes), so a bad definition fails the first
 * boot rather than a caller's request.
 */
export function buildOperationCatalog(registry: ServiceRegistry): Operation[] {
  const operations: Operation[] = [];
  for (const [module, namespace] of Object.entries(registry)) {
    if (typeof namespace !== "object" || namespace === null) continue;
    for (const [constName, value] of Object.entries(namespace)) {
      if (!isServiceFn(value) || value.publish === undefined) continue;
      const name = `${module}_${constName}`;
      const title = value.title?.trim();
      if (!title) {
        throw new Error(`${name}: a published service function needs a title`);
      }
      const { published, actions } = publishedPermission(
        name,
        value.permission
      );
      const classification = classify(name, value.publish, actions);
      const input = value.input;
      const output = value.output;
      const paginates = declaresPaging(input);
      let schema: Record<string, unknown> | undefined;
      let responseSchema: Record<string, unknown> | undefined;
      const operation = {
        name,
        module,
        classification,
        title,
        description: operationDescription(title, value.description?.trim()),
        permission: published,
        paginates,
        serviceFn: { path: [module, constName] },
        fn: value,
        publish: value.publish
      } as Operation;
      // Lazy: 1786 conversions take about 100 ms, but nothing needs them before
      // the first OpenAPI render or MCP describe.
      Object.defineProperty(operation, "schema", {
        enumerable: true,
        get: () => {
          schema ??= withLookupSentences(
            withListFilters(inputJsonSchema(input), paginates),
            operation.lookups
          );
          return schema;
        }
      });
      // The declared output, as the wire sees it; absent when none is declared.
      Object.defineProperty(operation, "responseSchema", {
        enumerable: true,
        get: () => {
          if (!output) return undefined;
          responseSchema ??= outputJsonSchema(output);
          return responseSchema;
        }
      });
      operations.push(operation);
    }
  }
  linkLookups(operations);
  return operations;
}
