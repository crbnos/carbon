import { cn } from "@carbon/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LuEyeOff, LuGripVertical } from "react-icons/lu";
import type { DraftModule } from "./useNavigationEditMode";

type SortableNavItemProps = {
  module: DraftModule;
  isOpen: boolean;
  onToggleHidden: (key: string) => void;
};

export function SortableNavItem({
  module,
  isOpen,
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
        "relative",
        "h-10 w-10 group-data-[state=expanded]:w-full",
        "flex items-center rounded-md",
        "group-data-[state=collapsed]:justify-center",
        "group-data-[state=expanded]:-space-x-2",
        "font-medium shrink-0 inline-flex select-none",
        "transition-[background-color,color,width] duration-100 ease-out",
        "hover:bg-accent hover:text-accent-foreground",
        "border border-transparent",
        isDragging && "opacity-50 border-primary",
        "group/item"
      )}
    >
      {/* Drag handle */}
      <div
        className={cn(
          "absolute left-0 top-0 h-full flex items-center pl-1",
          "opacity-0 group-data-[state=expanded]:opacity-100",
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
          "opacity-0 group-data-[state=expanded]:opacity-100"
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
          "opacity-0 group-data-[state=expanded]:opacity-100",
          "text-muted-foreground hover:text-foreground",
          "transition-opacity"
        )}
      >
        <LuEyeOff className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
