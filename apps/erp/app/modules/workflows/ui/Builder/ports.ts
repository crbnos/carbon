import type { ConditionPath, WorkflowNode } from "@carbon/workflows";
import {
  DEFAULT_HANDLE,
  FAILURE_HANDLE,
  getNodeHandles,
  SUCCESS_HANDLE
} from "@carbon/workflows";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { PortTone } from "./handles";

/** `card` handles float on the card's right edge; `inline` ones are drawn by the form. */
export type PortAnchorKind = "card" | "inline";

export type BuilderPort = {
  id: string;
  label: string;
  tone: PortTone;
  anchor: PortAnchorKind;
};

/** `useLingui()`'s `t`. Descriptors, not tagged templates: the macro only rewrites
 * `` t`…` `` inside a component, so a `t` passed here would return an empty string. */
type Translate = (descriptor: MessageDescriptor) => string;

const TONE: Record<string, PortTone> = {
  [SUCCESS_HANDLE]: "success",
  [FAILURE_HANDLE]: "failure"
};

function staticLabel(handle: string, t: Translate): string {
  if (handle === DEFAULT_HANDLE) return t(msg`Next`);
  if (handle === SUCCESS_HANDLE) return t(msg`Success`);
  if (handle === FAILURE_HANDLE) return t(msg`Failure`);
  return handle;
}

/** Names a path the way the user wrote it. Both the pill in `ConditionForm` and the
 * handle beside it use this — a visible handle label must not contradict the pill. */
export function conditionPathLabel(
  paths: ConditionPath[],
  pathId: string,
  t: Translate
): string {
  const path = paths.find((candidate) => candidate.id === pathId);
  if (!path) return pathId;
  if (path.kind === "else") return t(msg`Otherwise`);
  if (path.kind === "if") return t(msg`If`);
  const position = conditionPathIndex(paths, pathId);
  return t(msg`Else if ${position}`);
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
