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
  "inline-flex items-center rounded-md px-2 min-h-[1.25rem] font-medium transition-[color,box-shadow] border focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 font-bold text-[11px] uppercase truncate tracking-tight whitespace-nowrap",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow:sm dark:shadow hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "bg-destructive text-destructive-foreground shadow:sm dark:shadow hover:bg-destructive/80",
        outline: "text-foreground border border-border",
        green:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-500/20",
        yellow:
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-400 border-yellow-500/20",
        orange:
          "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-400 border-orange-500/20",
        red: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400 border-red-500/20",
        blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400 border-blue-500/20",
        gray: "bg-[#e3e2e080] text-[#32302c] dark:bg-[#373737] dark:text-white hover:bg-[#e3e2e0] dark:hover:bg-[#5a5a5a] ",
        purple:
          "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-400 border-violet-500/20"
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
