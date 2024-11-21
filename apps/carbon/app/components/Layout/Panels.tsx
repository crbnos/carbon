import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
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
  toggleExplorer: () => {},
  toggleProperties: () => {},
  setIsExplorerCollapsed: () => {},
  setIsPropertiesCollapsed: () => {},
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
  const isBrowser = typeof window !== "undefined";

  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(
    isBrowser ? window.innerWidth < 768 : false
  );
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(
    isBrowser ? window.innerWidth < 1024 : false
  );

  const value = {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    toggleExplorer: () => setIsExplorerCollapsed((prev) => !prev),
    toggleProperties: () => setIsPropertiesCollapsed((prev) => !prev),
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed,
  };

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
  properties,
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
      <ResizablePanel order={2} className="z-1">
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          {content}
          {!isPropertiesCollapsed && properties}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
