import { cva, type VariantProps } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
} from "react";
import { forwardRef } from "react";
import { MdClose } from "react-icons/md";

import { cn } from "./utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 h-6 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 truncate",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        green:
          "border-transparent bg-[#dbeddb] text-[#1c3829] dark:bg-[#2b593f] dark:text-white",
        yellow:
          "border-transparent bg-[#f9e4bc] text-[#402c1b] dark:bg-[#835e33] dark:text-white",
        orange:
          "border-transparent bg-[#fadec9] text-[#49290e] dark:bg-[#854c1d] dark:text-white",
        red: "border-transparent bg-[#ffe2dd] text-[#5d1715] dark:bg-[#6e3630] dark:text-white",
        blue: "border-transparent bg-[#d3e5ef] text-[#183347] dark:bg-[#28456c] dark:text-white",
        gray: "border-transparent bg-[#e3e2e080] text-[#32302c] dark:bg-[#373737] dark:text-white hover:bg-[#e3e2e0] dark:hover:bg-[#5a5a5a]",
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
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

const BadgeCloseButton = forwardRef<
  ElementRef<"button">,
  ComponentPropsWithoutRef<"button">
>(({ className, ...props }, ref) => (
  <button
    className={cn(
      "ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-muted-foreground hover:text-foreground",
      className
    )}
    {...props}
  >
    <MdClose className="h-3 w-3 " />
  </button>
));
BadgeCloseButton.displayName = "BadgeCloseButton";
export { Badge, BadgeCloseButton, badgeVariants };
