import { cn, IconButton } from "@carbon/react";
import type { WorkflowNodeType } from "@carbon/workflows";
import { FAILURE_HANDLE } from "@carbon/workflows";
import { WORKFLOW_LABELS } from "@carbon/workflows/labels";
import { Trans, useLingui } from "@lingui/react/macro";
import type { NodeProps } from "@xyflow/react";
import { useConnection } from "@xyflow/react";
import { memo, useEffect, useState } from "react";
import {
  LuMaximize2,
  LuMinimize2,
  LuTrash2,
  LuTriangleAlert,
  LuX
} from "react-icons/lu";
import { catalog } from "../catalog";
import type { AnyNodeForm } from "../config/forms/index";
import { NODE_FORMS } from "../config/forms/index";
import { InlineNodeName } from "../config/InlineNodeName";
import {
  useBuilderStore,
  useBuilderStoreApi,
  useBuilderStoreShallow
} from "../context";
import { asWorkflowNode, canConnect } from "../graph";
import { NodeCard } from "../NodeCard";
import { portsFor } from "../ports";
import {
  selectHasEdgeFrom,
  selectIsConnected,
  selectNode,
  selectNodeIssues,
  selectTriggerCount
} from "../selectors";
import { BatchToggle } from "./BatchToggle";
import { NODE_CARD_WIDTH } from "./kinds";
import { NODE_KIND_META } from "./meta";

// Every node kind renders through this one component; what differs between kinds
// is data in `NODE_KIND_META`, not code.
function WorkflowNodeCardImpl({ id, type, data, selected }: NodeProps) {
  const { i18n, t } = useLingui();
  const node = asWorkflowNode(id, type as WorkflowNodeType, data);
  const meta = NODE_KIND_META[node.type];

  const store = useBuilderStoreApi();
  const builderNode = useBuilderStore(selectNode(id));
  const isExpanded = builderNode?.expanded ?? true;

  const nodeIssues = useBuilderStoreShallow(selectNodeIssues(id));

  // A node wired to nothing is a draft the user parked on the canvas, not a broken
  // step — the run can't reach it, so flagging it would only be noise. The forms
  // still show their own field errors; this governs the card's border and footer.
  const isConnected = useBuilderStore(selectIsConnected(id));
  const cardIssues = isConnected ? nodeIssues : [];

  const isReadOnly = useBuilderStore((state) => state.isReadOnly);

  // A string, not an object: the answer only changes when this card flips between
  // states, so a pointer move mid-drag does not re-render every card on the canvas.
  // `store.getState()` is safe here — nodes and edges cannot change during a drag.
  const connectionState = useConnection((connection) => {
    if (!connection.inProgress) return "idle" as const;
    if (connection.fromNode.id === id) return "source" as const;
    const { nodes, edges } = store.getState();
    return canConnect(nodes, edges, {
      source: connection.fromNode.id,
      sourceHandle: connection.fromHandle.id ?? null,
      target: id
    })
      ? ("compatible" as const)
      : ("incompatible" as const);
  });

  const renameNode = useBuilderStore((state) => state.renameNode);
  const setNodeExpanded = useBuilderStore((state) => state.setNodeExpanded);
  const triggerCount = useBuilderStore(selectTriggerCount);
  const hasFailureEdge = useBuilderStore(selectHasEdgeFrom(id, FAILURE_HANDLE));

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

  const ports = portsFor(node, t);

  // Failure-path affordance: action and lookup have a "failure" handle; warn
  // when nothing is wired to it (card-level only, not a WorkflowIssue).
  const hasFailureHandle = ports.some((p) => p.id === FAILURE_HANDLE);

  // The one narrowing site: the registry is keyed by kind but dispatched from a value.
  const Form = NODE_FORMS[node.type] as AnyNodeForm;

  const canDelete = node.type !== "trigger" || triggerCount > 1;

  const titleSlot = builderNode ? (
    <InlineNodeName
      name={builderNode.name}
      isReadOnly={isReadOnly}
      // Read lazily: only the node being renamed needs the other names, and
      // subscribing to `nodes` here would re-render every card on every drag frame.
      isTaken={(slug) =>
        store.getState().nodes.some((n) => n.id !== id && n.name === slug)
      }
      onCommit={(name) => renameNode(id, name)}
    />
  ) : (
    <span className="truncate text-xs font-semibold">
      {label ?? meta.title?.(node) ?? meta.defaultTitle}
    </span>
  );

  const batchSlot =
    node.type === "action" && catalog.getAction(node.data.action)?.batchable ? (
      <BatchToggle
        nodeId={id}
        isBatch={node.data.batch}
        isReadOnly={isReadOnly}
        hasIssue={nodeIssues.some((issue) => issue.field === "batch")}
      />
    ) : null;

  const actionsSlot =
    builderNode && (!isReadOnly || batchSlot) ? (
      <div className="nodrag nopan flex shrink-0 items-center gap-0.5">
        {batchSlot}
        {!isReadOnly && (
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
        )}
        {!isReadOnly && canDelete && (
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
        ports={ports}
        hasTarget={meta.hasTarget}
        issues={cardIssues.map((issue) => issue.message)}
        isSelected={!!selected}
        connectionState={connectionState}
        isExpanded={isExpanded}
        width={NODE_CARD_WIDTH[node.type]}
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
            <Trans>
              No failure path — the run stops here and is marked failed
            </Trans>
          </p>
        )}
      </NodeCard>
    </>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
