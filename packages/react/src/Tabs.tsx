// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef } from "react";

import { cn } from "./utils/cn";

const Tabs = TabsPrimitive.Root;

const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // No fixed height and no border — p-1 sizes the box, so the space
      // around the triggers is uniform on every side (a fixed h-* squeezed
      // them, and a border-b read as an extra pixel of bottom padding)
      "inline-flex items-center justify-center rounded-[0.5rem] bg-muted p-0.5 text-muted-foreground border border-border",
      // Phones: an underline tab row that scrolls sideways, inset 16pt.
      "max-md:flex max-md:w-full max-md:justify-start max-md:gap-5 max-md:overflow-x-auto max-md:scrollbar-hide max-md:rounded-none max-md:border-0 max-md:border-b max-md:bg-transparent max-md:p-0 max-md:px-4",
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    variant?: "primary" | "secondary";
  }
>(({ className, variant = "secondary", ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-[6px] border border-transparent px-3 py-1 text-sm font-medium transition-[background-color,color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-button-base",
      "max-md:min-h-11 max-md:min-w-11 max-md:shrink-0 max-md:rounded-none max-md:border-0 max-md:border-b-2 max-md:border-transparent max-md:px-0 max-md:text-[15px] max-md:data-[state=active]:border-foreground max-md:data-[state=active]:bg-transparent max-md:data-[state=active]:shadow-none",

      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("flex-1 outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
