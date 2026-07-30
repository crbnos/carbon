/**
 * generate-workflow-catalog — build the workflow event catalog from its two
 * hand-written inputs plus the database's own schema.
 *
 * Inputs (edit these):
 *   packages/workflows/src/catalog/entities.ts   — one entry per record type
 *   packages/workflows/src/catalog/moments.ts    — business events a row change can't express
 *
 * Outputs (committed, never hand-edited):
 *   packages/workflows/src/catalog/events.generated.ts  — ids, outputs, permission, match
 *   packages/workflows/src/catalog/labels.generated.ts  — one msg`` descriptor per id
 *
 * The output is committed so that renaming a column shows up in a pull request
 * as a DELETED event id — the signal that a live customer workflow is about to
 * break. Labels live in their own file because `msg` is a build-time macro:
 * anything importing it from plain Node (the matcher, any vitest run) throws.
 *
 * Emission is deliberately unformatted — the `generate:workflow-catalog` script
 * pipes both files through `biome check --write`, so hand-indenting here would
 * only be overwritten.
 *
 * Run:  pnpm run generate:workflow-catalog
 */
import fs from "node:fs";
import path from "node:path";
import schema from "../packages/database/src/swagger-docs-schema";
import { buildCatalog } from "../packages/workflows/src/catalog/build";
import { WORKFLOW_ENTITY_REGISTRY } from "../packages/workflows/src/catalog/entities";
import { WORKFLOW_MOMENTS } from "../packages/workflows/src/catalog/moments";

// Run from repo root via `pnpm run generate:workflow-catalog`.
const CATALOG_DIR = path.join(
  process.cwd(),
  "packages/workflows/src/catalog"
);

const HEADER =
  "// GENERATED FILE — do not edit. Run `pnpm run generate:workflow-catalog`.\n";

/** Sorted keys keep the committed diff stable across runs. */
function sorted<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1))
  );
}

const built = buildCatalog(WORKFLOW_ENTITY_REGISTRY, WORKFLOW_MOMENTS, schema);

const events = [
  HEADER,
  `import type { BuiltEvent } from "./build";`,
  `import type { ValueType } from "../definition/types";`,
  ``,
  `export type { BuiltEvent as GeneratedEvent };`,
  ``,
  `export const WORKFLOW_EVENTS: Record<string, BuiltEvent> = ${JSON.stringify(sorted(built.events))};`,
  ``,
  `export const WORKFLOW_ENTITIES: Record<string, Record<string, ValueType>> = ${JSON.stringify(sorted(built.entities))};`,
  ``
].join("\n");

const labels = [
  HEADER,
  `import type { MessageDescriptor } from "@lingui/core";`,
  `import { msg } from "@lingui/core/macro";`,
  ``,
  `export const WORKFLOW_EVENT_LABELS: Record<string, MessageDescriptor> = {`,
  // A literal template per id, so Lingui's extractor sees each message.
  Object.entries(sorted(built.labels))
    .map(([id, label]) => `  ${JSON.stringify(id)}: msg\`${label}\``)
    .join(",\n"),
  `};`,
  ``
].join("\n");

fs.writeFileSync(path.join(CATALOG_DIR, "events.generated.ts"), events);
fs.writeFileSync(path.join(CATALOG_DIR, "labels.generated.ts"), labels);

console.log(
  `generate-workflow-catalog: ${Object.keys(built.events).length} events, ${
    Object.keys(built.entities).length
  } entities`
);
