import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps, ElementType } from "react";
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
    VariantProps<typeof subheadingVariants> {
  /**
   * The element to render. Defaults to `span` (inline, no document semantics).
   * Pass a heading tag (`"h2"`/`"h3"`/`"h4"`) when the label is a real section
   * heading so it stays in the heading outline / screen-reader navigation.
   */
  as?: ElementType;
}

/**
 * Small uppercase label that groups related content into a section.
 *
 * - `heavy` (default): section labels for accounting reports and similar
 *   `text-muted-foreground` eyebrow headings.
 * - `light`: group names in the grouped-content sidebar and entity Properties
 *   panels.
 *
 * Renders a `span` by default; pass `as="h3"` (etc.) to preserve native heading
 * semantics. Spacing/layout is left to the caller — pass `className` for
 * margins, flex, etc.
 */
const Subheading = forwardRef<HTMLElement, SubheadingProps>(
  ({ as: Component = "span", className, variant, children, ...props }, ref) => {
    return (
      <Component
        className={cn(subheadingVariants({ variant, className }))}
        ref={ref}
        {...props}
      >
        {children}
      </Component>
    );
  }
);
Subheading.displayName = "Subheading";

export { Subheading, subheadingVariants };
