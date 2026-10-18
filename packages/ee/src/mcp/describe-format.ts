// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Text formatting for describe_tool / search_tools output, extracted from the
// @ts-nocheck server.ts so it is typed and unit-testable. Schemas print as
// TypeScript types: the generator derives them from TS types and uses only
// type/enum/anyOf/properties/required/items/additionalProperties, so the type
// says everything the JSON Schema does in about a third of the characters.
import type { ManifestEntry } from "@carbon/api";
import { MCP_DEFAULT_LIMIT } from "./format-result";

/**
 * The description the generator derives from a bare tool name
 * ("sales_getCustomers" → "get customers"). A tool whose description equals
 * this carries no information beyond its name, so search output skips it.
 */
export function deriveNameDescription(name: string): string {
  const separator = name.indexOf("_");
  const func = separator === -1 ? name : name.slice(separator + 1);
  return func
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase();
}

/**
 * The description search_tools prints beside a tool: its first paragraph (the
 * summary; `describe_tool` has the rest), or null when that only restates the
 * name. 937 of 1,612 summaries do ("Get receipt." on `inventory_getReceipt`,
 * "Post a receipt." on `inventory_postReceipt`), so case, a closing full stop
 * and articles do not count as saying more.
 */
export function searchLineDescription(
  tool: Pick<ManifestEntry, "name" | "description">
): string | null {
  const summary = tool.description.split("\n", 1)[0]!.trim();
  const words = (text: string) =>
    text
      .toLowerCase()
      .replace(/[.!]+$/, "")
      .split(/\s+/)
      .filter((word) => word && !ARTICLES.has(word))
      .join(" ");
  return summary && words(summary) !== words(deriveNameDescription(tool.name))
    ? summary
    : null;
}

const ARTICLES = new Set(["a", "an", "the"]);

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: JsonSchema | boolean;
  description?: string;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Render a manifest JSON Schema as a TypeScript type:
 * `{ id: string; limit?: number; status?: "Draft" | "Posted" | null }`.
 * An empty schema reads `unknown`; an open object's extra keys are not shown.
 */
export function formatSchemaType(schema: unknown): string {
  return unionMembers(schema).join(" | ");
}

/** The top-level alternatives of a schema's type, deduplicated. */
function unionMembers(schema: unknown): string[] {
  const node = (schema ?? {}) as JsonSchema;
  if (node.enum) {
    return [...new Set(node.enum.map((value) => JSON.stringify(value)))];
  }
  if (node.anyOf) return [...new Set(node.anyOf.flatMap(unionMembers))];
  const types =
    node.type === undefined
      ? node.properties
        ? ["object"]
        : node.items
          ? ["array"]
          : []
      : Array.isArray(node.type)
        ? node.type
        : [node.type];
  if (types.length === 0) return ["unknown"];
  return [
    ...new Set(
      types.map((type) => {
        if (type === "integer") return "number";
        if (type === "array") {
          const item = unionMembers(node.items);
          return item.length > 1 ? `(${item.join(" | ")})[]` : `${item[0]}[]`;
        }
        if (type === "object") return formatObjectType(node);
        return type;
      })
    )
  ];
}

function formatObjectType(node: JsonSchema): string {
  const properties = Object.entries(node.properties ?? {});
  if (properties.length === 0) {
    const extra = node.additionalProperties;
    return extra && typeof extra === "object"
      ? `Record<string, ${formatSchemaType(extra)}>`
      : "object";
  }
  const required = new Set(node.required ?? []);
  const fields = properties.map(([key, value]) => {
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    const note = value.description ? ` /* ${value.description} */` : "";
    return `${name}${required.has(key) ? "" : "?"}: ${formatSchemaType(value)}${note}`;
  });
  return `{ ${fields.join("; ")} }`;
}

/**
 * The tool names closest to a name that does not exist, by edit distance, for
 * a "did you mean" answer. A typo ("getInventoryItem") is one or two edits from
 * the real name, which ranked search does not reward. Names further than a
 * third of the name's length away are not suggested.
 */
export function closestToolNames(
  name: string,
  names: Iterable<string>,
  limit = 3
): string[] {
  const target = name.toLowerCase();
  const maxDistance = Math.max(3, Math.floor(target.length / 3));
  return [...names]
    .map((candidate) => ({
      candidate,
      distance: editDistance(target, candidate.toLowerCase())
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** Levenshtein distance, one row at a time. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * search_tools output: one line per tool in rank order, then the next page's
 * offset when there is one. Grouping by module put a lower-ranked tool above
 * better ones, and the name already carries its module. Required params are
 * inline so a simple tool needs no describe round trip; the summary only when
 * it says more than the name.
 */
export function formatSearchResults(
  matches: ManifestEntry[],
  total: number,
  offset: number
): string {
  const next = offset + matches.length;
  let output = `Found ${total} ${total === 1 ? "tool" : "tools"}, ranked by relevance`;
  if (next < total || offset > 0) {
    output += ` (showing ${offset + 1}-${next}${next < total ? `; next page: offset ${next}` : ""})`;
  }
  output += ":";
  for (const tool of matches) {
    const summary = searchLineDescription(tool);
    output += `\n${tool.name} [${tool.classification}] ${formatParamSummary(tool)}${summary ? ` — ${summary}` : ""}`;
  }
  return output;
}

/**
 * One-line argument summary for search results: required params spelled out,
 * optionals as a count — enough to call a simple tool without a describe round
 * trip. "(id)" / "(jobId, itemId, +12 optional)" / "()".
 */
export function formatParamSummary(tool: ManifestEntry): string {
  const schema = tool.schema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const properties = Object.keys(schema?.properties ?? {});
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((name) => properties.includes(name))
    : [];
  const optionalCount = properties.length - required.length;
  const parts = [...required];
  if (optionalCount > 0) parts.push(`+${optionalCount} optional`);
  return `(${parts.join(", ")})`;
}

/**
 * The DB-side paginating sibling of a fetchAll list read, when the catalog has
 * one — `getJobsList` → `getJobs`. Only returned when the sibling exists AND
 * actually pages, so the steer is never a guess.
 */
export function paginatingSibling(
  name: string,
  resolve: (
    name: string
  ) => Pick<ManifestEntry, "name" | "paginates"> | undefined
): string | null {
  if (!name.endsWith("List")) return null;
  const sibling = resolve(name.slice(0, -"List".length));
  return sibling?.paginates ? sibling.name : null;
}

/**
 * Full describe_tool text for one tool: the name and classification, the
 * description, the permission every caller needs, how a list pages, then the
 * input and response types. The name already carries the module.
 */
export function formatToolDescription(
  tool: ManifestEntry,
  options: { isList: boolean; sibling?: string | null }
): string {
  let output = `${tool.name} [${tool.classification}]\n`;
  output += `${tool.description}\n`;
  if (tool.permission.module) {
    const scopes = tool.permission.actions
      .map((action) => `${tool.permission.module}_${action}`)
      .join(" or ");
    output += `Permission: ${scopes}\n`;
  }
  if (options.isList) {
    if (tool.paginates) {
      output += `List operation: pages with limit/offset (default limit ${MCP_DEFAULT_LIMIT})\n`;
    } else {
      // Honest about the mechanics: the service reads the full set (it feeds
      // UI dropdowns); the MCP layer pages the response.
      output += `List operation: full-set read; the response is paged with limit/offset (default limit ${MCP_DEFAULT_LIMIT})`;
      if (options.sibling) {
        output += ` — for database-side paging use ${options.sibling}`;
      }
      output += "\n";
    }
  }
  output += `\nInput: ${formatSchemaType(tool.schema ?? {})}`;
  if (tool.responseSchema) {
    output += `\nReturns (null fields are omitted): ${formatSchemaType(
      tool.responseSchema
    )}`;
  }
  return output;
}
