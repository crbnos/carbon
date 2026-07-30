/**
 * check-workflow-catalog — the guarantees that keep the workflow event catalog honest.
 *
 * A dead trigger is worse than a missing one: a customer builds a rule on "a job is
 * released", and if nothing in the code ever raises it, the rule silently never fires.
 * A renamed column is the same failure with a longer fuse. Both must break the build.
 *
 * Checks:
 *   1. Every declared moment has at least one raise site.
 *   2. Every raise site names a declared moment (the type system covers this too).
 *   3. The registry still agrees with the database schema — delegated to
 *      `validateCatalogInputs`, which is typechecked and unit-tested, unlike this
 *      script (`scripts/` is in no tsconfig).
 *   4. The committed catalog is what the generator would produce right now.
 *
 * Run:  pnpm run check:workflow-catalog
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

// Checks 1 and 2 — the raise sites. `git grep` searches the index, so build
// output and dependencies are excluded by definition rather than by a skip-list.
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

// Check 3 — every registry table and watched column still exists, every ref agrees
// with the schema, every moment is well-formed. Reports all problems, not the first.
for (const problem of validateCatalogInputs(
  WORKFLOW_ENTITY_REGISTRY,
  WORKFLOW_MOMENTS,
  schema
)) {
  fail(problem);
}

// Check 4 — the committed catalog matches a fresh build. Compares data, not file
// text, so formatting can never make this flap.
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

  // Read the label file as text: it holds an untransformed `msg` macro, which
  // throws if plain Node imports it. That split is deliberate.
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
