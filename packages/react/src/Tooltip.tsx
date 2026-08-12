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
  > & {
    /**
     * Portal to `document.body` and paint above other overlays. Opt in only for a
     * tooltip inside a popover that already sits above the default layer — the
     * default `z-50` deliberately stays below modals, drawers and the palette.
     */
    elevated?: boolean;
  };

/** Anchor arrow pointing at the trigger; render as a child of TooltipContent. */
const TooltipArrow = (props: TooltipPrimitive.Arrow.Props) => (
  <TooltipPrimitive.Arrow
    {...props}
    className={cn(
      "flex data-[side=bottom]:top-[-8px] data-[side=left]:right-[-13px] data-[side=left]:rotate-90 data-[side=right]:left-[-13px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-8px] data-[side=top]:rotate-180",
      props.className as string
    )}
  >
    <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
      <path
        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
        className="fill-popover"
      />
      <path
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2997 9 16.1082 8.54278 15.1901 7.71648L10.3333 3.34539Z"
        className="fill-border"
      />
    </svg>
  </TooltipPrimitive.Arrow>
);
TooltipArrow.displayName = "TooltipArrow";

const TooltipContent = forwardRef<HTMLDivElement, ContentProps>(
  (
    {
      className,
      side = "top",
      sideOffset = 4,
      align = "center",
      alignOffset = 0,
      elevated = false,
      ...props
    },
    ref
  ) => (
    <TooltipPrimitive.Portal
      container={
        elevated && typeof document !== "undefined" ? document.body : undefined
      }
    >
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className={elevated ? "z-[9999]" : "z-50"}
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

export {
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
};
