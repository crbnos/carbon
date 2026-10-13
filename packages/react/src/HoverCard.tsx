// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { Slot } from "@radix-ui/react-slot";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";
import { ActionPresentationBoundary } from "./ActionPresentation";
import { BottomSheet, BottomSheetTrigger } from "./BottomSheet";
import { PopupSheetContent } from "./PopupSheet";
import { cn } from "./utils/cn";
import { useViewport } from "./Viewport";

/*
 * Phones cannot hover: there a hover card is a real bottom sheet (a Radix
 * Dialog) that a tap on the trigger opens. Desktop keeps hover.
 */
const HoverCard = ({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof HoverCardPrimitive.Root>) => {
  const { isPhone } = useViewport();
  return isPhone ? (
    <BottomSheet
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
    >
      {children}
    </BottomSheet>
  ) : (
    <HoverCardPrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    >
      {children}
    </HoverCardPrimitive.Root>
  );
};

const HoverCardTrigger = forwardRef<
  ElementRef<typeof HoverCardPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof HoverCardPrimitive.Trigger>
>(({ asChild, ...props }, ref) => {
  const { isPhone } = useViewport();
  if (!isPhone) {
    return (
      <HoverCardPrimitive.Trigger ref={ref} asChild={asChild} {...props} />
    );
  }
  // The desktop trigger is an <a>; a tap must open the sheet, not follow it.
  const Comp = asChild ? Slot : "a";
  return (
    <BottomSheetTrigger asChild>
      <Comp
        ref={ref}
        {...props}
        onClick={(event) => {
          props.onClick?.(event);
          event.preventDefault();
        }}
      />
    </BottomSheetTrigger>
  );
});
HoverCardTrigger.displayName = HoverCardPrimitive.Trigger.displayName;

const HoverCardContent = forwardRef<
  ElementRef<typeof HoverCardPrimitive.Content>,
  ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(
  (
    { className, align = "center", sideOffset = 4, children, ...props },
    ref
  ) => {
    const { isPhone } = useViewport();
    if (isPhone) {
      return (
        <PopupSheetContent
          ref={ref}
          label={props["aria-label"]}
          className={className}
          {...props}
        >
          {children}
        </PopupSheetContent>
      );
    }
    return (
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "relative z-[100] origin-(--radix-hover-card-content-transform-origin) w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className
          )}
          {...props}
        >
          <ActionPresentationBoundary>{children}</ActionPresentationBoundary>
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    );
  }
);
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardContent, HoverCardTrigger };
