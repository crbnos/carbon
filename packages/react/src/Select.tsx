// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronsUpDown,
  LuChevronUp
} from "react-icons/lu";
import { compactPart } from "./MenuSheet";
import {
  SelectSheetContent,
  SelectSheetGroup,
  SelectSheetItem,
  SelectSheetLabel,
  SelectSheetRoot,
  SelectSheetSeparator,
  SelectSheetTrigger,
  SelectSheetValue
} from "./SelectSheet";
import { cn } from "./utils/cn";
import { useViewport } from "./Viewport";

/*
 * Phones render each part from SelectSheet (a bottom sheet) instead of Radix's
 * select; see SelectSheet.tsx.
 */
const Select = (
  props: ComponentPropsWithoutRef<typeof SelectPrimitive.Root>
) =>
  useViewport().isPhone ? (
    <SelectSheetRoot {...props} />
  ) : (
    <SelectPrimitive.Root {...props} />
  );

const SelectGroup = compactPart(
  SelectPrimitive.Group,
  SelectSheetGroup,
  "SelectGroup"
);

const SelectValue = compactPart(
  SelectPrimitive.Value,
  SelectSheetValue,
  "SelectValue"
);

const selectTriggerVariants = cva(
  "bg-transparent text-foreground flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input shadow-xs transition-[color,box-shadow] data-[placeholder]:text-muted-foreground outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>span]:min-w-0 [&>span]:truncate",
  {
    variants: {
      size: {
        lg: "h-12 px-4 py-3 rounded-lg text-base space-x-4",
        md: "h-10 px-3 py-2 rounded-md text-sm space-x-3 max-md:h-11 max-md:text-base",
        sm: "h-8  px-3 py-2 rounded text-xs space-x-2 max-md:h-11 max-md:text-base"
      }
    },
    defaultVariants: {
      size: "md"
    }
  }
);

interface SelectTriggerProps
  extends ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {
  hideIcon?: boolean;
  inline?: boolean;
}

const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ size, className, children, hideIcon, inline, ...props }, ref) => {
  const { isPhone } = useViewport();
  const Trigger = isPhone ? SelectSheetTrigger : SelectPrimitive.Trigger;
  const icon = (
    <LuChevronsUpDown className="h-4 w-4 flex-shrink-0 opacity-50" />
  );
  return (
    <Trigger
      ref={ref}
      className={cn(!inline && selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      {!hideIcon && !inline ? (
        isPhone ? (
          icon
        ) : (
          <SelectPrimitive.Icon asChild>{icon}</SelectPrimitive.Icon>
        )
      ) : null}
    </Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <LuChevronUp />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <LuChevronDown />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

const DesktopSelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(
  (
    { className, children, position: positionProp = "popper", ...props },
    ref
  ) => {
    const position = positionProp;
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-50 origin-(--radix-select-content-transform-origin) max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          position={position}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] max-h-[300px] overflow-y-auto"
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  }
);
DesktopSelectContent.displayName = SelectPrimitive.Content.displayName;

const DesktopSelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase",
      className
    )}
    {...props}
  />
));
DesktopSelectLabel.displayName = SelectPrimitive.Label.displayName;

const DesktopSelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    /**
     * Secondary description shown under the label in the dropdown only. It sits
     * outside `ItemText`, so the collapsed trigger still shows just the label.
     */
    helper?: string;
    /** Right-aligned companion to `helper` (e.g. a shortcut or count). */
    helperRight?: string;
  }
>(({ className, children, helper, helperRight, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <LuCheck className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    {helper ? (
      <div className="flex flex-col min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate flex-1">{helper}</span>
          {helperRight && <span className="flex-shrink-0">{helperRight}</span>}
        </div>
      </div>
    ) : (
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    )}
  </SelectPrimitive.Item>
));
DesktopSelectItem.displayName = SelectPrimitive.Item.displayName;

const DesktopSelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
DesktopSelectSeparator.displayName = SelectPrimitive.Separator.displayName;

const SelectContent = compactPart(
  DesktopSelectContent,
  SelectSheetContent,
  "SelectContent"
);
const SelectLabel = compactPart(
  DesktopSelectLabel,
  SelectSheetLabel,
  "SelectLabel"
);
const SelectItem = compactPart(
  DesktopSelectItem,
  SelectSheetItem,
  "SelectItem"
);
const SelectSeparator = compactPart(
  DesktopSelectSeparator,
  SelectSheetSeparator,
  "SelectSeparator"
);

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
};
