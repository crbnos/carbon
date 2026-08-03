import type { ConditionPath, WorkflowNode } from "@carbon/workflows";
import {
  DEFAULT_HANDLE,
  FAILURE_HANDLE,
  getNodeHandles,
  SUCCESS_HANDLE
} from "@carbon/workflows";
import type { PortTone } from "./NodeCard";

/** `card` handles float on the card's right edge; `inline` ones are drawn by the form. */
export type PortAnchorKind = "card" | "inline";

export type BuilderPort = {
  id: string;
  label: string;
  tone: PortTone;
  anchor: PortAnchorKind;
};

/** The `t` from `useLingui()`, passed in so this module stays callable outside React. */
type Translate = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => string;

const TONE: Record<string, PortTone> = {
  [SUCCESS_HANDLE]: "success",
  [FAILURE_HANDLE]: "failure"
};

function staticLabel(handle: string, t: Translate): string {
  if (handle === DEFAULT_HANDLE) return t`Next`;
  if (handle === SUCCESS_HANDLE) return t`Success`;
  if (handle === FAILURE_HANDLE) return t`Failure`;
  return handle;
}

/** The pill in `ConditionForm` and the port tooltip both read this, so they cannot disagree. */
export function conditionPathLabel(
  paths: ConditionPath[],
  pathId: string,
  t: Translate
): string {
  const path = paths.find((candidate) => candidate.id === pathId);
  if (!path) return pathId;
  if (path.kind === "else") return t`Otherwise`;
  if (path.kind === "if") return t`If`;
  const position = conditionPathIndex(paths, pathId);
  return t`Else if ${position}`;
}

/** Position among the non-else paths. Zero-based, matching the port order. */
export function conditionPathIndex(
  paths: ConditionPath[],
  pathId: string
): number {
  return paths
    .filter((p) => p.kind !== "else")
    .findIndex((p) => p.id === pathId);
}

/** The one place a handle gets a label, a tone and a place to render. Ids come from
 * `getNodeHandles` — the validator's own function — so a port can never be UNKNOWN_HANDLE. */
export function portsFor(node: WorkflowNode, t: Translate): BuilderPort[] {
  return getNodeHandles(node).map((handle) => {
    if (node.type === "condition") {
      return {
        id: handle,
        label: conditionPathLabel(node.data.paths, handle, t),
        tone: "default" as PortTone,
        anchor: "inline" as PortAnchorKind
      };
    }
    return {
      id: handle,
      label: staticLabel(handle, t),
      tone: TONE[handle] ?? "default",
      anchor: "card" as PortAnchorKind
    };
  });
}
