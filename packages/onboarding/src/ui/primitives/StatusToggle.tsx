// Binary status pill button (validated / in-scope / done toggles). Active =
// emerald, inactive = muted. `withIcon` shows a check when active (the
// "Validated / Not yet" style); off gives the compact "In scope / Out" style.

import { cn } from "@carbon/react";
import { LuCheck } from "react-icons/lu";

export function StatusToggle({
  active,
  activeLabel,
  inactiveLabel,
  onToggle,
  withIcon = true,
  className
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: () => void;
  withIcon?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full text-xs font-medium active:scale-[0.96] transition-transform",
        withIcon ? "pl-2 pr-2.5 py-1" : "px-2.5 py-0.5",
        active
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border text-muted-foreground",
        className
      )}
    >
      {withIcon ? (
        active ? (
          <LuCheck className="size-3" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        )
      ) : null}
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}
