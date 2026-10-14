// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { createContext, forwardRef, useContext } from "react";
import { LuGripVertical } from "react-icons/lu";
import type { ImperativePanelHandle } from "react-resizable-panels";
import * as ResizablePrimitive from "react-resizable-panels";
import { ClientOnly } from "./ClientOnly";
import { cn } from "./utils/cn";
import { useViewport } from "./Viewport";

/** True inside a group that `stackOnCompact` turned into plain blocks. */
const StackedContext = createContext(false);

const ResizablePanelGroup = ({
  className,
  children,
  stackOnCompact,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup> & {
  /**
   * Phones: render the panes as plain full-width blocks with no handles, one
   * at a time. A pane marked `compactFocus` hides its siblings while mounted.
   */
  stackOnCompact?: boolean;
}) => {
  const { isPhone } = useViewport();

  if (stackOnCompact && isPhone) {
    return (
      <StackedContext.Provider value={true}>
        <div
          className={cn(
            "flex h-full w-full flex-col [&:has(>[data-compact-focus])>:not([data-compact-focus])]:hidden",
            className
          )}
        >
          {children}
        </div>
      </StackedContext.Provider>
    );
  }

  return (
    <ClientOnly fallback={null}>
      {() => (
        <ResizablePrimitive.PanelGroup
          className={cn(
            "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
            className
          )}
          {...props}
        >
          {children}
        </ResizablePrimitive.PanelGroup>
      )}
    </ClientOnly>
  );
};

const ResizablePanel = forwardRef<
  ImperativePanelHandle,
  React.ComponentPropsWithoutRef<typeof ResizablePrimitive.Panel> & {
    /** In a stacked group (phones), this pane replaces its siblings. */
    compactFocus?: boolean;
  }
>(({ compactFocus, ...props }, ref) => {
  const isStacked = useContext(StackedContext);

  if (isStacked) {
    return (
      <div
        data-compact-focus={compactFocus || undefined}
        className={cn("flex h-full min-h-0 w-full flex-col", props.className)}
      >
        {props.children}
      </div>
    );
  }

  return <ResizablePrimitive.Panel ref={ref} {...props} />;
});
ResizablePanel.displayName = "ResizablePanel";

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => {
  const isStacked = useContext(StackedContext);
  if (isStacked) return null;

  return (
    <ResizablePrimitive.PanelResizeHandle
      className={cn(
        "relative flex w-px items-center justify-center bg-foreground/10 after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <LuGripVertical className="h-3 w-3" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  );
};

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
