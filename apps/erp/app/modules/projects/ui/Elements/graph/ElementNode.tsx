// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useUpdateNodeInternals
} from "@xyflow/react";
import { memo, useEffect } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { handleClass } from "~/modules/workflows/ui/Builder/handles";
import type {
  ProjectElementType,
  ProjectStateGroup,
  RequirementStatus
} from "../../../projects.models";
import { StateIcon } from "../../Project/StateIcon";
import { ElementTypeIcon, useElementTypeLabels } from "../ElementTypeIcon";
import { SuspectBadge, VerificationStatus } from "../VerificationStatus";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";
import type { GraphDirection } from "./store";

export type ElementNodeData = {
  readableId: string;
  name: string;
  type: ProjectElementType;
  state: { group: ProjectStateGroup; color: string } | null;
  status: RequirementStatus | null;
  isSuspect: boolean;
  isOpen: boolean;
  childCount: number;
  isCollapsed: boolean;
  direction: GraphDirection;
  onToggle: (id: string) => void;
};

export type ElementGraphNode = Node<ElementNodeData, "element">;

/**
 * One element on the Tree layout: type, readable id, state, a Requirement's
 * verification, and the name. An amber outline marks a suspect link. The
 * handles start a new trace link.
 */
function ElementNodeImpl({ id, data }: NodeProps<ElementGraphNode>) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const updateNodeInternals = useUpdateNodeInternals();
  const horizontal = data.direction === "LR";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handles move with the direction
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, horizontal, updateNodeInternals]);

  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-1 rounded-lg border bg-card px-3 text-sm transition-colors hover:bg-accent/40",
        data.isSuspect ? "border-amber-500" : "border-border",
        data.isOpen && "ring-2 ring-primary/50"
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className={handleClass()}
      />
      <div className="flex min-w-0 items-center gap-1.5">
        <ElementTypeIcon type={data.type} className="size-3.5" />
        <span className="sr-only">{typeLabels[data.type]}</span>
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {data.readableId}
        </span>
        <span className="flex-1" />
        {data.isSuspect && <SuspectBadge />}
        {data.status && <VerificationStatus status={data.status} iconOnly />}
        {data.state && (
          <StateIcon group={data.state.group} color={data.state.color} />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <span className="line-clamp-1 flex-1 font-medium">{data.name}</span>
        {data.childCount > 0 && (
          <button
            type="button"
            data-graph-toggle
            aria-label={data.isCollapsed ? t`Expand` : t`Collapse`}
            className="nodrag inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-xs text-muted-foreground hover:bg-accent"
            // The canvas skips its node click for this button.
            onClick={() => data.onToggle(id)}
          >
            {data.isCollapsed ? (
              <LuChevronRight className="size-3" />
            ) : (
              <LuChevronDown className="size-3" />
            )}
            <span className="tabular-nums">{data.childCount}</span>
          </button>
        )}
      </div>
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className={handleClass()}
      />
    </div>
  );
}

export const ElementNode = memo(ElementNodeImpl);
