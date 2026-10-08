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
  HTMLAttributes
} from "react";
import { forwardRef } from "react";

import { LuX } from "react-icons/lu";
import { ActionPresentationBoundary } from "./ActionPresentation";
import { ClientOnly } from "./ClientOnly";
import {
  compactFooterClassName,
  DialogRoot,
  useDialogDismissable
} from "./Modal";
import { cn } from "./utils/cn";
import { usePhoneOpenAutoFocus, useViewport } from "./Viewport";

const Drawer = DialogRoot;

const DrawerTrigger = DialogPrimitive.Trigger;

const DrawerCloseButton = DialogPrimitive.Close;

// Radix keeps a closing dialog mounted only while the element it wraps is
// animating, and what the portal wraps is this positioning div, not the panel.
// So the div runs a no-op exit animation for as long as its panel is closing
// (`animate-out` with no modifiers animates to the element's own state);
// without it the portal removes the panel before it can slide out. The
// duration must match the panel's closing duration below.
const portalVariants = cva(
  "fixed inset-0 z-50 flex p-3 max-md:p-0 max-md:items-end [&:has(>[role=dialog][data-state=closed])]:animate-out [&:has(>[role=dialog][data-state=closed])]:duration-200",
  {
    variants: {
      position: {
        top: "items-start",
        bottom: "items-end",
        left: "justify-start",
        right: "justify-end"
      }
    },
    defaultVariants: { position: "right" }
  }
);

interface DrawerPortalProps
  extends DialogPrimitive.DialogPortalProps,
    VariantProps<typeof portalVariants> {}

const DrawerPortal = ({ position, children, ...props }: DrawerPortalProps) => (
  <DialogPrimitive.Portal {...props}>
    <div className={portalVariants({ position })}>{children}</div>
  </DialogPrimitive.Portal>
);
DrawerPortal.displayName = DialogPrimitive.Portal.displayName;

const DrawerOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/20 max-md:bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
));
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DrawerBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col flex-1 items-start justify-start overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full p-6 bg-card dark:bg-muted/40 rounded-xl border border-border",
      // A caller that wants the body flush on phones passes `max-md:p-0`.
      "max-md:min-h-0 max-md:rounded-none max-md:border-x-0 max-md:p-4",
      className
    )}
    {...props}
  />
);
DrawerBody.displayName = "DrawerBody";

// Phones show every drawer as a bottom sheet, so it also slides up from the
// bottom whatever its desktop side.
const sheetVariants = cva(
  "flex flex-col z-50 scale-100 bg-accent dark:bg-card opacity-100 shadow-button-base dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] border border-border transition-[background-color,box-shadow,border-color] duration-100 focus-visible:outline-none focus-visible:ring-0 rounded-xl max-md:max-h-[calc(100dvh-env(safe-area-inset-top)-12px)] max-md:w-full max-md:max-w-none max-md:overflow-hidden max-md:rounded-t-[14px] max-md:rounded-b-none max-md:border-0 max-md:bg-card max-md:h-auto max-md:[&>form]:min-h-0 max-md:data-[state=open]:[--tw-enter-translate-x:0] max-md:data-[state=open]:[--tw-enter-translate-y:100%] max-md:data-[state=closed]:[--tw-exit-translate-x:0] max-md:data-[state=closed]:[--tw-exit-translate-y:100%]",
  {
    variants: {
      position: {
        top: "data-[state=open]:animate-in data-[state=open]:slide-in-from-top data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top data-[state=closed]:duration-200 w-full duration-300 ease-out",
        bottom:
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-200 w-full duration-300 ease-out",
        left: "data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=closed]:duration-200 h-full duration-300 ease-out",
        right:
          "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200 h-full duration-300 ease-out"
      },
      size: {
        content: "",
        sm: "",
        md: "",
        lg: "",
        xl: "",
        // Phones: sheets fit their content (the form shrinks under the max
        // height so its body scrolls); `full` keeps the whole height.
        full: "max-md:h-[calc(100dvh-env(safe-area-inset-top)-12px)]"
      }
    },
    compoundVariants: [
      {
        position: ["top", "bottom"],
        size: "content",
        class: "max-h-full"
      },
      {
        position: ["top", "bottom"],
        size: "md",
        class: "h-1/3"
      },
      {
        position: ["top", "bottom"],
        size: "sm",
        class: "h-1/4"
      },
      {
        position: ["top", "bottom"],
        size: "lg",
        class: "h-1/2"
      },
      {
        position: ["top", "bottom"],
        size: "xl",
        class: "h-5/6"
      },
      {
        position: ["top", "bottom"],
        size: "full",
        class: "h-full"
      },
      {
        position: ["right", "left"],
        size: "content",
        class: "max-w-full"
      },
      {
        position: ["right", "left"],
        size: "md",
        class: "w-full lg:w-1/3"
      },
      {
        position: ["right", "left"],
        size: "sm",
        class: "w-full lg:w-1/4"
      },
      {
        position: ["right", "left"],
        size: "lg",
        class: "w-full lg:w-1/2"
      },
      {
        position: ["right", "left"],
        size: "xl",
        class: "w-full lg:w-2/3"
      },
      {
        position: ["right", "left"],
        size: "full",
        class: "w-full"
      }
    ],
    defaultVariants: {
      position: "right",
      size: "md"
    }
  }
);

export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  overlay?: boolean;
  container?: HTMLElement;
}

const DrawerContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      position,
      size,
      overlay = true,
      container,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const dismissable = useDialogDismissable();
    const { isPhone } = useViewport();
    const onOpenAutoFocus = usePhoneOpenAutoFocus(props.onOpenAutoFocus);
    return (
      <ClientOnly fallback={null}>
        {() => (
          <DrawerPortal position={position} container={container}>
            {overlay && <DrawerOverlay />}
            <DialogPrimitive.Content
              ref={ref}
              className={cn(sheetVariants({ position, size }), className)}
              {...props}
              onOpenAutoFocus={onOpenAutoFocus}
            >
              {isPhone && (
                <div className="mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full bg-muted-foreground/20" />
              )}
              <ActionPresentationBoundary>
                {children}
              </ActionPresentationBoundary>
              {dismissable && (
                <DialogPrimitive.Close
                  type="button"
                  className="absolute right-4 top-3 rounded-full p-2 opacity-70 transition-opacity hover:opacity-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none data-[state=open]:bg-secondary max-md:right-1 max-md:top-[15px] max-md:flex max-md:size-11 max-md:items-center max-md:justify-center max-md:p-0"
                >
                  <LuX className="h-5 w-5" />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              )}
            </DialogPrimitive.Content>
          </DrawerPortal>
        )}
      </ClientOnly>
    );
  }
);
DrawerContent.displayName = DialogPrimitive.Content.displayName;

const DrawerHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col flex-0 gap-1 text-left px-6 py-4 text-muted-foreground",
      "max-md:min-h-[52px] max-md:justify-center max-md:px-4 max-md:py-2 max-md:pr-14",
      className
    )}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-0 sm:flex-row flex-col-reverse px-6 py-4 sm:justify-end sm:space-x-2",
      compactFooterClassName,
      // Phones: above the safe area.
      "max-md:gap-2 max-md:space-x-0 max-md:pt-3 max-md:pb-safe-4",
      className
    )}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-medium leading-none tracking-tight text-foreground/90 text-balance line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
  </DialogPrimitive.Title>
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-xs text-muted-foreground", className)}
    {...props}
  />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
};
