// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ClientOnly, cn } from "@carbon/react";
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragStartEvent
} from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  MATRIX_OUTSIDE,
  type MatrixDragSource,
  type MatrixDropTarget,
  type MatrixMove,
  type MatrixPlace,
  matrixCellId,
  resolveMatrixDrop
} from "./resolveMatrixDrop";

// Module constants: a new options object makes a new sensor, and with it new
// listeners for every draggable on every render. The distance lets a click
// on a chip's cell still open the cell's modal; once a drag starts, dnd-kit
// swallows the click its pointerup makes.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };

// A pointer drag lands on the cell under the pointer; a keyboard drag has no
// pointer, so it lands on the nearest cell.
const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

function dragSource(data: unknown): MatrixDragSource | null {
  const source = data as Partial<MatrixDragSource> | undefined;
  return source?.chipId && source.from
    ? { chipId: source.chipId, from: source.from }
    : null;
}

function dropTarget(data: unknown): MatrixDropTarget | null {
  const target = data as Partial<MatrixDropTarget> | undefined;
  return target?.to ? { to: target.to, disabled: target.disabled } : null;
}

type ScheduleMatrixDndProps = {
  /** A chip was dropped somewhere it can go. */
  onMove: (move: MatrixMove) => void;
  /** The chip under the pointer while it is dragged. */
  renderOverlay: (chipId: string) => ReactNode;
  /** A chip's name, for screen-reader announcements. */
  describeChip?: (chipId: string) => string;
  /** A place's name, for screen-reader announcements. */
  describePlace?: (place: MatrixPlace) => string;
  children: ReactNode;
};

/**
 * Drag and drop for a people × days matrix: chips (`MatrixChip`) move
 * between cells (`MatrixCell`) and a side panel (`MatrixOutsideZone`).
 */
export function ScheduleMatrixDnd({
  onMove,
  renderOverlay,
  describeChip,
  describePlace,
  children
}: ScheduleMatrixDndProps) {
  const { t } = useLingui();
  const [activeChipId, setActiveChipId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor)
  );

  const chipName = (id: string | number) =>
    describeChip?.(String(id)) ?? t`Assignment`;
  const placeName = (data: unknown) => {
    const target = dropTarget(data);
    if (!target) return t`a cell`;
    return describePlace?.(target.to) ?? t`a cell`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t`Picked up ${chipName(active.id)}`,
    onDragOver: ({ active, over }) =>
      over
        ? t`${chipName(active.id)} is over ${placeName(over.data.current)}`
        : t`${chipName(active.id)} is no longer over a cell`,
    onDragEnd: ({ active, over }) =>
      over
        ? t`${chipName(active.id)} was dropped on ${placeName(over.data.current)}`
        : t`${chipName(active.id)} was dropped`,
    onDragCancel: ({ active }) => t`Moving ${chipName(active.id)} was cancelled`
  };

  function onDragStart(event: DragStartEvent) {
    setActiveChipId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveChipId(null);
    const move = resolveMatrixDrop(
      dragSource(event.active.data.current),
      dropTarget(event.over?.data.current)
    );
    if (move) onMove(move);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveChipId(null)}
    >
      {children}
      <ClientOnly fallback={null}>
        {() =>
          createPortal(
            <DragOverlay dropAnimation={null}>
              {activeChipId && renderOverlay(activeChipId)}
            </DragOverlay>,
            document.body
          )
        }
      </ClientOnly>
    </DndContext>
  );
}

type MatrixCellProps = {
  rowId: string;
  date: string;
  /** Refuses drops: an absent day, a user who cannot edit. */
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** A drop target for one person on one day. */
export function MatrixCell({
  rowId,
  date,
  disabled = false,
  className,
  children
}: MatrixCellProps) {
  const position = { rowId, date };
  const { setNodeRef, isOver } = useDroppable({
    id: matrixCellId(position),
    disabled,
    data: { to: position, disabled } satisfies MatrixDropTarget
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        isOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        className
      )}
    >
      {children}
    </div>
  );
}

type MatrixChipProps = {
  chipId: string;
  /** The cell the chip sits in; null for a chip in the side panel. */
  rowId: string | null;
  date: string | null;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** A draggable block in a cell or in the side panel. */
export function MatrixChip({
  chipId,
  rowId,
  date,
  disabled = false,
  className,
  children
}: MatrixChipProps) {
  const from: MatrixPlace =
    rowId !== null && date !== null ? { rowId, date } : MATRIX_OUTSIDE;
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: chipId,
    disabled,
    data: { chipId, from } satisfies MatrixDragSource
  });
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !disabled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        className
      )}
    >
      {children}
    </span>
  );
}

type MatrixOutsideZoneProps = {
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

/** The side panel beside the grid (a backlog): chips drop here and leave from here. */
export function MatrixOutsideZone({
  disabled = false,
  className,
  children
}: MatrixOutsideZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: MATRIX_OUTSIDE,
    disabled,
    data: { to: MATRIX_OUTSIDE, disabled } satisfies MatrixDropTarget
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "transition-colors",
        isOver && "bg-primary/10 ring-1 ring-inset ring-primary/40",
        className
      )}
    >
      {children}
    </div>
  );
}
