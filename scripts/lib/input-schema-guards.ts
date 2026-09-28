/**
 * Guards over the published input schemas, checked against the TypeScript
 * checker's view of each service's params (`param-schema.ts`).
 *
 * `generate:mcp` fails on any violation, and `apps/erp/test/mcp-input-schema.test.ts`
 * runs the same checks, so the bug classes below cannot come back one tool at a
 * time:
 *
 * - a property required although its param or field may be left out (a `?`, an
 *   initializer, or a type that admits undefined);
 * - a required property whose only legal value is null;
 * - an untyped `{}` where the TypeScript type is not any/unknown/Json;
 * - a GenericQueryFilters param published nested, required, or with a required
 *   member; `filters`/`sorts` published for a service that ignores them, or
 *   missing for one that honours them; a `limit` default other than the one the
 *   MCP layer applies.
 */

import type { ManifestEntry } from "@carbon/api";
import type { JsonSchema } from "./response-schema";
import type { CheckedParam, ParamSchemaIndex } from "./param-schema";

type Properties = Record<string, JsonSchema>;

function propertiesOf(tool: ManifestEntry): Properties {
  return (tool.schema.properties ?? {}) as Properties;
}

function requiredOf(tool: ManifestEntry): Set<string> {
  return new Set((tool.schema.required as string[] | undefined) ?? []);
}

function functionName(tool: ManifestEntry): string {
  return tool.name.slice(tool.module.length + 1);
}

/** `{}` or an array / union of `{}` — no type information. */
function isOpaque(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  const typed = Object.keys(record).filter(
    (k) => k !== "description" && k !== "default"
  );
  if (typed.length === 0) return true;
  if (record.type === "array") return isOpaque(record.items ?? {});
  if (Array.isArray(record.anyOf)) {
    return (record.anyOf as unknown[]).some(isOpaque);
  }
  return false;
}

function isNullOnly(schema: JsonSchema | undefined): boolean {
  return schema?.type === "null";
}

/** The user params of a tool (context params stripped), paired with the checker. */
function userParams(checked: CheckedParam[]): CheckedParam[] {
  return checked.filter((p) => !p.isContext);
}

/**
 * The single param whose fields are the schema's top-level properties, when
 * the tool publishes one flattened; null otherwise.
 */
function flattenedParam(
  tool: ManifestEntry,
  params: CheckedParam[]
): CheckedParam | null {
  if (params.length !== 1) return null;
  const [param] = params;
  if (param.genericQueryFilters) return null;
  const properties = propertiesOf(tool);
  const keys = Object.keys(properties).filter((k) => k !== "_operation");
  if (keys.length === 1 && keys[0] === param.name) return null;
  return param;
}

export function findInputSchemaViolations(
  tools: ManifestEntry[],
  index: ParamSchemaIndex
): string[] {
  const violations: string[] = [];
  const fail = (tool: ManifestEntry, message: string) =>
    violations.push(`${tool.name}: ${message}`);

  for (const tool of tools) {
    const properties = propertiesOf(tool);
    const required = requiredOf(tool);

    for (const name of required) {
      if (isNullOnly(properties[name])) {
        fail(tool, `"${name}" is required but only accepts null`);
      }
    }

    const checked = index.get(tool.module, functionName(tool));
    if (!checked) continue;
    const params = userParams(checked);
    const listParam = params.find((p) => p.genericQueryFilters);

    if (listParam) {
      const gqf = listParam.genericQueryFilters!;
      const siblings = new Set(
        params.filter((p) => p !== listParam).map((p) => p.name)
      );
      if (listParam.name !== "args") {
        fail(tool, `GenericQueryFilters param must be named args`);
      }
      if ("args" in properties) {
        fail(tool, `GenericQueryFilters param is published nested under args`);
      }
      const contributed = [
        ...Object.keys(gqf.members),
        "limit",
        "offset",
        "filters",
        "sorts"
      ].filter((k) => !siblings.has(k));
      for (const key of contributed) {
        if (required.has(key)) {
          fail(tool, `GenericQueryFilters member "${key}" is required`);
        }
      }
      // A schema default is injected by input validation for every caller;
      // the list default belongs to the MCP layer alone (server.ts).
      for (const key of ["limit", "offset"] as const) {
        if (siblings.has(key)) continue;
        if (!(key in properties)) {
          fail(tool, `the schema omits ${key}`);
        } else if (properties[key] && "default" in properties[key]) {
          fail(
            tool,
            `${key} publishes a default; it would apply to every caller, not only MCP`
          );
        }
      }
      for (const key of ["filters", "sorts"] as const) {
        if (siblings.has(key)) continue;
        const honoured = gqf.usage[key];
        if (honoured && !(key in properties)) {
          fail(tool, `the service honours ${key} but the schema omits it`);
        }
        if (!honoured && key in properties) {
          fail(tool, `the schema publishes ${key} but the service ignores it`);
        }
      }
    }

    const flat = flattenedParam(tool, params);
    if (flat) {
      if (flat.optional && required.size > 0) {
        const fields = [...required].filter((r) => r !== "_operation");
        if (fields.length > 0) {
          fail(
            tool,
            `param "${flat.name}" is optional but fields ${fields.join(", ")} are required`
          );
        }
      }
      if (!flat.usesValidator && flat.fields) {
        for (const [name, field] of Object.entries(flat.fields)) {
          if (!(name in properties)) continue;
          if (field.optional && required.has(name)) {
            fail(tool, `field "${name}" is optional in TypeScript but required`);
          }
        }
      }
      for (const [name, schema] of Object.entries(properties)) {
        const field = flat.fields?.[name];
        if (field && !field.opaque && isOpaque(schema) && !isOpaque(field.schema)) {
          fail(tool, `field "${name}" publishes {} for a typed field`);
        }
      }
      continue;
    }

    for (const param of params) {
      if (param.genericQueryFilters) continue;
      const schema = properties[param.name];
      if (!schema) continue;
      if (param.optional && required.has(param.name)) {
        fail(tool, `param "${param.name}" is optional in TypeScript but required`);
      }
      if (!param.opaque && isOpaque(schema) && !isOpaque(param.schema)) {
        fail(tool, `param "${param.name}" publishes {} for a typed param`);
      }
      if (param.fields && !param.usesValidator && schema.type === "object") {
        const nested = (schema.properties ?? {}) as Properties;
        const nestedRequired = new Set(
          (schema.required as string[] | undefined) ?? []
        );
        for (const [name, field] of Object.entries(param.fields)) {
          if (name in nested && field.optional && nestedRequired.has(name)) {
            fail(
              tool,
              `field "${param.name}.${name}" is optional in TypeScript but required`
            );
          }
        }
      }
    }
  }

  return violations;
}

/** The type skeleton of a schema: its `type`s, recursively through items/anyOf. */
function skeleton(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "?";
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.anyOf)) {
    return `anyOf(${(record.anyOf as unknown[]).map(skeleton).sort().join("|")})`;
  }
  const type = Array.isArray(record.type)
    ? [...(record.type as string[])].sort().join("|")
    : String(record.type ?? "any");
  if (record.type === "array") return `${type}<${skeleton(record.items)}>`;
  if (record.enum) return `${type}{enum}`;
  return type;
}

/**
 * Where the published schema of a top-level, non-validator param still differs
 * in type from the checker's — the textual parser's remaining disagreements.
 * Not violations: the textual schema stands where it resolved (to keep the
 * digest reviewable), and this list is what a full switch to the checker would
 * change. `integer` vs `number` is not a disagreement.
 */
export function findCheckerDisagreements(
  tools: ManifestEntry[],
  index: ParamSchemaIndex
): string[] {
  const lines: string[] = [];
  for (const tool of tools) {
    const checked = index.get(tool.module, functionName(tool));
    if (!checked) continue;
    const params = userParams(checked);
    if (flattenedParam(tool, params)) continue;
    const properties = propertiesOf(tool);
    for (const param of params) {
      if (param.genericQueryFilters || param.usesValidator || param.opaque) {
        continue;
      }
      const published = properties[param.name];
      if (!published) continue;
      const a = skeleton(published).replace(/integer/g, "number");
      const b = skeleton(param.schema).replace(/integer/g, "number");
      if (a !== b) lines.push(`${tool.name}.${param.name}: ${a} -> ${b}`);
    }
  }
  return lines.sort();
}
