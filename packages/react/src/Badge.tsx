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
        green: "border-transparent bg-green-100 text-green-800",
        yellow: "border-transparent bg-yellow-100 text-yellow-800",
        orange: "border-transparent bg-orange-100 text-orange-800",
        red: "border-transparent bg-red-100 text-red-800",
        blue: "border-transparent bg-blue-100 text-blue-800",
        gray: "border-transparent bg-muted hover:bg-muted/80",
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
