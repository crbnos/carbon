import { z } from "zod";
import { nextNodeName, slugifyNodeName, uniqueNodeName } from "./names";
import {
  CURRENT_DEFINITION_FORMAT_VERSION,
  type WorkflowDefinition,
  workflowDefinitionSchema
} from "./schema";

/** The stored row: `nodes` and `edges` are separate untyped JSON columns. */
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

/** A factory, so no caller can mutate a shared value. */
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
 * Upgrade a stored document to the current format. Runs on raw JSON before the
 * current-schema parse, which an old document would fail.
 */
function migrateDefinition(raw: RawDefinition, from: number): RawDefinition {
  let current = raw;
  // v1 → v2: a lookup's match rules changed shape. No v1 lookup could be
  // activated, so dropping the old rules discards nothing a customer relied on.
  // A non-array is left alone so the parse still reports it rather than repairing it.
  if (from < 2 && Array.isArray(current.nodes)) {
    current = {
      ...current,
      formatVersion: 2,
      nodes: current.nodes.map((node) => {
        if (
          typeof node !== "object" ||
          node === null ||
          (node as { type?: unknown }).type !== "lookup"
        ) {
          return node;
        }
        const lookup = node as { data?: Record<string, unknown> };
        return { ...lookup, data: { ...lookup.data, match: [] } };
      })
    };
  }
  // v2 → v3: `title` (an optional caption) became `name` (a required, unique
  // identifier shown in the variable picker). Iteration order is the array order,
  // so the same stored row always migrates to the same names.
  if (from < 3 && Array.isArray(current.nodes)) {
    const taken = new Set<string>();
    current = {
      ...current,
      formatVersion: 3,
      nodes: current.nodes.map((node) => {
        if (typeof node !== "object" || node === null) return node;
        const n = node as { type?: unknown; title?: unknown };
        const type = typeof n.type === "string" ? n.type : "node";
        const fromTitle =
          typeof n.title === "string" ? slugifyNodeName(n.title) : "";
        const desired =
          fromTitle === "" ? nextNodeName(type, taken) : fromTitle;
        const name = uniqueNodeName(desired, taken);
        taken.add(name);
        const { title: _title, ...rest } = n as Record<string, unknown>;
        return { ...rest, name };
      })
    };
  }
  return current;
}

export function parseWorkflowDefinition(value: unknown) {
  return workflowDefinitionSchema.safeParse(value);
}

/**
 * The one place raw database JSON becomes the typed model. Failure is reported,
 * not swallowed, so a caller never saves a blank canvas over an unreadable row.
 */
export function readWorkflowVersion(row: unknown): WorkflowVersionRead {
  // Nothing stored yet is a new version's blank canvas, not a failure.
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

  // A missing version means the row predates the column, so it is v1; defaulting
  // to the current version would skip its migration.
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
