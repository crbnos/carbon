// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, navRailItemClasses } from "@carbon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LuEyeOff, LuGripVertical } from "react-icons/lu";
import type { DraftModule } from "./useNavigationEditMode";

type SortableNavItemProps = {
  module: DraftModule;
  onToggleHidden: (key: string) => void;
};

export function SortableNavItem({
  module,
  onToggleHidden
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: module.key });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        navRailItemClasses,
        "hover:bg-accent hover:text-accent-foreground",
        "border border-transparent",
        isDragging && "opacity-50 border-primary"
      )}
    >
      {/* Drag handle */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full flex items-center pl-1",
          "md:opacity-0 group-data-[state=expanded]:opacity-100",
          "cursor-grab active:cursor-grabbing"
        )}
        {...attributes}
        {...listeners}
      >
        <LuGripVertical className="w-3 h-3 text-muted-foreground" />
      </div>

      {/* Module icon */}
      <module.icon className="absolute left-8 top-3 flex items-center justify-center" />

      {/* Module name */}
      <span
        className={cn(
          "min-w-[128px] text-sm",
          "absolute left-12 group-data-[state=expanded]:left-16",
          "md:opacity-0 group-data-[state=expanded]:opacity-100"
        )}
      >
        {module.name}
      </span>

      {/* Hide button */}
      <button
        type="button"
        onClick={() => onToggleHidden(module.key)}
        className={cn(
          "absolute right-2 top-2.5 p-0.5 rounded",
          "md:opacity-0 group-data-[state=expanded]:opacity-100",
          "text-muted-foreground hover:text-foreground",
          "transition-opacity"
        )}
      >
        <LuEyeOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
