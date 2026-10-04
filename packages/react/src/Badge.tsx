// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes
} from "react";
import { forwardRef } from "react";

import { LuX } from "react-icons/lu";
import { cn } from "./utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 min-h-6 text-sm leading-5 font-medium tracking-tight whitespace-nowrap truncate border border-transparent transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-black/[0.08] bg-transparent text-foreground/70 dark:text-secondary-foreground dark:border-border",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "border-border text-foreground",
        green:
          "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/20",
        yellow:
          "border-yellow-600/25 bg-yellow-500/15 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-400 dark:border-yellow-500/20",
        orange:
          "border-orange-600/20 bg-orange-500/10 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/20",
        red: "border-red-600/20 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/20",
        blue: "border-blue-600/20 bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/20",
        gray: "border-black/[0.08] bg-black/[0.04] text-foreground/70 dark:bg-[#373737] dark:text-white dark:border-border",
        purple:
          "border-violet-600/20 bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/20"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant }), "min-w-0", className)}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

const BadgeCloseButton = forwardRef<
  ElementRef<"button">,
  ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    className={cn(
      "relative ml-1 rounded-full outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 text-muted-foreground hover:text-foreground flex-shrink-0 before:absolute before:-inset-2 before:content-['']",
      className
    )}
    {...props}
  >
    <LuX className="h-3 w-3" />
  </button>
));
BadgeCloseButton.displayName = "BadgeCloseButton";
export { Badge, BadgeCloseButton, badgeVariants };
