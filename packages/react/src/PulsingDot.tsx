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
  ...props
}: ComponentProps<"span"> & { inactive?: boolean } & PulseVariants) {
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
      <span className="absolute h-full w-full animate-ping rounded-full border border-current opacity-100 duration-1000" />
      <span className="h-2 w-2 rounded-full bg-current" />
    </span>
  );
}
