// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { IconButton } from "@carbon/react";
import { Plural, useLingui } from "@lingui/react/macro";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";
import { LuFocus } from "react-icons/lu";
import type { ProjectElementType } from "../../../projects.models";
import { ElementTypeIcon } from "../ElementTypeIcon";
import { BOX_HEADER_HEIGHT } from "./tree-layout";

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
 * The box of one parent's children on the Tree layout. The parent's name
 * sits above the box, as a label, and the box is a very faint neutral
 * surface with the cards inside it. A collapsed parent's box shows how many
 * items it hides.
 */
function ElementBoxNodeImpl({ data }: NodeProps<ElementBoxGraphNode>) {
  const { t } = useLingui();
  const { ownerId, label, type } = data;

  return (
    <div className="relative h-full w-full">
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
      {/* The label fills the layout's header band; the box starts under it. */}
      <div
        className="flex items-center gap-1.5 px-1 text-sm text-foreground"
        style={{ height: BOX_HEADER_HEIGHT }}
      >
        {type && <ElementTypeIcon type={type} className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!data.isTop && ownerId && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={<LuFocus />}
            aria-label={t`Focus on ${label}`}
            className="nodrag text-muted-foreground"
            data-graph-action
            onClick={() => data.onFocus(ownerId)}
          />
        )}
      </div>
      <div
        className="absolute inset-x-0 bottom-0 rounded-lg border border-border bg-muted/30"
        style={{ top: BOX_HEADER_HEIGHT }}
      >
        {data.collapsedCount !== null && ownerId ? (
          <button
            type="button"
            data-graph-action
            className="nodrag m-2 flex h-9 w-[calc(100%-1rem)] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-accent/40"
            // The canvas skips its node click for this button.
            onClick={() => data.onExpand(ownerId)}
          >
            <Plural value={data.collapsedCount} one="# item" other="# items" />
          </button>
        ) : data.collapsedCount === null &&
          data.cardCount === 0 &&
          data.hiddenCount > 0 ? (
          <div className="m-2 flex h-9 items-center justify-center text-xs text-muted-foreground">
            <Plural
              value={data.hiddenCount}
              one="# hidden by the type filter"
              other="# hidden by the type filter"
            />
          </div>
        ) : data.cardCount === 0 && data.hiddenCount === 0 && data.emptyText ? (
          <div className="m-2 flex h-9 items-center justify-center text-xs text-muted-foreground">
            {data.emptyText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const ElementBoxNode = memo(ElementBoxNodeImpl);
