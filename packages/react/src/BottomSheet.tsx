"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  HTMLAttributes
} from "react";
import { forwardRef } from "react";

import { ClientOnly } from "./ClientOnly";
import { cn } from "./utils/cn";

const BottomSheet = DialogPrimitive.Root;

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

const BottomSheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <ClientOnly fallback={null}>
    {() => (
      <DialogPrimitive.Portal>
        <BottomSheetOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl bg-background shadow-lg duration-300",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            className
          )}
          {...props}
        >
          <div className="mx-auto mt-3 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/20" />
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    )}
  </ClientOnly>
));
BottomSheetContent.displayName = "BottomSheetContent";

const BottomSheetHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-6 pb-2 text-center", className)} {...props} />
);
BottomSheetHeader.displayName = "BottomSheetHeader";

const BottomSheetBody = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-6 pb-6", className)} {...props} />
);
BottomSheetBody.displayName = "BottomSheetBody";

const BottomSheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-sm font-medium text-muted-foreground", className)}
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
  BottomSheetBody,
  BottomSheetClose,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
  BottomSheetTrigger
};
