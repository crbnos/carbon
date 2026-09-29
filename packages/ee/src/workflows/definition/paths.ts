import type { ConditionPath } from "./schema";

export type PathPosition =
  | { kind: "else" }
  | { kind: "indexed"; index: number };

/**
 * Positional identity for a condition path. Returns `{ kind: "else" }` for the
 * else path and `{ kind: "indexed", index }` for if/elseIf paths (in order),
 * so two elseIf paths never share a label. An unknown pathId returns index: -1.
 */
export function pathLabel(
  paths: ConditionPath[],
  pathId: string
): PathPosition {
  const path = paths.find((p) => p.id === pathId);
  if (!path) return { kind: "indexed", index: -1 };
  if (path.kind === "else") return { kind: "else" };
  const index = paths
    .filter((p) => p.kind !== "else")
    .findIndex((p) => p.id === pathId);
  return { kind: "indexed", index };
}
