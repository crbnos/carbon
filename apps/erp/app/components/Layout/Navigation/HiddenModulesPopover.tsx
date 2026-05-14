import { cn, Popover, PopoverContent, PopoverTrigger } from "@carbon/react";
import { LuPlus } from "react-icons/lu";
import type { DraftModule } from "./useNavigationEditMode";

type HiddenModulesPopoverProps = {
  hiddenModules: DraftModule[];
  onToggleHidden: (key: string) => void;
};

export function HiddenModulesPopover({
  hiddenModules,
  onToggleHidden
}: HiddenModulesPopoverProps) {
  if (hiddenModules.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative",
            "h-10 w-10 group-data-[state=expanded]:w-full",
            "flex items-center rounded-md",
            "group-data-[state=collapsed]:justify-center",
            "font-medium shrink-0 inline-flex select-none",
            "text-muted-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "transition-[background-color,color,width] duration-100 ease-out"
          )}
        >
          <LuPlus className="absolute left-3 top-3 flex items-center justify-center" />
          <span
            className={cn(
              "min-w-[128px] text-sm",
              "absolute left-7 group-data-[state=expanded]:left-12",
              "opacity-0 group-data-[state=expanded]:opacity-100"
            )}
          >
            Add module
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-48 p-1">
        {hiddenModules.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => onToggleHidden(m.key)}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-sm",
              "text-sm text-left",
              "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <m.icon className="w-4 h-4" />
            {m.name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
