import type { ItemRef, VariableRef } from "@carbon/workflows";
import { nodeNameLabel, outputLabel } from "../labelKeys";

/** The two template parts that are not plain text. */
export type RefPart = VariableRef | ItemRef;

// The editor can only carry a string per token, so the ref is encoded into one.
// It stays structured — a ref binds to `nodeId`, and the visible label is only a
// rendering of it, so renaming a step must never touch what is stored.

export function encodeTokenId(ref: RefPart): string {
  return JSON.stringify(
    ref.kind === "item"
      ? { kind: "item", path: ref.path }
      : {
          kind: "ref",
          nodeId: ref.nodeId,
          output: ref.output,
          path: ref.path
        }
  );
}

export function decodeTokenId(id: string): RefPart | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(id);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const candidate = parsed as Record<string, unknown>;
  const path = candidate.path;
  if (!Array.isArray(path) || path.some((p) => typeof p !== "string")) {
    return undefined;
  }

  if (candidate.kind === "item") {
    return { kind: "item", path: path as string[] };
  }
  if (
    candidate.kind === "ref" &&
    typeof candidate.nodeId === "string" &&
    typeof candidate.output === "string"
  ) {
    return {
      kind: "ref",
      nodeId: candidate.nodeId,
      output: candidate.output,
      path: path as string[]
    };
  }
  return undefined;
}

/** Path segments as the customer sees them. Only the segments the map names are replaced,
 * so a shipped column keeps reading as itself. */
export function namedPath(
  path: string[],
  segmentLabels?: Record<string, string>
): string[] {
  if (segmentLabels === undefined) return path;
  return path.map((segment) => segmentLabels[segment] ?? segment);
}

/** `Step › output › property` — display only, so it follows a rename. `pathLabels` names
 * the path segments as the customer sees them; the raw column names are the fallback. */
export function refLabel(
  ref: RefPart,
  nodeName?: string,
  pathLabels?: string[]
): string {
  const path = pathLabels ?? ref.path;
  if (ref.kind === "item") return ["Current item", ...path].join(" › ");
  // Only a real name is titled; the id fallback is not a slug.
  const step = nodeName === undefined ? ref.nodeId : nodeNameLabel(nodeName);
  return [step, outputLabel(ref.output), ...path].join(" › ");
}

/** Just the last segment — what a chip shows when the full path will not fit. `refLabel`
 * stays the tooltip and the search text, so this is a short form, not a second source. */
export function refLeafLabel(ref: RefPart, pathLabels?: string[]): string {
  const path = pathLabels ?? ref.path;
  const last = path[path.length - 1];
  if (last !== undefined) return last;
  return ref.kind === "item" ? "Current item" : outputLabel(ref.output);
}

/** The leaf of an already-rendered `refLabel` string. */
export const leafOfLabel = (label: string) => label.split(" › ").pop() ?? label;
