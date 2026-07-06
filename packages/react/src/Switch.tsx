"use client";

import * as SwitchPrimitives from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const variations = {
  large: {
    container: "gap-x-2 rounded-md px-1 py-0.5",
    root: "h-6 w-11 p-0.5",
    thumb:
      "size-5 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
    text: "text-sm"
  },
  small: {
    container: "gap-x-2 rounded px-0.5 py-0.5",
    root: "h-4 w-7 p-0.5",
    thumb:
      "size-3 data-[state=checked]:translate-x-3 data-[state=unchecked]:translate-x-0",
    text: "text-xs"
  }
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
      className={cn(
        "group flex items-center transition-colors focus-visible:outline-none",
        container,
        className
      )}
      {...props}
      ref={ref}
    >
      <div
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-all outline-none group-focus-visible:border-ring group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50 group-disabled:cursor-not-allowed group-disabled:opacity-50 group-data-[state=checked]:bg-primary group-data-[state=unchecked]:bg-input dark:group-data-[state=unchecked]:bg-input/80",
          root
        )}
      >
        <SwitchPrimitives.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-background shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground",
            thumb
          )}
        />
      </div>
      {label ? (
        <div
          className={cn("cursor-pointer select-none whitespace-nowrap", text)}
        >
          {label}
        </div>
      ) : null}
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
