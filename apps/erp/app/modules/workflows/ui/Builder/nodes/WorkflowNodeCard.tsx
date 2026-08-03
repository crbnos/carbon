import { cn, IconButton } from "@carbon/react";
import type { WorkflowNode, WorkflowNodeType } from "@carbon/workflows";
import { FAILURE_HANDLE, getNodeHandles } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { Trans, useLingui } from "@lingui/react/macro";
import type { NodeProps } from "@xyflow/react";
import { memo, useEffect, useState } from "react";
import {
  LuMaximize2,
  LuMinimize2,
  LuTrash2,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { NODE_FORMS } from "../config/forms/index";
import { InlineNodeName } from "../config/InlineNodeName";
import { useBuilderStore, useBuilderStoreShallow } from "../context";
import { asWorkflowNode } from "../graph";
import type { NodePort, PortTone } from "../NodeCard";
import { NodeCard } from "../NodeCard";
import { NODE_KIND_META } from "./meta";

const PORT_LABEL: Record<string, string> = {
  out: "Next",
  success: "Success",
  failure: "Failure"
};

const PORT_TONE: Record<string, PortTone> = {
  success: "success",
  failure: "failure"
};

// Handles come from `getNodeHandles` — the same function the validator uses — so
// the canvas cannot draw a port the validator would reject as UNKNOWN_HANDLE.
function portsFor(node: WorkflowNode): NodePort[] {
  return getNodeHandles(node).map((handle) => {
    if (node.type === "condition") {
      const path = node.data.paths.find((candidate) => candidate.id === handle);
      const label = path
        ? path.kind === "else"
          ? "Otherwise"
          : `Path ${node.data.paths.filter((p) => p.kind !== "else").findIndex((p) => p.id === handle)}`
        : handle;
      return { id: handle, label };
    }
    return {
      id: handle,
      label: PORT_LABEL[handle] ?? handle,
      tone: PORT_TONE[handle]
    };
  });
}

// Every node kind renders through this one component; what differs between kinds
// is data in `NODE_KIND_META`, not code.
function WorkflowNodeCardImpl({ id, type, data, selected }: NodeProps) {
  const { i18n, t } = useLingui();
  const node = asWorkflowNode(id, type as WorkflowNodeType, data);
  const meta = NODE_KIND_META[node.type];

  const builderNode = useBuilderStore((state) =>
    state.nodes.find((n) => n.id === id)
  );
  const isExpanded = builderNode?.expanded ?? true;

  const nodeIssues = useBuilderStoreShallow((state) =>
    state.issues.filter((issue) => issue.nodeId === id)
  );
  const issueCount = nodeIssues.length;

  const edges = useBuilderStore((state) => state.edges);
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);
  const renameNode = useBuilderStore((state) => state.renameNode);
  const setNodeExpanded = useBuilderStore((state) => state.setNodeExpanded);
  const allNodes = useBuilderStore((state) => state.nodes);
  const triggerCount = useBuilderStore(
    (state) => state.nodes.filter((n) => n.type === "trigger").length
  );

  // Two-click delete instead of a confirm dialog: the first click arms the
  // button, the second removes. Disarms itself so a stray click never lingers.
  const [armed, setArmed] = useState(false);
  const removeNode = useBuilderStore((state) => state.removeNode);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const catalogId = meta.catalogId?.(node);
  const label = catalogId
    ? (WORKFLOW_LABELS[catalogId] && i18n._(WORKFLOW_LABELS[catalogId])) ||
      catalogId
    : undefined;

  const summary = label ?? meta.summary?.(node);

  // Failure-path affordance: action and lookup have a "failure" handle; warn
  // when nothing is wired to it (card-level only, not a WorkflowIssue).
  const handles = getNodeHandles(node);
  const hasFailureHandle = handles.includes(FAILURE_HANDLE);
  const hasFailureEdge = hasFailureHandle
    ? edges.some((e) => e.source === id && e.sourceHandle === FAILURE_HANDLE)
    : false;

  const Form = NODE_FORMS[node.type];

  const canDelete = node.type !== "trigger" || triggerCount > 1;

  // The condition form draws its own per-path handles; the strip would duplicate
  // every id. Collapsed nodes have no form, so there the strip is the only source.
  const hidePortStrip =
    node.type === "condition" && isExpanded && !!builderNode;

  const takenNames = new Set(
    allNodes.filter((n) => n.id !== id).map((n) => n.name)
  );

  const titleSlot = builderNode ? (
    <InlineNodeName
      name={builderNode.name}
      isReadOnly={isReadOnly}
      isTaken={(slug) => takenNames.has(slug)}
      onCommit={(name) => renameNode(id, name)}
    />
  ) : (
    <span className="truncate text-xs font-semibold">
      {label ?? meta.title?.(node) ?? meta.defaultTitle}
    </span>
  );

  const actionsSlot =
    !isReadOnly && builderNode ? (
      <div className="nodrag nopan flex shrink-0 items-center gap-0.5">
        <IconButton
          aria-label={isExpanded ? t`Collapse` : t`Expand`}
          icon={isExpanded ? <LuMinimize2 /> : <LuMaximize2 />}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setNodeExpanded(id, !isExpanded);
          }}
        />
        {canDelete && (
          <IconButton
            aria-label={armed ? t`Confirm delete` : t`Delete step`}
            icon={armed ? <LuTrash2 /> : <LuX />}
            variant="ghost"
            size="sm"
            className={cn(armed && "text-destructive hover:text-destructive")}
            onClick={(e) => {
              e.stopPropagation();
              if (armed) removeNode(id);
              else setArmed(true);
            }}
            onBlur={() => setArmed(false)}
          />
        )}
      </div>
    ) : undefined;

  return (
    <>
      <NodeCard
        nodeId={id}
        title={titleSlot}
        description={meta.description}
        summary={summary}
        icon={<meta.Icon className="size-3.5" />}
        ports={portsFor(node)}
        hasTarget={meta.hasTarget}
        issueCount={issueCount}
        isSelected={!!selected}
        isExpanded={isExpanded}
        width={meta.width}
        hidePortStrip={hidePortStrip}
        actions={actionsSlot}
      >
        {builderNode && (
          <div className="space-y-3">
            <Form key={id} node={builderNode} issues={nodeIssues} />
          </div>
        )}
        {hasFailureHandle && !hasFailureEdge && (
          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
            <LuTriangleAlert className="size-3 shrink-0" />
            <Trans>Nothing happens if this fails</Trans>
          </p>
        )}
      </NodeCard>
    </>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
