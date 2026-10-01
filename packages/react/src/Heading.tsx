// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

// The headline face is for page-level titles only. h4 is the compact size
// record headers (job, picking list, orders) and in-app cards use, so it stays
// in the body font alongside the UI chrome around it.
const headingVariants = cva(
  "font-medium leading-[1.1] tracking-tight text-foreground text-balance",
  {
    variants: {
      size: {
        display: "font-headline md:text-[44px] text-[36px]",
        h1: "font-headline md:text-3xl text-2xl",
        h2: "font-headline md:text-2xl text-xl",
        h3: "font-headline md:text-xl text-base",
        h4: "md:text-base text-sm"
      },
      noOfLines: {
        1: "line-clamp-1",
        2: "line-clamp-2",
        3: "line-clamp-3",
        4: "line-clamp-4",
        5: "line-clamp-5",
        6: "line-clamp-6",
        7: "line-clamp-7",
        8: "line-clamp-8",
        9: "line-clamp-9",
        10: "line-clamp-10"
      }
    },
    defaultVariants: {
      size: "h2"
    }
  }
);

export interface HeadingProps
  extends ComponentProps<"h2">,
    VariantProps<typeof headingVariants> {
  as?: ElementType;
}

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ as = "h2", className, noOfLines, size, children, ...props }, ref) => {
    const Component = as;
    return (
      <Component
        className={cn(
          headingVariants({
            size,
            noOfLines,
            className
          })
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Component>
    );
  }
);
Heading.displayName = "Heading";

export { Heading };
