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
import { DialogRoot, useDialogDismissable } from "./DialogRoot";
import { cn } from "./utils/cn";
import {
  keepOpenOnToast,
  refusesDragDismiss,
  startsSheetDrag
} from "./utils/dialog";
import {
  addDragSample,
  type DragSample,
  releaseVelocity,
  rubberBand,
  shouldDismissSheet
} from "./utils/drag";
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
    data-backdrop=""
    className={cn(
      "fixed inset-0 z-[70] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      // Content marked `data-clear-backdrop` leaves the page behind it
      // undimmed, as `ModalOverlay` does.
      "[&:has(+[data-clear-backdrop])]:bg-transparent",
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
  /** Shows the phone close button; off, it still closes by drag or outside. */
  withCloseButton?: boolean;
};

const SHEET_SPRING = "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)";
const BACKDROP_SPRING = "opacity 200ms cubic-bezier(0.32, 0.72, 0, 1)";
const OVERDRAG_LIMIT_PX = 32;
const DRAG_SLOP_PX = 4;

function restore(sheet: HTMLElement, backdrop: HTMLElement | null) {
  sheet.style.transform = "";
  sheet.style.removeProperty("--tw-exit-translate-y");
  if (backdrop) backdrop.style.opacity = "";
}

const BottomSheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(
  (
    { className, children, size = "auto", withCloseButton = true, ...props },
    ref
  ) => {
    const { t } = useLingui();
    const { isPhone } = useViewport();
    const onOpenAutoFocus = usePhoneOpenAutoFocus(props.onOpenAutoFocus);
    const dismissable = useDialogDismissable();
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const drag = useRef<{
      startY: number;
      height: number;
      samples: DragSample[];
      moved: boolean;
    } | null>(null);
    const canDrag = isPhone && dismissable;

    // Phones: drag the grabber down to dismiss, past a third of the sheet or
    // with a flick; a shorter drag springs back.
    const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
      const sheet = sheetRef.current;
      drag.current = null;
      if (!canDrag || !sheet || event.button !== 0) return;
      if (!startsSheetDrag(event.target, sheet)) return;
      drag.current = {
        startY: event.clientY,
        height: sheet.offsetHeight,
        samples: [{ y: event.clientY, t: event.timeStamp }],
        moved: false
      };
    };
    const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      const sheet = sheetRef.current;
      if (!state || !sheet) return;
      const delta = event.clientY - state.startY;
      // Take the pointer only once it moves: captured on the press, the click
      // of a tap would go to the panel, not to what is under it in the header.
      if (!state.moved) {
        // Released outside the sheet before it moved: no drag to resume.
        if (event.buttons === 0) {
          drag.current = null;
          return;
        }
        if (Math.abs(delta) < DRAG_SLOP_PX) return;
        state.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        sheet.style.transition = "none";
        if (backdropRef.current) backdropRef.current.style.transition = "none";
      }
      const offset = delta < 0 ? -rubberBand(-delta, OVERDRAG_LIMIT_PX) : delta;
      sheet.style.transform = `translateY(${offset}px)`;
      if (backdropRef.current) {
        backdropRef.current.style.opacity = String(
          1 - Math.min(1, Math.max(0, offset) / state.height)
        );
      }
      state.samples = addDragSample(state.samples, {
        y: event.clientY,
        t: event.timeStamp
      });
    };
    const onDragEnd = (event: PointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      const sheet = sheetRef.current;
      const backdrop = backdropRef.current;
      drag.current = null;
      if (!state?.moved || !sheet) return;
      const offset = Math.max(0, event.clientY - state.startY);
      sheet.style.transition = SHEET_SPRING;
      if (backdrop) backdrop.style.transition = BACKDROP_SPRING;
      if (
        event.type === "pointerup" &&
        shouldDismissSheet({
          offset,
          height: state.height,
          velocity: releaseVelocity(state.samples, event.timeStamp)
        }) &&
        // A dialog that stays open on a press outside stays open on a drag.
        !refusesDragDismiss(sheet, event.nativeEvent, [
          props.onPointerDownOutside,
          props.onInteractOutside
        ])
      ) {
        // Reduced motion zeroes the exit movement, which would slide the sheet
        // back up before it closes.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          sheet.style.setProperty(
            "--tw-exit-translate-y",
            `${offset}px`,
            "important"
          );
        }
        // The exit animation starts from where the finger left the sheet.
        closeRef.current?.click();
        // A controlled sheet may refuse to close.
        requestAnimationFrame(() => {
          if (sheet.dataset.state === "open") restore(sheet, backdrop);
        });
      } else {
        restore(sheet, backdrop);
      }
    };

    return (
      <ClientOnly fallback={null}>
        {() => (
          <DialogPrimitive.Portal>
            <BottomSheetOverlay ref={backdropRef} />
            <DialogPrimitive.Content
              ref={mergeRefs(ref, sheetRef)}
              className={cn(
                "fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl bg-background shadow-lg data-[state=open]:duration-300 data-[state=closed]:duration-200",
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                "motion-reduce:data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:fade-in-0",
                // Phones: a sheet settles in on the iOS curve and leaves faster.
                "max-md:ease-drawer",
                "max-md:max-h-[88dvh] max-md:rounded-t-[14px] max-md:bg-popover max-md:pb-safe",
                // Fills the gap under a sheet dragged up. A shadow, not a box:
                // a box below the panel would scroll into view with it.
                "max-md:shadow-[0_2.5rem_0_0_var(--color-popover)]",
                size === "full" &&
                  "max-md:h-[calc(100dvh-env(safe-area-inset-top)-12px)] max-md:max-h-none",
                className
              )}
              {...props}
              // Its header takes touches for the drag (`sheetHeaderClassName`).
              data-sheet-draggable={canDrag ? "" : undefined}
              onOpenAutoFocus={onOpenAutoFocus}
              onInteractOutside={keepOpenOnToast(props.onInteractOutside)}
              // On the panel, so the header drags it too (`startsSheetDrag`).
              onPointerDown={(event) => {
                props.onPointerDown?.(event);
                onDragStart(event);
              }}
              onPointerMove={(event) => {
                props.onPointerMove?.(event);
                onDragMove(event);
              }}
              onPointerUp={(event) => {
                props.onPointerUp?.(event);
                onDragEnd(event);
              }}
              onPointerCancel={(event) => {
                props.onPointerCancel?.(event);
                onDragEnd(event);
              }}
            >
              <div
                aria-hidden
                data-sheet-grabber=""
                className={cn(
                  "flex shrink-0 justify-center pt-3 pb-2 max-md:pt-2 max-md:pb-1",
                  canDrag && "touch-none cursor-grab active:cursor-grabbing"
                )}
              >
                <div className="h-1.5 w-12 rounded-full bg-muted-foreground/20 max-md:h-[5px] max-md:w-9" />
              </div>
              <ActionPresentationBoundary>
                {children}
              </ActionPresentationBoundary>
              {isPhone && dismissable && (
                <DialogPrimitive.Close
                  ref={closeRef}
                  // Hidden, not removed: a drag closes the sheet by clicking it.
                  hidden={!withCloseButton}
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
  }
);
BottomSheetContent.displayName = "BottomSheetContent";

/**
 * Phones: what a sheet's header, title and footer look like. `Modal` and
 * `Drawer` are bottom sheets on phones too and use the same, so every sheet
 * reads alike.
 */
export const sheetHeaderClassName =
  "max-md:relative max-md:flex max-md:min-h-11 max-md:shrink-0 max-md:items-center max-md:justify-center max-md:px-14 max-md:pb-2 max-md:[[data-sheet-draggable]_&]:touch-none max-md:[[data-sheet-draggable]_&]:select-none";
export const sheetTitleClassName =
  "max-md:truncate max-md:text-[1.0625rem] max-md:font-semibold max-md:text-foreground";
export const sheetFooterClassName =
  "max-md:sticky max-md:bottom-0 max-md:border-t max-md:border-border max-md:bg-popover max-md:px-4 max-md:pt-3 max-md:pb-4";

const BottomSheetHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-bottom-sheet-header=""
    className={cn("px-6 pb-2 text-center", sheetHeaderClassName, className)}
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
      sheetFooterClassName,
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
      sheetTitleClassName,
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
  "relative flex min-h-12 w-full select-none items-center gap-3 rounded-sm px-3 text-left text-[0.9375rem] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

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
