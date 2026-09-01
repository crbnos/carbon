import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsMobile
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useOptimisticLocation } from "~/hooks";

interface PanelContextType {
  isExplorerCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  toggleExplorer: () => void;
  toggleProperties: () => void;
  setIsExplorerCollapsed: (collapsed: boolean) => void;
  setIsPropertiesCollapsed: (collapsed: boolean) => void;
}

const PanelContext = createContext<PanelContextType>({
  isExplorerCollapsed: false,
  isPropertiesCollapsed: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleExplorer: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleProperties: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsExplorerCollapsed: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsPropertiesCollapsed: () => {}
});

export function usePanels() {
  const context = useContext(PanelContext);
  if (!context) {
    throw new Error("usePanels must be used within a PanelProvider");
  }
  return context;
}

interface PanelProviderProps {
  children: React.ReactNode;
}

export function PanelProvider({ children }: PanelProviderProps) {
  const isMobile = useIsMobile();

  // Seed both to `false` so the first client render matches the server (which
  // has no `window`); collapsing based on viewport happens post-mount in the
  // effect below. Reading `window.innerWidth` during render forks server vs
  // client output and triggers a hydration mismatch.
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);

  const value = {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    toggleExplorer: () => setIsExplorerCollapsed((prev) => !prev),
    toggleProperties: () => setIsPropertiesCollapsed((prev) => !prev),
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (isMobile) {
      setIsExplorerCollapsed(true);
      setIsPropertiesCollapsed(true);
    } else if (window.innerWidth < 1024) {
      setIsPropertiesCollapsed(true);
    }
  }, [isMobile]);

  return (
    <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
  );
}

interface ResizablePanelsProps {
  explorer?: React.ReactNode;
  content: React.ReactNode;
  properties?: React.ReactNode;
}

export function ResizablePanels({
  explorer,
  content,
  properties
}: ResizablePanelsProps) {
  const {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed
  } = usePanels();
  const panelRef = useRef<ImperativePanelHandle>(null);
  const isMobile = useIsMobile();
  const location = useOptimisticLocation();

  useEffect(() => {
    if (isExplorerCollapsed) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [isExplorerCollapsed]);

  // On mobile the side panels overlay the content as drawers; collapse them once
  // the pathname changes (e.g. picking an item in the explorer) so the drawer
  // doesn't sit over the destination.
  useEffect(() => {
    if (isMobile) {
      setIsExplorerCollapsed(true);
      setIsPropertiesCollapsed(true);
    }
  }, [
    location.pathname,
    isMobile,
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed
  ]);

  // A resizable column split is unreadable at phone width. Render the content
  // full-width and float the explorer / properties as overlay drawers instead.
  if (isMobile) {
    return (
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height))] w-full overflow-hidden">
        {content}
        {explorer && (
          <Drawer
            open={!isExplorerCollapsed}
            onOpenChange={(open) => setIsExplorerCollapsed(!open)}
          >
            <DrawerContent
              position="left"
              size="content"
              className="w-[20rem] max-w-[90vw] p-0"
            >
              <DrawerTitle className="sr-only">
                <Trans>Explorer</Trans>
              </DrawerTitle>
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                {explorer}
              </div>
            </DrawerContent>
          </Drawer>
        )}
        {properties && (
          <Drawer
            open={!isPropertiesCollapsed}
            onOpenChange={(open) => setIsPropertiesCollapsed(!open)}
          >
            <DrawerContent
              position="right"
              size="content"
              className="w-[20rem] max-w-[90vw] p-0"
            >
              <DrawerTitle className="sr-only">
                <Trans>Properties</Trans>
              </DrawerTitle>
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                {properties}
              </div>
            </DrawerContent>
          </Drawer>
        )}
      </div>
    );
  }

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel
        ref={panelRef}
        order={1}
        minSize={10}
        className="bg-card shadow-lg"
        collapsible
        defaultSize={isExplorerCollapsed ? 0 : 20}
        collapsedSize={0}
        onCollapse={() => setIsExplorerCollapsed(true)}
        onExpand={() => setIsExplorerCollapsed(false)}
      >
        {!isExplorerCollapsed && explorer}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel order={2} className="z-1 relative">
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height))] overflow-hidden w-full">
          {content}
          {!isPropertiesCollapsed && properties}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
