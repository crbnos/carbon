// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ClientOnly, cn, VStack } from "@carbon/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DragHandleBindings, ReorderableLine } from "./types";

type ReorderableLineListProps<T extends ReorderableLine> = {
  lines: T[];
  activeLine: T | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  renderRow: (line: T, dragHandle: DragHandleBindings) => ReactNode;
  renderOverlay: (line: T) => ReactNode;
};

export function ReorderableLineList<T extends ReorderableLine>({
  lines,
  activeLine,
  onDragStart,
  onDragEnd,
  renderRow,
  renderOverlay
}: ReorderableLineListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={lines.map((l) => l.id!)}
        strategy={verticalListSortingStrategy}
      >
        <VStack spacing={0} className="w-full">
          {lines.map((line) => (
            <SortableLineRow key={line.id} line={line} renderRow={renderRow} />
          ))}
        </VStack>
      </SortableContext>
      <ClientOnly fallback={null}>
        {() =>
          createPortal(
            <DragOverlay dropAnimation={null}>
              {activeLine && renderOverlay(activeLine)}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>
    </DndContext>
  );
}

function SortableLineRow<T extends ReorderableLine>({
  line,
  renderRow
}: {
  line: T;
  renderRow: (line: T, dragHandle: DragHandleBindings) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: line.id! });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transition ?? undefined
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full border-b border-border/60 bg-card",
        "transition-[opacity,background-color] duration-150 ease",
        isDragging && "opacity-40 bg-muted/30"
      )}
    >
      {renderRow(line, { attributes, listeners })}
    </div>
  );
}
