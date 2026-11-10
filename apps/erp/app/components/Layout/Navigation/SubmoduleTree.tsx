// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuEye, LuEyeOff, LuGripVertical } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import {
  POINTER_SENSOR_OPTIONS,
  SORTABLE_KEYBOARD_SENSOR_OPTIONS
} from "~/utils/drag-sensors";
import { orderedGroups, submoduleKey } from "~/utils/submodule-visibility";

// A touch screen has no hover, so there the control always shows.
const HOVER_REVEAL = "[@media(hover:none)]:opacity-100";

type SubmoduleTreeProps = {
  moduleName: string;
  groups: RouteGroup[];
  hidden: ReadonlySet<string>;
  order: string[];
  onSetHidden: (keys: string[], hidden: boolean) => void;
  onReorder: (keys: string[]) => void;
};

export function SubmoduleTree({
  moduleName,
  groups,
  hidden,
  order,
  onSetHidden,
  onReorder
}: SubmoduleTreeProps) {
  const { t } = useLingui();
  const arranged = orderedGroups(
    groups,
    new Map(order.map((key, index) => [key, index]))
  );
  const keysOf = (group: RouteGroup) =>
    group.routes.map((route) => submoduleKey(route));
  const visibleCount = arranged
    .flatMap(keysOf)
    .filter((key) => !hidden.has(key)).length;
  // A module keeps one sub-module. Otherwise the user hides the module itself.
  const keepOne = t`Keep one, or hide ${moduleName} itself`;

  return (
    <div className="flex flex-col w-full pt-0.5 pb-2">
      {arranged.map((group) => {
        const keys = keysOf(group);
        const groupVisible = keys.filter((key) => !hidden.has(key)).length;
        const groupHidden = groupVisible === 0;
        return (
          <div key={group.name} className="flex flex-col">
            {group.name && (
              <div
                className={cn(
                  "group/tree-group relative pl-8 pr-8 mt-1",
                  "text-xs leading-6 text-muted-foreground truncate"
                )}
              >
                {group.name}
                <SubmoduleEye
                  isHidden={groupHidden}
                  label={
                    groupHidden
                      ? t`Show all in ${group.name}`
                      : t`Hide all in ${group.name}`
                  }
                  disabledReason={
                    !groupHidden && visibleCount === groupVisible
                      ? keepOne
                      : undefined
                  }
                  onClick={() => onSetHidden(keys, !groupHidden)}
                  className={cn(
                    "top-0.5 focus-visible:opacity-100",
                    !groupHidden &&
                      cn(
                        "md:opacity-0 group-hover/tree-group:opacity-100",
                        HOVER_REVEAL
                      )
                  )}
                />
              </div>
            )}
            <SortableGroup
              keys={keys}
              // A sub-module moves inside its group, so a group keeps its meaning.
              onMove={(moved) =>
                onReorder(
                  arranged.flatMap((other) =>
                    other === group ? moved : keysOf(other)
                  )
                )
              }
            >
              {group.routes.map((route) => {
                const key = submoduleKey(route);
                const isHidden = hidden.has(key);
                return (
                  <SortableRow
                    key={key}
                    id={key}
                    handleLabel={t`Move ${route.name}`}
                    isHidden={isHidden}
                  >
                    {route.name}
                    <SubmoduleEye
                      isHidden={isHidden}
                      label={
                        isHidden ? t`Show ${route.name}` : t`Hide ${route.name}`
                      }
                      disabledReason={
                        !isHidden && visibleCount === 1 ? keepOne : undefined
                      }
                      onClick={() => onSetHidden([key], !isHidden)}
                      className="top-1"
                    />
                  </SortableRow>
                );
              })}
            </SortableGroup>
          </div>
        );
      })}
    </div>
  );
}

// Each group has its own drag context: a row cannot leave its group, and the
// module drag around it never sees the row.
function SortableGroup({
  keys,
  onMove,
  children
}: {
  keys: string[];
  onMove: (keys: string[]) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, SORTABLE_KEYBOARD_SENSOR_OPTIONS)
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(
      arrayMove(
        keys,
        keys.indexOf(String(active.id)),
        keys.indexOf(String(over.id))
      )
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  handleLabel,
  isHidden,
  children
}: {
  id: string;
  handleLabel: string;
  isHidden: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/sub relative h-7 pl-8 pr-8 rounded-md",
        "text-sm leading-7 font-medium truncate",
        "hover:bg-accent",
        isHidden ? "text-foreground/40" : "text-foreground/80",
        isDragging && "z-10 bg-accent opacity-50"
      )}
    >
      <button
        type="button"
        aria-label={handleLabel}
        {...attributes}
        {...listeners}
        className={cn(
          "absolute left-3 top-1.5 p-0.5 rounded text-muted-foreground",
          "cursor-grab touch-none active:cursor-grabbing transition-opacity",
          "opacity-0 group-hover/sub:opacity-100 focus-visible:opacity-100",
          HOVER_REVEAL,
          isDragging && "opacity-100"
        )}
      >
        <LuGripVertical className="w-3 h-3" aria-hidden />
      </button>
      {children}
    </div>
  );
}

function SubmoduleEye({
  isHidden,
  label,
  disabledReason,
  onClick,
  className
}: {
  isHidden: boolean;
  label: string;
  disabledReason?: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = isHidden ? LuEyeOff : LuEye;
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-disabled={Boolean(disabledReason)}
      onClick={disabledReason ? undefined : onClick}
      className={cn(
        "absolute right-2 p-0.5 rounded text-muted-foreground",
        "transition-opacity",
        disabledReason
          ? "opacity-30 cursor-not-allowed"
          : "hover:text-foreground",
        className
      )}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
  if (!disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
