"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverHeader = forwardRef<
  ElementRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "-mx-4 -mt-4 mb-4 px-4 py-2 border-b border-border text-sm font-medium text-foreground",
      className
    )}
    {...props}
  />
));
PopoverHeader.displayName = "PopoverHeader";

const PopoverFooter = forwardRef<
  ElementRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "-mx-4 -mb-4 mt-4 px-4 py-2 border-t border-border text-sm font-medium text-foreground",
      className
    )}
    {...props}
  />
));
PopoverFooter.displayName = "PopoverFooter";

const PopoverClose = PopoverPrimitive.Close;

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
};
