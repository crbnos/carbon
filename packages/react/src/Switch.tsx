"use client";

import * as SwitchPrimitives from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const variations = {
  large: {
    container: "flex items-center gap-x-2 rounded-md hover:bg-muted transition",
    root: "h-6 w-11",
    thumb:
      "h-5 w-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
    text: "text-sm",
  },
  small: {
    container:
      "flex items-center gap-x-1.5 rounded hover:bg-muted py-[0.1rem] px-0 transition",
    root: "h-3 w-6",
    thumb:
      "h-2.5 w-2.5 data-[state=checked]:translate-x-2.5 data-[state=unchecked]:translate-x-0",
    text: "text-xs",
  },
};

type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
  variant?: keyof typeof variations;
  label?: string | React.ReactNode;
};

const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, label, variant, ...props }, ref) => {
  const { container, root, thumb, text } = variations[variant ?? "large"];

  return (
    <SwitchPrimitives.Root
      className={cn("group focus-visible:outline-none", container, className)}
      {...props}
      ref={ref}
    >
      {label ? (
        <label className={cn("whitespace-nowrap", text)}>
          {typeof label === "string" ? <span>{label}</span> : label}
        </label>
      ) : null}
      <div
        className={cn(
          "group-focus-visible:ring-ring group-focus-visible:ring-offset-background peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-disabled:cursor-not-allowed group-disabled:opacity-50 group-data-[state=checked]:bg-primary group-data-[state=unchecked]:bg-input focus-visible:outline-none",
          root,
          className
        )}
      >
        <SwitchPrimitives.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform",
            thumb
          )}
        />
      </div>
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
