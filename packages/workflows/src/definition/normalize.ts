import { z } from "zod";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";

/**
 * The stored row shape. `nodes` and `edges` are separate untyped JSON columns,
 * and `formatVersion` is its own column so it is queryable without opening them.
 */
const storedRowSchema = z.object({
  formatVersion: z.number().int().nullish(),
  nodes: z.unknown().optional(),
  edges: z.unknown().optional()
});

/** A stored document, still in whatever format it was written in. */
interface RawDefinition {
  formatVersion: number;
  nodes: unknown;
  edges: unknown;
}

/** A fresh empty canvas. A factory, so no caller can mutate a shared value. */
export function emptyDefinition(): WorkflowDefinition {
  return {
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION,
    nodes: [],
    edges: []
  };
}

export type WorkflowVersionReadFailure =
  /** Not a row shape we recognise at all. */
  | "unreadable"
  /** Written by a newer release than this one; upgrading is not our job. */
  | "future-format"
  /** The right shape, but the contents do not parse. */
  | "invalid";

export type WorkflowVersionRead =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; failure: WorkflowVersionReadFailure; message: string };

/**
 * Upgrade a stored document to the current format. Pass-through at v1, and the
 * single seam where a definition saved under an older format is brought forward,
 * so stored rows never need a backfill migration.
 *
 * This deliberately runs on the raw JSON, *before* the current-schema parse: a
 * document old enough to need upgrading is by definition not valid under the
 * current schema, so a migration placed after that parse could never run.
 */
function migrateDefinition(raw: RawDefinition, _from: number): RawDefinition {
  return raw;
}

export function parseWorkflowDefinition(value: unknown) {
  return workflowDefinitionSchema.safeParse(value);
}

/**
 * The one place raw database JSON becomes the typed model: assembles the two
 * columns into one document, upgrades it on read, then validates.
 *
 * Failure is reported rather than swallowed. An unreadable row used to come back
 * as an empty canvas, which meant the builder opened blank and the next save
 * quietly overwrote a definition nobody could see; the caller needs to be able
 * to say "this version could not be read" and refuse to save over it.
 */
export function readWorkflowVersion(row: unknown): WorkflowVersionRead {
  // Nothing stored yet is not a failure — it is a new version's blank canvas.
  if (row === null || row === undefined) {
    return { ok: true, definition: emptyDefinition() };
  }

  const stored = storedRowSchema.safeParse(row);
  if (!stored.success) {
    return {
      ok: false,
      failure: "unreadable",
      message: "This workflow version could not be read."
    };
  }

  // A missing version means the row predates the column, so it is v1 — not
  // whatever the current version happens to be, which would skip its migration.
  const from = stored.data.formatVersion ?? 1;
  if (from > CURRENT_DEFINITION_FORMAT_VERSION) {
    return {
      ok: false,
      failure: "future-format",
      message:
        "This workflow version was saved by a newer release of Carbon and cannot be opened here."
    };
  }

  const migrated = migrateDefinition(
    {
      formatVersion: from,
      nodes: stored.data.nodes ?? [],
      edges: stored.data.edges ?? []
    },
    from
  );

  const parsed = parseWorkflowDefinition({
    ...migrated,
    formatVersion: CURRENT_DEFINITION_FORMAT_VERSION
  });
  if (!parsed.success) {
    return {
      ok: false,
      failure: "invalid",
      message: "This workflow version could not be read."
    };
  }

  return { ok: true, definition: parsed.data };
}
