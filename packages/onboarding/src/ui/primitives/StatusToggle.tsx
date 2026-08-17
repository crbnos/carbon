// Binary status pill button (validated / in-scope / done toggles). Renders the
// design-system `Badge` (green when active, outline when inactive) inside a
// button so the toggle stays interactive. `withIcon` shows a check when active
// (the "Validated / Not yet" style); off gives the compact "In scope / Out" style.

import { Badge, cn } from "@carbon/react";
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
        "shrink-0 cursor-pointer active:scale-[0.96] transition-transform",
        className
      )}
    >
      <Badge variant={active ? "green" : "outline"} className="gap-1.5">
        {withIcon ? (
          active ? (
            <LuCheck className="size-3" />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/50" />
          )
        ) : null}
        {active ? activeLabel : inactiveLabel}
      </Badge>
    </button>
  );
}
