import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { LuCheck, LuMinus } from "react-icons/lu";

import { cn } from "./utils/cn";

export interface CheckboxProps
  extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  isChecked?: boolean;
  isIndeterminate?: boolean;
}

const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ isChecked, isIndeterminate, className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-4 shrink-0 rounded-[4px] border border-muted-foreground/50 shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary",
      isIndeterminate && "bg-primary text-primary-foreground",
      className
    )}
    {...props}
    checked={typeof isChecked === "boolean" ? isChecked : props.checked}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current transition-none")}
    >
      {isIndeterminate ? (
        <LuMinus className="w-4 h-4" />
      ) : (
        <LuCheck className="w-4 h-4" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
