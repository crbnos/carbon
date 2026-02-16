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
import { ClientOnly } from "./ClientOnly";
import { cn } from "./utils/cn";

const Modal = DialogPrimitive.Root;

const ModalTrigger = DialogPrimitive.Trigger;

const ModalPortal = DialogPrimitive.Portal;

const ModalClose = DialogPrimitive.Close;

const ModalOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // 'z-50 fixed h-full w-full left-0 top-0',
      // 'bg-alternative/90 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      "bg-alternative/90 backdrop-blur-sm",
      "z-50 fixed inset-0 grid place-items-center overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent data-open:animate-overlay-show data-closed:animate-overlay-hide",

      className
    )}
    {...props}
  />
));
ModalOverlay.displayName = DialogPrimitive.Overlay.displayName;

const ModalContentVariants = cva(
  cn(
    "p-0",
    "relative z-50 flex flex-col w-full max-h-[85vh] shadow-button-base duration-200",
    "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
    "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
    "data-[state=closed]:slide-out-to-left-[0%] data-[state=closed]:slide-out-to-top-[0%",
    "data-[state=open]:slide-in-from-left-[0%] data-[state=open]:slide-in-from-top-[0%]",
    "rounded-2xl md:w-full",
    "bg-accent dark:bg-card focus-visible:outline-none focus-visible:ring-0",
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

const ModalContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof ModalContentVariants> & {
      withCloseButton?: boolean;
    }
>(({ className, children, size, withCloseButton = true, ...props }, ref) => (
  <ClientOnly fallback={null}>
    {() => (
      <ModalPortal>
        <ModalOverlay>
          <DialogPrimitive.Content
            ref={ref}
            className={cn(ModalContentVariants({ size }), className)}
            {...props}
          >
            {children}
            {withCloseButton && (
              <DialogPrimitive.Close className="absolute right-2 top-2 rounded-full opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground-muted p-2 hover:bg-accent/80">
                <LuX className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </ModalOverlay>
      </ModalPortal>
    )}
  </ClientOnly>
));
ModalContent.displayName = DialogPrimitive.Content.displayName;

const ModalHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-1 text-center sm:text-left px-6 py-4 text-muted-foreground",
      className
    )}
    {...props}
  />
);
ModalHeader.displayName = "ModalHeader";

const ModalBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "w-full p-6 rounded-2xl border border-border bg-card dark:bg-muted/40 overflow-y-auto",
      className
    )}
    {...props}
  />
);
ModalBody.displayName = "ModalBody";

const ModalFooter = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end gap-2 py-3 px-6",
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
      "text-base font-medium font-headline leading-none tracking-tight text-foreground/90",
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
    className={cn("text-xs text-muted-foreground", className)}
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
