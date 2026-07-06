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

const Drawer = DialogPrimitive.Root;

const DrawerTrigger = DialogPrimitive.Trigger;

const DrawerCloseButton = DialogPrimitive.Close;

const portalVariants = cva("fixed inset-0 z-50 flex p-3", {
  variants: {
    position: {
      top: "items-start",
      bottom: "items-end",
      left: "justify-start",
      right: "justify-end"
    }
  },
  defaultVariants: { position: "right" }
});

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
      "fixed inset-0 z-50 bg-black/10 backdrop-blur-sm  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
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
      className
    )}
    {...props}
  />
);
DrawerBody.displayName = "DrawerBody";

const sheetVariants = cva(
  "flex flex-col z-50 scale-100 bg-accent dark:bg-card opacity-100 shadow-button-base dark:shadow-[inset_0_0.5px_0_rgb(255_255_255_/_0.08),_inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)] border border-border transition-[background-color,box-shadow,border-color] duration-100 focus-visible:outline-none focus-visible:ring-0 rounded-2xl",
  {
    variants: {
      position: {
        top: "animate-in slide-in-from-top w-full duration-300",
        bottom: "animate-in slide-in-from-bottom w-full duration-300",
        left: "animate-in slide-in-from-left h-full duration-300",
        right: "animate-in slide-in-from-right h-full duration-300"
      },
      size: {
        content: "",
        sm: "",
        md: "",
        lg: "",
        xl: "",
        full: ""
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
  ) => (
    <ClientOnly fallback={null}>
      {() => (
        <DrawerPortal position={position} container={container}>
          {overlay && <DrawerOverlay />}
          <DialogPrimitive.Content
            ref={ref}
            className={cn(sheetVariants({ position, size }), className)}
            {...props}
          >
            {children}
            <DialogPrimitive.Close
              type="button"
              className="absolute right-4 top-3 rounded-full p-2 opacity-70 transition-opacity hover:opacity-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none data-[state=open]:bg-secondary"
            >
              <LuX className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DrawerPortal>
      )}
    </ClientOnly>
  )
);
DrawerContent.displayName = DialogPrimitive.Content.displayName;

const DrawerHeader = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col flex-0 gap-1 text-left px-6 py-4 text-muted-foreground",
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
      "text-base font-medium font-headline leading-none tracking-tight text-foreground/90 text-balance line-clamp-1",
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
