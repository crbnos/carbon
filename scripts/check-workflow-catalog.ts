/**
 * Fails the build when a declared moment has no raise site, a raise site names an
 * undeclared moment, the registry disagrees with the database schema, or the
 * committed catalog is stale. Run: pnpm run check:workflow-catalog
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import schema from "../packages/database/src/swagger-docs-schema";
import { WORKFLOW_ACTIONS } from "../packages/workflows/src/catalog/actions";
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_OPERATION_CATALOG
} from "../packages/workflows/src/catalog/actions.generated";
import { buildCatalog, validateCatalogInputs } from "../packages/workflows/src/catalog/build";
import { WORKFLOW_ENTITY_REGISTRY } from "../packages/workflows/src/catalog/entities";
import {
  WORKFLOW_ENTITIES,
  WORKFLOW_EVENTS
} from "../packages/workflows/src/catalog/events.generated";
// Direct import, unlike labels: this file has no `msg` macro, so plain Node can read it.
import { WORKFLOW_FIELD_HELP } from "../packages/workflows/src/catalog/help.generated";
import { WORKFLOW_MOMENTS } from "../packages/workflows/src/catalog/moments";
import { WORKFLOW_OPERATIONS } from "../packages/workflows/src/catalog/operations";

const ROOT = process.cwd();
const LABELS_FILE = path.join(
  ROOT,
  "packages/workflows/src/catalog/labels.generated.ts"
);
const TOOL_METADATA_FILE = path.join(
  ROOT,
  "apps/erp/app/routes/api+/mcp+/lib/tool-metadata.json"
);

const failures: string[] = [];
const fail = (message: string) => failures.push(message);

// `git grep` searches the index, so build output and dependencies are excluded
// without a skip-list.
const raised = new Map<string, string[]>();
const grep = execFileSync(
  "git",
  [
    "grep",
    "-hoE",
    String.raw`raiseMoment\(\s*"[^"]+"`,
    "--",
    "apps/**/*.ts",
    "apps/**/*.tsx",
    "packages/**/*.ts",
    "packages/**/*.tsx",
    ":!**/*.test.ts",
    ":!**/*.test.tsx"
  ],
  { cwd: ROOT, encoding: "utf8" }
);

for (const line of grep.split("\n")) {
  const key = /raiseMoment\(\s*"([^"]+)"/.exec(line)?.[1];
  if (key === undefined) continue;
  raised.set(key, [...(raised.get(key) ?? []), line]);
}

for (const key of Object.keys(WORKFLOW_MOMENTS)) {
  if (!raised.has(key)) {
    fail(
      `Moment "${key}" is declared but never raised. A customer could subscribe to a trigger that can never fire — add a raiseMoment("${key}", …) call at the place that performs the action, or remove the declaration.`
    );
  }
}

for (const key of raised.keys()) {
  if (!(key in WORKFLOW_MOMENTS)) {
    fail(
      `raiseMoment("${key}") names a moment that is not declared in packages/workflows/src/catalog/moments.ts.`
    );
  }
}

// A `buildCatalog` throw reads as a stack trace, so the same problems are
// collected here first and reported in plain English.
for (const problem of validateCatalogInputs(
  WORKFLOW_ENTITY_REGISTRY,
  WORKFLOW_MOMENTS,
  WORKFLOW_ACTIONS,
  WORKFLOW_OPERATIONS,
  schema
)) {
  fail(problem);
}

type ToolMeta = {
  name: string;
  injectAuth?: string[];
  schema?: { required?: string[]; properties?: Record<string, unknown> };
};

const tools = new Map<string, ToolMeta>(
  (
    JSON.parse(fs.readFileSync(TOOL_METADATA_FILE, "utf8")) as {
      tools: ToolMeta[];
    }
  ).tools.map((tool) => [tool.name, tool])
);

/** A nested `{ input: {...} }` schema describes the wrapper, not the fields the
 * action supplies; unwrap so the required list is comparable. */
function requiredParamsOf(tool: ToolMeta): string[] {
  const outer = tool.schema;
  const inner = outer?.properties?.input as ToolMeta["schema"] | undefined;
  return (inner?.required ?? outer?.required ?? []) as string[];
}

for (const [id, declaration] of Object.entries(WORKFLOW_ACTIONS)) {
  const call = (declaration as { call?: string }).call;
  if (call === undefined) continue;
  const tool = tools.get(call);
  if (tool === undefined) {
    fail(
      `Action "${id}" calls "${call}", which is not a tool in tool-metadata.json. Run pnpm run generate:mcp.`
    );
    continue;
  }

  // Only inputs the builder forces are guaranteed to arrive, plus what the dispatcher
  // stamps. Counting optional ones would repeat the shape of the bug this exists to catch.
  const inputs = (declaration as { inputs: Record<string, { required: boolean }> })
    .inputs;
  const supplied = new Set([
    ...Object.entries(inputs)
      .filter(([, spec]) => spec.required)
      .map(([name]) => name),
    ...(tool.injectAuth ?? [])
  ]);
  const missing = requiredParamsOf(tool).filter((p) => !supplied.has(p));
  if (missing.length > 0) {
    fail(
      `Action "${id}" calls "${call}", which requires ${missing
        .map((p) => `"${p}"`)
        .join(", ")} — not declared as an input and not injected.`
    );
  }
}

// Compares data, not file text, so formatting can never make this flap.
if (failures.length === 0) {
  const rebuilt = buildCatalog(
    WORKFLOW_ENTITY_REGISTRY,
    WORKFLOW_MOMENTS,
    WORKFLOW_ACTIONS,
    WORKFLOW_OPERATIONS,
    schema
  );
  const stale =
    "The committed catalog is out of date. Run `pnpm run generate:workflow-catalog` and commit the result.";

  try {
    assert.deepStrictEqual(WORKFLOW_EVENTS, rebuilt.events);
  } catch {
    const committed = new Set(Object.keys(WORKFLOW_EVENTS));
    const fresh = new Set(Object.keys(rebuilt.events));
    const missing = [...fresh].filter((id) => !committed.has(id));
    const extra = [...committed].filter((id) => !fresh.has(id));
    fail(
      `${stale}${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}${
        extra.length ? ` No longer generated: ${extra.join(", ")}.` : ""
      }${!missing.length && !extra.length ? " An event's outputs, permission or match changed." : ""}`
    );
  }

  try {
    assert.deepStrictEqual(WORKFLOW_ENTITIES, rebuilt.entities);
  } catch {
    fail(`${stale} An entity's generated properties changed.`);
  }

  try {
    assert.deepStrictEqual(WORKFLOW_ACTION_CATALOG, rebuilt.actions);
  } catch {
    const committed = new Set(Object.keys(WORKFLOW_ACTION_CATALOG));
    const fresh = new Set(Object.keys(rebuilt.actions));
    const missing = [...fresh].filter((id) => !committed.has(id));
    const extra = [...committed].filter((id) => !fresh.has(id));
    fail(
      `${stale}${missing.length ? ` Missing action: ${missing.join(", ")}.` : ""}${
        extra.length ? ` No longer generated: ${extra.join(", ")}.` : ""
      }${!missing.length && !extra.length ? " An action's inputs, outputs or permission changed." : ""}`
    );
  }

  try {
    assert.deepStrictEqual(WORKFLOW_OPERATION_CATALOG, rebuilt.operations);
  } catch {
    fail(`${stale} An operation's entity, inputs or output changed.`);
  }

  try {
    assert.deepStrictEqual(WORKFLOW_FIELD_HELP, rebuilt.help);
  } catch {
    fail(`${stale} A field's glossary help term changed.`);
  }

  // Read as text, not imported: the untransformed `msg` macro throws in plain Node.
  const labelSource = fs.readFileSync(LABELS_FILE, "utf8");
  // Biome drops the quotes around a key that is a valid identifier.
  const labelIds = new Set(
    [...labelSource.matchAll(/^ {2}"?([^":\s]+)"?:\s*msg`/gm)].map((m) => m[1])
  );
  for (const id of Object.keys(rebuilt.labels)) {
    if (!labelIds.has(id)) fail(`${stale} "${id}" has no label.`);
  }
  for (const id of labelIds) {
    if (id !== undefined && !(id in rebuilt.labels)) {
      fail(
        `${stale} Label "${id}" no longer matches an event, action or operation.`
      );
    }
  }

  // Check every entity and property has a label.
  for (const [entityName, properties] of Object.entries(rebuilt.entities)) {
    if (!rebuilt.labels[`entity.${entityName}`]) {
      fail(`${entityName} has no label. Run pnpm run generate:workflow-catalog.`);
    }
    for (const [column] of Object.entries(properties)) {
      if (!rebuilt.labels[`entity.${entityName}.${column}`]) {
        fail(`${entityName}.${column} has no label. Run pnpm run generate:workflow-catalog.`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("check-workflow-catalog FAILED\n");
  for (const message of failures) console.error(`  • ${message}\n`);
  process.exit(1);
}

console.log(
  `check-workflow-catalog: ok — ${Object.keys(WORKFLOW_EVENTS).length} events, ${
    Object.keys(WORKFLOW_MOMENTS).length
  } moments raised, ${Object.keys(WORKFLOW_ENTITIES).length} entities, ${
    Object.keys(WORKFLOW_ACTION_CATALOG).length
  } actions, ${Object.keys(WORKFLOW_OPERATION_CATALOG).length} operations`
);
