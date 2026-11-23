// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
            "h-10 w-10 group-data-[state=expanded]:w-full",
            "flex items-center justify-center gap-2 rounded-md",
            "font-medium shrink-0 inline-flex select-none overflow-hidden",
            "text-muted-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "transition-[background-color,color,width] duration-100 ease-out"
          )}
        >
          <LuPlus className="shrink-0" />
          <span className="text-sm whitespace-nowrap md:group-data-[state=collapsed]:hidden">
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
