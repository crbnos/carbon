// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
  isDisabled = false,
  title,
  className
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: () => void;
  withIcon?: boolean;
  // Shown, not changeable; `title` says why.
  isDisabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isDisabled}
      title={title}
      className={cn(
        "shrink-0 cursor-pointer active:scale-[0.96] transition-transform disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
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
