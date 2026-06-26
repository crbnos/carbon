import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsMobile
} from "@carbon/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

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
  const { isExplorerCollapsed, isPropertiesCollapsed, setIsExplorerCollapsed } =
    usePanels();
  const panelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    if (isExplorerCollapsed) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [isExplorerCollapsed]);

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
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          {content}
          {!isPropertiesCollapsed && properties}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
