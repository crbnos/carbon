import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";
import { getNodeHandles } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { Trans, useLingui } from "@lingui/react/macro";
import type { NodeProps } from "@xyflow/react";
import { useStore } from "@xyflow/react";
import { memo } from "react";
import { LOD_ZOOM } from "../constants";
import { useBuilderStore } from "../context";
import { asWorkflowNode } from "../graph";
import type { NodePort } from "../NodeCard";
import { NodeCard } from "../NodeCard";
import { NODE_KIND_META } from "./meta";

const PORT_LABEL: Record<string, string> = {
  out: "next",
  success: "worked",
  failure: "failed"
};

const PATH_LABEL: Record<string, string> = {
  if: "If",
  elseIf: "Else if",
  else: "Otherwise"
};

// Handles come from `getNodeHandles` — the same function the validator uses — so
// the canvas cannot draw a port the validator would reject as UNKNOWN_HANDLE.
function portsFor(node: WorkflowNode): NodePort[] {
  return getNodeHandles(node).map((handle) => {
    if (node.type === "condition") {
      const path = node.data.paths.find((candidate) => candidate.id === handle);
      return { id: handle, label: path ? PATH_LABEL[path.kind] : handle };
    }
    return { id: handle, label: PORT_LABEL[handle] ?? handle };
  });
}

// Every node kind renders through this one component; what differs between kinds
// is data in `NODE_KIND_META`, not code. The body is still a placeholder slot.
function WorkflowNodeCardImpl({ id, type, data, selected }: NodeProps) {
  const { i18n } = useLingui();
  const node = asWorkflowNode(id, type as WorkflowNodeType, data);
  const meta = NODE_KIND_META[node.type];

  const isCollapsed = useStore((state) => state.transform[2] < LOD_ZOOM);
  const issueCount = useBuilderStore(
    (state) => state.issues.filter((issue) => issue.nodeId === id).length
  );

  const catalogId = meta.catalogId?.(node);
  const label = catalogId
    ? (WORKFLOW_LABELS[catalogId] && i18n._(WORKFLOW_LABELS[catalogId])) ||
      catalogId
    : undefined;

  return (
    <NodeCard
      kind={meta.name}
      title={label ?? meta.title?.(node) ?? meta.defaultTitle}
      description={meta.description}
      summary={label ?? meta.summary?.(node)}
      accent={meta.accent}
      icon={<meta.Icon className="size-3.5" />}
      ports={portsFor(node)}
      hasTarget={meta.hasTarget}
      issueCount={issueCount}
      isSelected={!!selected}
      isCollapsed={isCollapsed}
    >
      <p className="text-[10.5px] italic text-muted-foreground">
        <Trans>Not configured yet</Trans>
      </p>
    </NodeCard>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
