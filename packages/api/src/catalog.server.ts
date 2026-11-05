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
      let schema: Record<string, unknown> | undefined;
      const operation = {
        name,
        module,
        classification,
        title,
        description: operationDescription(title, value.description?.trim()),
        permission: published,
        paginates: declaresPaging(input),
        serviceFn: { path: [module, constName] },
        fn: value,
        publish: value.publish
      } as Operation;
      // Lazy: 1786 conversions take about 100 ms, but nothing needs them before
      // the first OpenAPI render or MCP describe.
      Object.defineProperty(operation, "schema", {
        enumerable: true,
        get: () => {
          schema ??= inputJsonSchema(input);
          return schema;
        }
      });
      operations.push(operation);
    }
  }
  return operations;
}
