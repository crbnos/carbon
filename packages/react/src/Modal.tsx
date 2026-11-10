// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes,
  KeyboardEvent
} from "react";
import { forwardRef, useEffect } from "react";

import { LuX } from "react-icons/lu";
import { ActionPresentationBoundary } from "./ActionPresentation";
import {
  BottomSheetContent,
  sheetFooterClassName,
  sheetHeaderClassName,
  sheetTitleClassName
} from "./BottomSheet";
import { ClientOnly } from "./ClientOnly";
import { DialogRoot, useDialogDismissable } from "./DialogRoot";
import { ReportDialogExit } from "./RouteDialogScope";
import { cn } from "./utils/cn";
import {
  keepOpenOnToast,
  returnFocusOnClose,
  trackPageFocus
} from "./utils/dialog";
import { useViewport } from "./Viewport";

// The root is shared with `Drawer` and `BottomSheet`, so it lives on its own:
// on phones `ModalContent` renders a `BottomSheetContent`.
export { DialogRoot, useDialogDismissable };

const Modal = DialogRoot;

const ModalTrigger = DialogPrimitive.Trigger;

const ModalPortal = DialogPrimitive.Portal;

const ModalClose = DialogPrimitive.Close;

const ModalOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // Only the top-most backdrop paints, so stacked modals keep one level of
    // dim (see `[data-backdrop]` in the shared theme.css).
    data-backdrop=""
    className={cn(
      "bg-black/40 backdrop-blur-xs",
      // Radix removes the content when this backdrop's animation ends, so the
      // two durations must match.
      "data-[state=open]:duration-200 data-[state=closed]:duration-150 ease-out data-[state=closed]:!pointer-events-none",
      "z-50 fixed inset-0 grid place-items-center overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      // Content marked `data-instant` (opened by a keyboard shortcut) opens
      // and closes with no fade on desktop, and so does its backdrop.
      "md:[&:has(>[data-instant])]:!animate-none",
      // Content marked `data-clear-backdrop` leaves the page behind it
      // undimmed (a settings pane that previews the page's look).
      "[&:has(>[data-clear-backdrop])]:bg-transparent [&:has(>[data-clear-backdrop])]:backdrop-blur-none",

      className
    )}
    {...props}
  />
));
ModalOverlay.displayName = DialogPrimitive.Overlay.displayName;

const FOCUSABLE =
  'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFooterActions(footer: Element) {
  return Array.from(
    footer.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")
  ).filter((el) => el.offsetParent !== null);
}

// When nothing before the footer can take focus (a plain confirm modal), start
// on the primary action instead of Cancel — unless the primary is destructive.
function focusPrimaryAction(event: Event) {
  const content = event.currentTarget as HTMLElement;
  const first = Array.from(
    content.querySelectorAll<HTMLElement>(FOCUSABLE)
  ).find((el) => el.offsetParent !== null);
  const footer = first?.closest("[data-modal-footer]");
  if (!footer) return;
  // Never a destructive action: one Enter must not confirm a delete. Take the
  // last action that is not destructive (Cancel, beside a lone Delete).
  const primary = getFooterActions(footer)
    .filter((el) => el.dataset.variant !== "destructive")
    .pop();
  event.preventDefault();
  // Only a destructive action: start on the dialog itself.
  (primary ?? content).focus();
}

function moveBetweenFooterActions(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const actions = getFooterActions(event.currentTarget);
  const index = actions.indexOf(event.target as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  const step = event.key === "ArrowRight" ? 1 : -1;
  actions[(index + step + actions.length) % actions.length]?.focus();
}

const ModalContentVariants = cva(
  cn(
    "px-0 pt-6",
    "relative z-50 flex flex-col max-h-[calc(100dvh-4rem)] overflow-y-auto w-full border dark:border-none gap-4 shadow-md dark:shadow-sm",
    "data-[state=open]:duration-200 data-[state=closed]:duration-150 ease-out",
    "[&>form]:flex [&>form]:flex-col [&>form]:min-h-0",
    "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent",
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    // Closing: still on the page while it animates, but no second click.
    // Important: Radix sets `pointer-events: auto` inline on modal content.
    "data-[state=closed]:!pointer-events-none",
    "md:data-instant:!animate-none",
    "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
    "data-[state=closed]:slide-out-to-left-[0%] data-[state=closed]:slide-out-to-top-[0%]",
    "data-[state=open]:slide-in-from-left-[0%] data-[state=open]:slide-in-from-top-[0%]",
    "sm:rounded-2xl md:w-full",
    "bg-card focus-visible:outline-none focus-visible:ring-0",
    "dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]"
  ),
  {
    variants: {
      size: {
        tiny: `sm:align-middle sm:w-full sm:max-w-xs`,
        small: `sm:align-middle sm:w-full sm:max-w-sm`,
        medium: `sm:align-middle sm:w-full sm:max-w-lg`,
        large: `sm:align-middle sm:w-full max-w-xl`,
        xlarge: `sm:align-middle sm:w-full max-w-3xl`,
        xxlarge: `sm:align-middle sm:w-full max-w-6xl`,
        xxxlarge: `sm:align-middle sm:w-full max-w-7xl`
      }
    },
    defaultVariants: {
      size: "medium"
    }
  }
);

/**
 * A modal's or drawer's panel on a phone: a bottom sheet (its grabber that
 * drags it down, its close button, its layer). The parts inside stay the
 * modal's or drawer's own, which lay out for a phone. It undoes a desktop
 * width or border from the caller, and lets a wrapping form shrink, so its
 * body scrolls and its footer stays in view. Shared with `Drawer`.
 */
export const DialogSheetContent = forwardRef<
  ElementRef<typeof BottomSheetContent>,
  ComponentPropsWithoutRef<typeof BottomSheetContent>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => (
  <BottomSheetContent
    ref={ref}
    className={cn(
      // A caller's radius would round the corners at the screen's edge.
      "max-md:rounded-b-none",
      "max-md:w-full max-md:max-w-none max-md:border-0 max-md:[&>form]:flex max-md:[&>form]:min-h-0 max-md:[&>form]:flex-1 max-md:[&>form]:flex-col",
      className
    )}
    onCloseAutoFocus={returnFocusOnClose(onCloseAutoFocus)}
    {...props}
  >
    <ReportDialogExit />
    {children}
  </BottomSheetContent>
));
DialogSheetContent.displayName = "DialogSheetContent";

const ModalContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof ModalContentVariants> & {
      withCloseButton?: boolean;
    }
>(
  (
    {
      className,
      children,
      size,
      withCloseButton = true,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onInteractOutside,
      ...props
    },
    ref
  ) => {
    useEffect(trackPageFocus, []);
    const dismissable = useDialogDismissable();
    const { isPhone } = useViewport();

    // Phones: a bottom sheet, as `Drawer` is.
    if (isPhone) {
      return (
        <DialogSheetContent
          ref={ref}
          withCloseButton={withCloseButton}
          // As the modal did, the panel scrolls when its content is not in a
          // `ModalBody`, unless the caller says otherwise (`overflow-hidden`).
          className={cn("overflow-y-auto", className)}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={onInteractOutside}
          {...props}
        >
          {children}
        </DialogSheetContent>
      );
    }

    // Not on a phone (that is the sheet above), so nothing here styles one.
    return (
      <ClientOnly fallback={null}>
        {() => (
          <ModalPortal>
            <ModalOverlay>
              <DialogPrimitive.Content
                ref={ref}
                className={cn(ModalContentVariants({ size }), className)}
                onOpenAutoFocus={(event) => {
                  onOpenAutoFocus?.(event);
                  if (!event.defaultPrevented) focusPrimaryAction(event);
                }}
                {...props}
                onInteractOutside={keepOpenOnToast(onInteractOutside)}
                onCloseAutoFocus={returnFocusOnClose(onCloseAutoFocus)}
              >
                <ReportDialogExit />
                <ActionPresentationBoundary>
                  {children}
                </ActionPresentationBoundary>
                {withCloseButton && dismissable && (
                  <DialogPrimitive.Close
                    type="button"
                    className="absolute right-4 top-4 rounded-full opacity-70 transition-opacity hover:opacity-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground-muted p-3 hover:bg-accent/80"
                  >
                    <LuX className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                )}
              </DialogPrimitive.Content>
            </ModalOverlay>
          </ModalPortal>
        )}
      </ClientOnly>
    );
  }
);
ModalContent.displayName = DialogPrimitive.Content.displayName;

const ModalHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    data-bottom-sheet-header=""
    className={cn(
      "flex flex-col shrink-0 space-y-1.5 text-center sm:text-left mb-4 px-6",
      // Phones: a sheet's header (a centred 44px row beside its close button).
      sheetHeaderClassName,
      "max-md:mb-1 max-md:space-y-0.5 max-md:text-center",
      className
    )}
    {...props}
  />
);
ModalHeader.displayName = "ModalHeader";

const ModalBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // py-1 keeps the 3px focus ring of the first/last field inside the
      // scroll clip; -mt-1/mb-3 cancel it so the layout is unchanged.
      "relative w-full min-h-0 overflow-y-auto -mt-1 py-1 px-6 mb-3",
      "max-md:px-4",
      "scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent",
      className
    )}
    {...props}
  />
);
ModalBody.displayName = "ModalBody";

/**
 * Phones: a dialog footer becomes a sticky row of full-width 44px actions in
 * the thumb zone. Footers often wrap their buttons in an HStack, so its
 * children are stretched too and its space-x margins are cleared. The submit
 * action moves to the right end ([Cancel][Save]) whatever the source order.
 * Shared by ModalFooter and DrawerFooter.
 */
export const compactFooterClassName =
  "max-md:sticky max-md:bottom-0 max-md:flex-row max-md:px-4 max-md:[&>*]:flex-1 max-md:[&>div]:flex max-md:[&>div]:w-full max-md:[&>div]:gap-2 max-md:[&>div>*]:flex-1 max-md:[&>div>*]:mx-0 max-md:[&_button]:h-11 max-md:[&_[type=submit]]:order-last";

const ModalFooter = ({
  className,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  // biome-ignore lint/a11y/noStaticElementInteractions: onKeyDown moves focus between the footer's buttons with arrow keys; the row itself is not a control
  <div
    data-modal-footer=""
    onKeyDown={(event) => {
      onKeyDown?.(event);
      if (!event.defaultPrevented) moveBetweenFooterActions(event);
    }}
    className={cn(
      "flex flex-col-reverse shrink-0 sm:flex-row sm:justify-end gap-2 px-6 py-3 border-t border-border bg-muted/40 sm:rounded-b-2xl",
      compactFooterClassName,
      "max-md:rounded-none",
      sheetFooterClassName,
      className
    )}
    {...props}
  />
);
ModalFooter.displayName = "ModalFooter";

const ModalTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-medium leading-none tracking-tight text-foreground text-balance",
      sheetTitleClassName,
      className
    )}
    {...props}
  />
));
ModalTitle.displayName = DialogPrimitive.Title.displayName;

const ModalDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground max-md:text-xs", className)}
    {...props}
  />
));
ModalDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalPortal,
  ModalTitle,
  ModalTrigger
};
