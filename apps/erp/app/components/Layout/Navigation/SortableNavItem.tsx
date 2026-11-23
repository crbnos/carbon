// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, navRailItemClasses } from "@carbon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLingui } from "@lingui/react/macro";
import {
  LuChevronDown,
  LuChevronRight,
  LuEye,
  LuGripVertical
} from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { submoduleKey } from "~/utils/submodule-visibility";
import { SubmoduleTree } from "./SubmoduleTree";
import type { DraftModule } from "./useNavigationEditMode";

type SortableNavItemProps = {
  module: DraftModule;
  groups: RouteGroup[];
  isOpen: boolean;
  onToggleOpen: (key: string) => void;
  onToggleHidden: (key: string) => void;
  onSetSubmodulesHidden: (
    moduleKey: string,
    keys: string[],
    hidden: boolean
  ) => void;
  onSetSubmoduleOrder: (moduleKey: string, keys: string[]) => void;
};

export function SortableNavItem({
  module,
  groups,
  isOpen,
  onToggleOpen,
  onToggleHidden,
  onSetSubmodulesHidden,
  onSetSubmoduleOrder
}: SortableNavItemProps) {
  const { t } = useLingui();
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

  const hidden = new Set(module.hiddenSubmodules);
  const hiddenCount = groups
    .flatMap((group) => group.routes)
    .filter((route) => hidden.has(submoduleKey(route))).length;

  return (
    // The tree is inside the sortable node, so it moves with its row.
    <div ref={setNodeRef} style={style} className="w-full flex flex-col">
      <div
        className={cn(
          navRailItemClasses,
          "hover:bg-accent hover:text-accent-foreground",
          "border border-transparent",
          isDragging && "opacity-50 border-primary"
        )}
      >
        <div
          className={cn(
            "absolute left-0 top-0 h-full flex items-center pl-1",
            "md:opacity-0 group-data-[state=expanded]:opacity-100",
            "cursor-grab touch-none active:cursor-grabbing"
          )}
          {...attributes}
          {...listeners}
        >
          <LuGripVertical className="w-3 h-3 text-muted-foreground" />
        </div>

        <module.icon className="absolute left-8 top-3 flex items-center justify-center" />

        <span
          className={cn(
            "text-sm truncate",
            "absolute left-12 right-20 group-data-[state=expanded]:left-16",
            "md:opacity-0 group-data-[state=expanded]:opacity-100"
          )}
        >
          {module.name}
        </span>

        {/* Opens the sub-modules. Covers the row between the grip and the eye. */}
        {groups.length > 0 && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={t`Sub-modules of ${module.name}`}
            onClick={() => onToggleOpen(module.key)}
            className={cn(
              "absolute inset-y-0 left-7 right-8 rounded",
              "md:opacity-0 group-data-[state=expanded]:opacity-100"
            )}
          >
            <span className="absolute inset-y-0 right-1 flex items-center gap-1.5 text-muted-foreground">
              {isOpen ? (
                <LuChevronDown aria-hidden className="w-3.5 h-3.5" />
              ) : (
                <LuChevronRight aria-hidden className="w-3.5 h-3.5" />
              )}
              {/* A fixed slot, so the arrow stays put when the count appears. */}
              <span className="w-4 text-center text-xs leading-none tabular-nums">
                {hiddenCount > 0 ? hiddenCount : null}
              </span>
            </span>
          </button>
        )}

        {/* Hide button */}
        <button
          type="button"
          aria-label={t`Hide ${module.name}`}
          onClick={() => onToggleHidden(module.key)}
          className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded",
            "md:opacity-0 group-data-[state=expanded]:opacity-100",
            "text-muted-foreground hover:text-foreground",
            "transition-opacity"
          )}
        >
          <LuEye className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
      {isOpen && (
        <SubmoduleTree
          moduleName={module.name}
          groups={groups}
          hidden={hidden}
          order={module.submoduleOrder}
          onSetHidden={(keys, isHidden) =>
            onSetSubmodulesHidden(module.key, keys, isHidden)
          }
          onReorder={(keys) => onSetSubmoduleOrder(module.key, keys)}
        />
      )}
    </div>
  );
}
