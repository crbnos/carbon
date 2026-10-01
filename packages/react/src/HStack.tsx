// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { forwardRef } from "react";
import { cn } from "./utils/cn";

const hStackVariants = cva("flex items-center", {
  variants: {
    spacing: {
      0: "space-x-0",
      1: "space-x-1",
      2: "space-x-2",
      3: "space-x-3",
      4: "space-x-4",
      6: "space-x-6",
      8: "space-x-8"
    }
  },
  defaultVariants: {
    spacing: 2
  }
});

export interface HStackProps
  extends ComponentProps<"div">,
    VariantProps<typeof hStackVariants> {}

const HStack = forwardRef<HTMLDivElement, HStackProps>(
  ({ className, children, spacing, ...props }, ref) => {
    return (
      <div
        className={cn(
          hStackVariants({
            spacing,
            className
          })
        )}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  }
);
HStack.displayName = "HStack";

export { HStack };
