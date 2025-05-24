import { cva, type VariantProps } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";

import { LuX } from "react-icons/lu";
import { cn } from "./utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 min-h-[1.25rem] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 uppercase font-bold text-[11px] truncate tracking-tight whitespace-nowrap",
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
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-400",
        yellow:
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300",
        orange:
          "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300",
        red: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-400",
        blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-400",
        gray: "bg-[#e3e2e080] text-[#32302c] dark:bg-[#373737] dark:text-white hover:bg-[#e3e2e0] dark:hover:bg-[#5a5a5a]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), "min-w-0", className)}
      {...props}
    />
  );
}

const BadgeCloseButton = forwardRef<
  ElementRef<"button">,
  ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    className={cn(
      "ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-muted-foreground hover:text-foreground flex-shrink-0",
      className
    )}
    {...props}
  >
    <LuX className="h-3 w-3 " />
  </button>
));
BadgeCloseButton.displayName = "BadgeCloseButton";
export { Badge, BadgeCloseButton, badgeVariants };
