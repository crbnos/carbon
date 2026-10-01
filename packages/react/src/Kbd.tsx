// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { cn } from "./utils/cn";

const Kbd = forwardRef<ElementRef<"kbd">, ComponentPropsWithoutRef<"kbd">>(
  ({ className, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "bg-muted text-foreground rounded-md border border-input border-b-[3px] text-[0.8em] font-mono font-bold px-[0.8em] whitespace-nowrap",
          className
        )}
        {...props}
      />
    );
  }
);
Kbd.displayName = "Kbd";

export { Kbd };
