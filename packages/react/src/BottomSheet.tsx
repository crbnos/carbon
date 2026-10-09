// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useLingui } from "@lingui/react/macro";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
  PointerEvent
} from "react";
import { forwardRef, useRef } from "react";
import { LuChevronLeft, LuX } from "react-icons/lu";

import { ActionPresentationBoundary } from "./ActionPresentation";
import { ClientOnly } from "./ClientOnly";
import { DialogRoot, useDialogDismissable } from "./Modal";
import { cn } from "./utils/cn";
import { mergeRefs } from "./utils/react";
import { usePhoneOpenAutoFocus, useViewport } from "./Viewport";

/**
 * A sheet that slides up from the bottom. Every compact (phone) sheet shares
 * this anatomy: grabber, header with optional Back and a close ×, a scrolling
 * body and a sticky footer above the safe area. The compact parts apply below
 * `md` (`max-md:`); wider viewports render the desktop dialog.
 */
const BottomSheet = DialogRoot;

const BottomSheetTrigger = DialogPrimitive.Trigger;

const BottomSheetClose = DialogPrimitive.Close;

const BottomSheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
BottomSheetOverlay.displayName = "BottomSheetOverlay";

type BottomSheetContentProps = ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** `auto` fits the content up to 88dvh; `full` covers the screen. */
  size?: "auto" | "full";
};

const SHEET_SPRING = "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)";
/** px per ms: a flick this fast dismisses whatever the distance. */
const FLICK_VELOCITY = 0.5;

const BottomSheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(({ className, children, size = "auto", ...props }, ref) => {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const onOpenAutoFocus = usePhoneOpenAutoFocus(props.onOpenAutoFocus);
  const dismissable = useDialogDismissable();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ startY: number; lastY: number; lastT: number } | null>(
    null
  );
  const canDrag = isPhone && dismissable;

  // Phones: drag the grabber down to dismiss, past a third of the sheet or
  // with a flick; a shorter drag springs back.
  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!canDrag || !sheetRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp
    };
    sheetRef.current.style.transition = "none";
  };
  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const sheet = sheetRef.current;
    if (!state || !sheet) return;
    const offset = Math.max(0, event.clientY - state.startY);
    sheet.style.transform = `translateY(${offset}px)`;
    drag.current = { ...state, lastY: event.clientY, lastT: event.timeStamp };
  };
  const onDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const sheet = sheetRef.current;
    drag.current = null;
    if (!state || !sheet) return;
    const offset = Math.max(0, event.clientY - state.startY);
    const velocity =
      (event.clientY - state.lastY) /
      Math.max(1, event.timeStamp - state.lastT);
    sheet.style.transition = SHEET_SPRING;
    if (offset > sheet.offsetHeight / 3 || velocity > FLICK_VELOCITY) {
      // The exit animation starts from where the finger left the sheet.
      closeRef.current?.click();
    } else {
      sheet.style.transform = "";
    }
  };

  return (
    <ClientOnly fallback={null}>
      {() => (
        <DialogPrimitive.Portal>
          <BottomSheetOverlay />
          <DialogPrimitive.Content
            ref={mergeRefs(ref, sheetRef)}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl bg-background shadow-lg duration-300",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              // Phones: a sheet settles in on the iOS curve and leaves faster.
              "max-md:ease-[cubic-bezier(0.32,0.72,0,1)] max-md:data-[state=open]:[animation-duration:300ms] max-md:data-[state=closed]:[animation-duration:200ms]",
              "max-md:max-h-[88dvh] max-md:rounded-t-[14px] max-md:bg-popover max-md:pb-safe",
              size === "full" &&
                "max-md:h-[calc(100dvh-env(safe-area-inset-top)-12px)] max-md:max-h-none",
              className
            )}
            {...props}
            onOpenAutoFocus={onOpenAutoFocus}
          >
            <div
              aria-hidden
              className={cn(
                "flex shrink-0 justify-center pt-3 pb-2 max-md:pt-2 max-md:pb-1",
                canDrag && "touch-none cursor-grab active:cursor-grabbing"
              )}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/20 max-md:h-[5px] max-md:w-9" />
            </div>
            <ActionPresentationBoundary>{children}</ActionPresentationBoundary>
            {isPhone && dismissable && (
              <DialogPrimitive.Close
                ref={closeRef}
                aria-label={t`Close`}
                className="absolute top-3 right-1 flex size-11 items-center justify-center rounded-full text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <LuX className="size-5" />
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </ClientOnly>
  );
});
BottomSheetContent.displayName = "BottomSheetContent";

const BottomSheetHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "px-6 pb-2 text-center",
      "max-md:relative max-md:flex max-md:min-h-11 max-md:shrink-0 max-md:items-center max-md:justify-center max-md:px-14 max-md:pb-2",
      className
    )}
    {...props}
  />
);
BottomSheetHeader.displayName = "BottomSheetHeader";

/** ‹ Back in a sheet header, for drill-in sheets. */
const BottomSheetBack = ({
  className,
  onClick
}: {
  className?: string;
  onClick: () => void;
}) => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-label={t`Back`}
      onClick={onClick}
      className={cn(
        "absolute left-1 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
    >
      <LuChevronLeft className="size-6" />
    </button>
  );
};
BottomSheetBack.displayName = "BottomSheetBack";

const BottomSheetBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "px-6 pb-6",
      "max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:px-4 max-md:pb-4",
      className
    )}
    {...props}
  />
);
BottomSheetBody.displayName = "BottomSheetBody";

/** Sticky footer of full-width buttons above the safe area. */
const BottomSheetFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky bottom-0 flex shrink-0 gap-2 border-t border-border bg-inherit px-4 pt-3 pb-4 [&>*]:flex-1",
      className
    )}
    {...props}
  />
);
BottomSheetFooter.displayName = "BottomSheetFooter";

const BottomSheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-sm font-medium text-muted-foreground",
      "max-md:truncate max-md:text-[17px] max-md:font-semibold max-md:text-foreground",
      className
    )}
    {...props}
  />
));
BottomSheetTitle.displayName = "BottomSheetTitle";

const BottomSheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
BottomSheetDescription.displayName = "BottomSheetDescription";

/** One 48pt row of a phone sheet: a menu item, an option or a link. */
const sheetRowClassName =
  "relative flex min-h-12 w-full select-none items-center gap-3 rounded-sm px-3 text-left text-[15px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** The uppercase label over a section of sheet rows. */
const SheetSectionLabel = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground",
      className
    )}
    {...props}
  />
));
SheetSectionLabel.displayName = "SheetSectionLabel";

export {
  BottomSheet,
  BottomSheetBack,
  BottomSheetBody,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger,
  SheetSectionLabel,
  sheetRowClassName
};
