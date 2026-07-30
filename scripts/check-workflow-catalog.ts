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
import { buildCatalog, validateCatalogInputs } from "../packages/workflows/src/catalog/build";
import { WORKFLOW_ENTITY_REGISTRY } from "../packages/workflows/src/catalog/entities";
import {
  WORKFLOW_ENTITIES,
  WORKFLOW_EVENTS
} from "../packages/workflows/src/catalog/events.generated";
import { WORKFLOW_MOMENTS } from "../packages/workflows/src/catalog/moments";

const ROOT = process.cwd();
const LABELS_FILE = path.join(
  ROOT,
  "packages/workflows/src/catalog/labels.generated.ts"
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

for (const problem of validateCatalogInputs(
  WORKFLOW_ENTITY_REGISTRY,
  WORKFLOW_MOMENTS,
  schema
)) {
  fail(problem);
}

// Compares data, not file text, so formatting can never make this flap.
if (failures.length === 0) {
  const rebuilt = buildCatalog(WORKFLOW_ENTITY_REGISTRY, WORKFLOW_MOMENTS, schema);
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

  // Read as text, not imported: the untransformed `msg` macro throws in plain Node.
  const labelSource = fs.readFileSync(LABELS_FILE, "utf8");
  const labelIds = new Set(
    [...labelSource.matchAll(/^ {2}"([^"]+)":\s*msg`/gm)].map((m) => m[1])
  );
  for (const id of Object.keys(rebuilt.labels)) {
    if (!labelIds.has(id)) fail(`${stale} Event "${id}" has no label.`);
  }
  for (const id of labelIds) {
    if (id !== undefined && !(id in rebuilt.labels)) {
      fail(`${stale} Label "${id}" no longer matches an event.`);
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
  } moments raised, ${Object.keys(WORKFLOW_ENTITIES).length} entities`
);
