// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./utils/cn";

const pulseVariants = cva("", {
  variants: {
    variant: {
      amber: "text-amber-500",
      green: "text-emerald-500",
      yellow: "text-yellow-500",
      orange: "text-orange-500",
      red: "text-red-500",
      blue: "text-blue-500",
      gray: "text-gray-500",
      purple: "text-violet-500"
    }
  },
  defaultVariants: {
    variant: "green"
  }
});

type PulseVariants = VariantProps<typeof pulseVariants>;

export function PulsingDot({
  inactive,
  variant,
  className,
  label,
  ...props
}: ComponentProps<"span"> & {
  inactive?: boolean;
  /**
   * What the dot means ("Urgent", "Blocked", "Unread"). Without it the dot is
   * decoration and hidden from assistive technology; with it, an image so
   * named — colour alone tells a screen reader nothing.
   */
  label?: string;
} & PulseVariants) {
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };
  props = { ...a11y, ...props };
  if (inactive) {
    return (
      <span
        className={cn(
          "w-2 h-2 rounded-full bg-current",
          pulseVariants({ variant }),
          className
        )}
        {...props}
      />
    );
  }

  return (
    <span
      className={cn(
        "relative flex h-2 w-2",
        pulseVariants({ variant }),
        className
      )}
      {...props}
    >
      <span className="absolute h-full w-full animate-ping rounded-full border border-current opacity-100 duration-1000 [animation-iteration-count:1] [animation-fill-mode:forwards]" />
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
