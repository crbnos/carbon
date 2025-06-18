import type { ComponentProps } from "react";
import { cn } from "./utils/cn";

export function PulsingDot({
  inactive,
  className,
  ...props
}: ComponentProps<"span"> & { inactive?: boolean }) {
  if (inactive) {
    return (
      <span
        className={cn("w-2 h-2 bg-muted rounded-full bg-red-500", className)}
        {...props}
      />
    );
  }

  return (
    <span className={cn("relative flex h-2 w-2", className)} {...props}>
      <span
        className={`absolute h-full w-full animate-ping rounded-full border border-emerald-500 opacity-100 duration-1000`}
      />
      <span className={`h-2 w-2 rounded-full bg-emerald-500`} />
    </span>
  );
}
