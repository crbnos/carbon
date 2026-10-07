// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useLingui } from "@lingui/react/macro";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes
} from "react";
import { forwardRef } from "react";
import { LuChevronLeft, LuX } from "react-icons/lu";

import { ActionPresentationBoundary } from "./ActionPresentation";
import { ClientOnly } from "./ClientOnly";
import { useCompact } from "./Compact";
import { DialogRoot, useDialogDismissable } from "./Modal";
import { cn } from "./utils/cn";

/**
 * A sheet that slides up from the bottom. Every compact (phone) sheet shares
 * this anatomy: grabber, header with optional Back and a close ×, a scrolling
 * body and a sticky footer above the safe area. The compact
 * parts only apply inside an app that opted into the `compact:` variant, so
 * other callers (MES) render as before.
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

const BottomSheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  BottomSheetContentProps
>(({ className, children, size = "auto", ...props }, ref) => {
  const { t } = useLingui();
  const isCompact = useCompact();
  const dismissable = useDialogDismissable();
  return (
    <ClientOnly fallback={null}>
      {() => (
        <DialogPrimitive.Portal>
          <BottomSheetOverlay />
          <DialogPrimitive.Content
            ref={ref}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl bg-background shadow-lg duration-300",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
              "compact:max-h-[88dvh] compact:rounded-t-[14px] compact:bg-popover compact:pb-safe",
              size === "full" &&
                "compact:h-[calc(100dvh-env(safe-area-inset-top)-12px)] compact:max-h-none",
              className
            )}
            {...props}
          >
            <div
              className={cn(
                "mx-auto mt-3 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/20",
                "compact:mt-2 compact:mb-1 compact:h-[5px] compact:w-9"
              )}
            />
            <ActionPresentationBoundary>{children}</ActionPresentationBoundary>
            {isCompact && dismissable && (
              <DialogPrimitive.Close
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
      "compact:relative compact:flex compact:min-h-11 compact:shrink-0 compact:items-center compact:justify-center compact:px-14 compact:pb-2",
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
      "compact:min-h-0 compact:flex-1 compact:overflow-y-auto compact:px-4 compact:pb-4",
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
      "compact:truncate compact:text-[17px] compact:font-semibold compact:text-foreground",
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
  BottomSheetTrigger
};
