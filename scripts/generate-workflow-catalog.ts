/**
 * Builds events.generated.ts, actions.generated.ts, labels.generated.ts and
 * help.generated.ts from entities.ts, moments.ts, actions.ts, operations.ts and
 * the database swagger schema. Run: pnpm run generate:workflow-catalog
 *
 * Labels are a separate file because `msg` is a build-time macro that throws when
 * plain Node imports it. Emitted source is unformatted; the script pipes it
 * through `biome check --write`.
 */
import fs from "node:fs";
import path from "node:path";
import schema from "../packages/database/src/swagger-docs-schema";
import { WORKFLOW_ACTIONS } from "../packages/workflows/src/catalog/actions";
import { buildCatalog } from "../packages/workflows/src/catalog/build";
import { WORKFLOW_ENTITY_REGISTRY } from "../packages/workflows/src/catalog/entities";
import { WORKFLOW_MOMENTS } from "../packages/workflows/src/catalog/moments";
import { WORKFLOW_OPERATIONS } from "../packages/workflows/src/catalog/operations";

// Resolved against the repo root; the script must be run from there.
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

const built = buildCatalog(
  WORKFLOW_ENTITY_REGISTRY,
  WORKFLOW_MOMENTS,
  WORKFLOW_ACTIONS,
  WORKFLOW_OPERATIONS,
  schema
);

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
  ``,
  `export const WORKFLOW_ENTITY_ENUMS: Record<string, Record<string, readonly string[]>> = ${JSON.stringify(sorted(built.enums))};`,
  ``
].join("\n");

const actions = [
  HEADER,
  `import type { BuiltAction, BuiltOperation } from "./build";`,
  ``,
  `export const WORKFLOW_ACTION_CATALOG: Record<string, BuiltAction> = ${JSON.stringify(sorted(built.actions))};`,
  ``,
  `export const WORKFLOW_OPERATION_CATALOG: Record<string, BuiltOperation> = ${JSON.stringify(sorted(built.operations))};`,
  ``
].join("\n");

const labels = [
  HEADER,
  `import type { MessageDescriptor } from "@lingui/core";`,
  `import { msg } from "@lingui/core/macro";`,
  ``,
  `export const WORKFLOW_LABELS: Record<string, MessageDescriptor> = {`,
  // A literal template per id, so Lingui's extractor sees each message.
  Object.entries(sorted(built.labels))
    .map(([id, label]) => `  ${JSON.stringify(id)}: msg\`${label}\``)
    .join(",\n"),
  `};`,
  ``
].join("\n");

// A plain object, not a macro file — so unlike labels this one is safe to import
// from plain Node, which check-workflow-catalog.ts relies on.
const help = [
  HEADER,
  `import type { TermId } from "@carbon/glossary";`,
  ``,
  `export const WORKFLOW_FIELD_HELP: Record<string, TermId> = ${JSON.stringify(sorted(built.help))};`,
  ``
].join("\n");

fs.writeFileSync(path.join(CATALOG_DIR, "events.generated.ts"), events);
fs.writeFileSync(path.join(CATALOG_DIR, "actions.generated.ts"), actions);
fs.writeFileSync(path.join(CATALOG_DIR, "labels.generated.ts"), labels);
fs.writeFileSync(path.join(CATALOG_DIR, "help.generated.ts"), help);

console.log(
  `generate-workflow-catalog: ${Object.keys(built.events).length} events, ${
    Object.keys(built.entities).length
  } entities, ${Object.keys(built.actions).length} actions, ${
    Object.keys(built.operations).length
  } operations, ${Object.keys(built.help).length} help terms`
);
