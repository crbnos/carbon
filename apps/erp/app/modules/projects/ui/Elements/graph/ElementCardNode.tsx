// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Plural, useLingui } from "@lingui/react/macro";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { LuChevronRight, LuLink, LuMessageSquare } from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { handleClass } from "~/modules/workflows/ui/Builder/handles";
import type {
  ProjectElementType,
  ProjectStateGroup
} from "../../../projects.models";
import { StateIcon } from "../../Project/StateIcon";
import { ElementTypeIcon, useElementTypeLabels } from "../ElementTypeIcon";
import { CARD_HEIGHT, CARD_WIDTH } from "./tree-layout";

/** The trace link handles show only while the card is hovered. */
const linkHandleClass = `${handleClass()} !opacity-0 group-hover:!opacity-100`;

export type ElementCardData = {
  readableId: string;
  name: string;
  type: ProjectElementType;
  state: { name: string; group: ProjectStateGroup; color: string } | null;
  ownerId: string | null;
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
 * One element on the Tree layout, as a quiet card in its parent's box (the
 * look of Flow's requirement cards): a small grey type label with its icon,
 * the comment and trace link counts and the owner; the name; at most one
 * chip, the state. The link count lights up the card's links. An amber
 * border marks a link that needs review. The chevron collapses the box of
 * its children.
 */
function ElementCardNodeImpl({ id, data }: NodeProps<ElementCardGraphNode>) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const linkCount =
    data.linkCount && data.linkCount.count > 0 ? data.linkCount : null;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-sm shadow-xs transition-[opacity,background-color,border-color] hover:bg-accent/40",
        data.isSuspect ? "border-amber-500" : "border-border",
        data.isOpen && "border-primary ring-1 ring-primary/40",
        data.isDimmed && "opacity-40"
      )}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      title={`${data.readableId} · ${data.name}`}
    >
      <Handle
        type="target"
        id="link-in"
        position={Position.Left}
        className={linkHandleClass}
      />
      {/* `relative` with the card's padding: the link-out handle sits at the
          card's right edge on this row, clear of the collapse chevron. */}
      <div className="relative -mx-3 flex h-4 min-w-0 items-center gap-1.5 px-3 text-xs text-muted-foreground">
        <ElementTypeIcon type={data.type} className="size-3.5 shrink-0" />
        <span className="truncate">{typeLabels[data.type]}</span>
        <span className="flex-1" />
        {data.commentCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1">
            <LuMessageSquare aria-hidden className="size-3" />
            <span aria-hidden className="tabular-nums">
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
        {linkCount && (
          <button
            type="button"
            data-graph-action
            aria-pressed={data.isHighlighted}
            className={cn(
              "nodrag -my-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 tabular-nums hover:bg-accent hover:text-foreground",
              data.isHighlighted && "bg-accent text-foreground"
            )}
            // The canvas skips its node click for this button.
            onClick={() => data.onHighlight(id)}
          >
            <LuLink aria-hidden className="size-3" />
            <span aria-hidden>{linkCount.count}</span>
            <span className="sr-only">
              {linkCount.kind === "tests" ? (
                <Plural value={linkCount.count} one="# test" other="# tests" />
              ) : (
                <Plural value={linkCount.count} one="# req" other="# reqs" />
              )}
            </span>
          </button>
        )}
        <span className="shrink-0">
          <EmployeeAvatar
            employeeId={data.ownerId}
            withName={false}
            size="xxs"
          />
        </span>
        <Handle
          type="source"
          id="link-out"
          position={Position.Right}
          className={linkHandleClass}
        />
      </div>
      <div className="line-clamp-2 min-w-0 break-words leading-5 text-foreground">
        {data.name}
      </div>
      {data.state && (
        <div className="mt-auto flex min-w-0">
          <span className="inline-flex h-5 min-w-0 items-center gap-1 rounded bg-muted px-1.5 text-xs text-muted-foreground">
            <StateIcon group={data.state.group} color={data.state.color} />
            <span className="truncate">{data.state.name}</span>
          </span>
        </div>
      )}
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
