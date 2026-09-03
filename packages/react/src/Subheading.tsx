import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const subheadingVariants = cva("uppercase tracking-wide", {
  variants: {
    variant: {
      heavy: "text-xs font-medium text-muted-foreground",
      light: "text-[11px]/[13px] font-light text-foreground/70"
    }
  },
  defaultVariants: {
    variant: "heavy"
  }
});

export interface SubheadingProps
  extends Omit<ComponentProps<"span">, "color">,
    VariantProps<typeof subheadingVariants> {}

/**
 * Small uppercase label that groups related content into a section.
 *
 * - `heavy` (default): section labels for accounting reports and similar
 *   `text-muted-foreground` eyebrow headings.
 * - `light`: group names in the grouped-content sidebar and entity Properties
 *   panels.
 *
 * Spacing/layout is left to the caller — pass `className` for margins, flex, etc.
 */
const Subheading = forwardRef<HTMLSpanElement, SubheadingProps>(
  ({ className, variant, children, ...props }, ref) => {
    return (
      <span
        className={cn(subheadingVariants({ variant, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </span>
    );
  }
);
Subheading.displayName = "Subheading";

export { Subheading, subheadingVariants };
