import type { WorkflowNode } from "@carbon/workflows";
import { useWorkflowLabel } from "../Builder/catalog";
import { nodeTitle } from "../Builder/labelKeys";
import { NODE_KIND_META } from "../Builder/nodes/meta";

export type NodeLabel = {
  /** The row's heading: the user's name for the step, else what it does. */
  title: string;
  /** What the step does, shown under the title. Empty when it repeats the title. */
  subtitle: string;
  /** The kind chip: Trigger / Record / Condition / Action / Find / Filter. */
  kind: string;
};

/** One place deciding how a step is named, so the step list, the outcome sentence
 * and any future surface cannot disagree. */
export function useNodeLabel(): (node: WorkflowNode) => NodeLabel {
  const label = useWorkflowLabel();

  return (node: WorkflowNode) => {
    const meta = NODE_KIND_META[node.type];
    const catalogId = meta.catalogId?.(node);
    const describes =
      (catalogId === undefined ? undefined : label(catalogId, catalogId)) ??
      meta.title?.(node) ??
      meta.summary?.(node) ??
      meta.defaultTitle;

    const title = nodeTitle(node.name, describes);

    return {
      title,
      subtitle: title === describes ? "" : describes,
      kind: meta.name
    };
  };
}
