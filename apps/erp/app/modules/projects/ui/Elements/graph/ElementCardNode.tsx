// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Plural, useLingui } from "@lingui/react/macro";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { LuChevronRight, LuMessageSquare } from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { handleClass } from "~/modules/workflows/ui/Builder/handles";
import type {
  ProjectElementType,
  ProjectStateGroup,
  RequirementStatus
} from "../../../projects.models";
import { StateIcon } from "../../Project/StateIcon";
import {
  ElementTypeIcon,
  elementTypeColors,
  useElementTypeLabels
} from "../ElementTypeIcon";
import { SuspectBadge, VerificationStatus } from "../VerificationStatus";
import { CARD_HEIGHT, CARD_WIDTH } from "./tree-layout";

export type ElementCardData = {
  readableId: string;
  name: string;
  type: ProjectElementType;
  state: { name: string; group: ProjectStateGroup; color: string } | null;
  ownerId: string | null;
  status: RequirementStatus | null;
  commentCount: number;
  linkCount: { kind: "tests" | "reqs"; count: number } | null;
  isSuspect: boolean;
  isOpen: boolean;
  isDimmed: boolean;
  isHighlighted: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  onToggle: (id: string) => void;
  onHighlight: (id: string) => void;
};
export type ElementCardGraphNode = Node<ElementCardData, "card">;

/**
 * One element on the Tree layout, as a compact card in its parent's box:
 * type, readable id, comments and owner; the name; the state, the
 * verification, a suspect link and the trace link count. The count lights
 * up the card's links. The chevron collapses the box of its children.
 */
function ElementCardNodeImpl({ id, data }: NodeProps<ElementCardGraphNode>) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const linkCount =
    data.linkCount && data.linkCount.count > 0 ? data.linkCount : null;

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-md border bg-card px-2.5 py-2 text-sm transition-[opacity,background-color] hover:bg-accent/40",
        data.isSuspect ? "border-amber-500" : "border-border",
        data.isOpen && "ring-2 ring-primary/50",
        data.isDimmed && "opacity-40"
      )}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
    >
      <Handle
        type="target"
        id="link-in"
        position={Position.Left}
        className={handleClass()}
      />
      <div className="relative -mx-2.5 flex min-w-0 items-center gap-1.5 px-2.5">
        <ElementTypeIcon type={data.type} className="size-3.5" />
        <span
          className={cn(
            "text-xs font-medium",
            elementTypeColors[data.type]?.label
          )}
        >
          {typeLabels[data.type]}
        </span>
        <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
          {data.readableId}
        </span>
        <span className="flex-1" />
        {data.commentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <LuMessageSquare aria-hidden className="size-3" />
            <span aria-hidden className="text-xs tabular-nums">
              {data.commentCount}
            </span>
            <span className="sr-only">
              <Plural
                value={data.commentCount}
                one="# comment"
                other="# comments"
              />
            </span>
          </span>
        )}
        <EmployeeAvatar employeeId={data.ownerId} withName={false} size="xxs" />
        <Handle
          type="source"
          id="link-out"
          position={Position.Right}
          className={handleClass()}
        />
      </div>
      <div className="line-clamp-1 font-semibold">{data.name}</div>
      <div className="flex min-w-0 items-center gap-1.5">
        {data.state && (
          <span className="inline-flex h-5 min-w-0 items-center gap-1 rounded border border-border px-1.5 text-xs">
            <StateIcon group={data.state.group} color={data.state.color} />
            <span className="truncate">{data.state.name}</span>
          </span>
        )}
        <VerificationStatus status={data.status} iconOnly />
        {data.isSuspect && <SuspectBadge />}
        <span className="flex-1" />
        {linkCount && (
          <button
            type="button"
            data-graph-action
            aria-pressed={data.isHighlighted}
            className={cn(
              "nodrag inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs tabular-nums text-muted-foreground hover:bg-accent",
              data.isHighlighted && "bg-accent text-foreground"
            )}
            // The canvas skips its node click for this button.
            onClick={() => data.onHighlight(id)}
          >
            {linkCount.kind === "tests" ? (
              <Plural value={linkCount.count} one="# test" other="# tests" />
            ) : (
              <Plural value={linkCount.count} one="# req" other="# reqs" />
            )}
          </button>
        )}
      </div>
      {data.hasChildren && (
        <>
          <Handle
            type="source"
            id="children"
            position={Position.Right}
            isConnectable={false}
            className="!opacity-0"
          />
          <button
            type="button"
            data-graph-action
            aria-label={data.isCollapsed ? t`Expand` : t`Collapse`}
            className="nodrag absolute -right-2.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent"
            // The canvas skips its node click for this button.
            onClick={() => data.onToggle(id)}
          >
            <LuChevronRight className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}

export const ElementCardNode = memo(ElementCardNodeImpl);
