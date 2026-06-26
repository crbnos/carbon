"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";
import { forwardRef, isValidElement } from "react";

import { cn } from "./utils/cn";

/**
 * Base UI Tooltip wrapped to preserve the Radix-compatible API the codebase
 * already uses (`Tooltip` / `TooltipTrigger asChild` / `TooltipContent side=…`).
 *
 * Why Base UI: Radix's Tooltip swallowed the first click on a trigger that was
 * also a modal Dialog/Drawer trigger (tooltip open → focus/pointer fight on
 * close), so hovering an icon button then clicking it did nothing. Base UI's
 * tooltip composes cleanly with other triggers.
 *
 * Delay: the old Radix wrapper forced `delayDuration = 0` on every tooltip
 * (instant). Base UI's Trigger defaults to 600ms, so each Root is wrapped in a
 * Provider whose `delay` defaults to 0 to keep the original snappy behavior.
 */

type ProviderProps = TooltipPrimitive.Provider.Props & {
  /** Radix-compat alias for Base UI's `delay`. */
  delayDuration?: number;
};

const TooltipProvider = ({ delayDuration, delay, ...props }: ProviderProps) => (
  <TooltipPrimitive.Provider delay={delay ?? delayDuration ?? 0} {...props} />
);
TooltipProvider.displayName = "TooltipProvider";

type RootProps = TooltipPrimitive.Root.Props & {
  /** Radix-compat alias; mapped to the surrounding Provider's `delay`. */
  delayDuration?: number;
};

const Tooltip = ({ delayDuration = 50, ...props }: RootProps) => (
  <TooltipPrimitive.Provider delay={delayDuration}>
    <TooltipPrimitive.Root {...props} />
  </TooltipPrimitive.Provider>
);
Tooltip.displayName = "Tooltip";

type TriggerProps = TooltipPrimitive.Trigger.Props & {
  /** Radix-compat: render the single child as the trigger element. */
  asChild?: boolean;
};

const TooltipTrigger = forwardRef<HTMLButtonElement, TriggerProps>(
  ({ asChild, children, ...props }, ref) => {
    if (asChild && isValidElement(children)) {
      return (
        <TooltipPrimitive.Trigger
          ref={ref}
          render={children as ReactElement}
          {...props}
        />
      );
    }
    return (
      <TooltipPrimitive.Trigger ref={ref} {...props}>
        {children}
      </TooltipPrimitive.Trigger>
    );
  }
);
TooltipTrigger.displayName = "TooltipTrigger";

type ContentProps = TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset"
  >;

const TooltipContent = forwardRef<HTMLDivElement, ContentProps>(
  (
    {
      className,
      side = "top",
      sideOffset = 4,
      align = "center",
      alignOffset = 0,
      ...props
    },
    ref
  ) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="z-50"
      >
        <TooltipPrimitive.Popup
          ref={ref}
          className={cn(
            "z-50 w-fit max-w-xs overflow-hidden rounded-md border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
            "origin-[var(--transform-origin)] transition-[transform,opacity] duration-150",
            "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
);
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
