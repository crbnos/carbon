// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, IconButton } from "@carbon/react";
import { Plural, useLingui } from "@lingui/react/macro";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { LuFocus } from "react-icons/lu";
import type { ProjectElementType } from "../../../projects.models";
import { ElementTypeIcon, elementTypeColors } from "../ElementTypeIcon";

export type ElementBoxData = {
  ownerId: string | null;
  label: string;
  /** The owner's type; null for the project. */
  type: ProjectElementType | null;
  isTop: boolean;
  cardCount: number;
  collapsedCount: number | null;
  hiddenCount: number;
  /** The text of an empty top box. */
  emptyText: string | null;
  onFocus: (ownerId: string) => void;
  onExpand: (ownerId: string) => void;
};
export type ElementBoxGraphNode = Node<ElementBoxData, "box">;

/**
 * The box of one parent's children on the Tree layout, tinted with the
 * parent's type colour and labelled with its name. The cards sit inside it.
 * A collapsed parent's box shows how many items it hides.
 */
function ElementBoxNodeImpl({ data }: NodeProps<ElementBoxGraphNode>) {
  const { t } = useLingui();
  const { ownerId, label, type } = data;

  return (
    <div
      className={cn(
        "relative h-full w-full rounded-lg border",
        type ? elementTypeColors[type]?.box : "border-border bg-muted/30"
      )}
    >
      <Handle
        type="target"
        id="in"
        position={Position.Left}
        isConnectable={false}
        className="!opacity-0"
      />
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        isConnectable={false}
        className="!opacity-0"
      />
      <div className="flex h-8 items-center gap-1.5 px-2">
        {type && <ElementTypeIcon type={type} className="size-3.5" />}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {label}
        </span>
        {!data.isTop && ownerId && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={<LuFocus />}
            aria-label={t`Focus on ${label}`}
            className="nodrag"
            data-graph-action
            onClick={() => data.onFocus(ownerId)}
          />
        )}
      </div>
      {data.collapsedCount !== null && ownerId ? (
        <button
          type="button"
          data-graph-action
          className="nodrag mx-2 flex h-9 w-[calc(100%-1rem)] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-accent/40"
          // The canvas skips its node click for this button.
          onClick={() => data.onExpand(ownerId)}
        >
          <Plural value={data.collapsedCount} one="# item" other="# items" />
        </button>
      ) : data.collapsedCount === null &&
        data.cardCount === 0 &&
        data.hiddenCount > 0 ? (
        <div className="mx-2 flex h-9 items-center justify-center text-xs text-muted-foreground">
          <Plural
            value={data.hiddenCount}
            one="# hidden by the type filter"
            other="# hidden by the type filter"
          />
        </div>
      ) : data.cardCount === 0 && data.hiddenCount === 0 && data.emptyText ? (
        <div className="mx-2 flex h-9 items-center justify-center text-xs text-muted-foreground">
          {data.emptyText}
        </div>
      ) : null}
    </div>
  );
}

export const ElementBoxNode = memo(ElementBoxNodeImpl);
