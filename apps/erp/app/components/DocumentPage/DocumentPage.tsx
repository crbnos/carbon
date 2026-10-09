// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  ResizableHandle,
  useViewport
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { createContext, useContext, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { Panel, PanelGroup } from "react-resizable-panels";

type DocumentPageContextType = {
  hasSidebar: boolean;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
};

const DocumentPageContext = createContext<DocumentPageContextType>({
  hasSidebar: false,
  isSidebarOpen: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op outside a DocumentPage
  toggleSidebar: () => {}
});

export function useDocumentPage() {
  return useContext(DocumentPageContext);
}

type DocumentPageProps = {
  /** Identity, status and actions — usually a `DocumentPageHeader`. Pinned. */
  header: ReactNode;
  /** The work: details, lines, notes. Scrolls under the header. */
  children: ReactNode;
  /** Related documents and activity — usually a `DocumentSidebar`. */
  sidebar?: ReactNode;
};

const SIDEBAR_PANEL_ID = "document-page-sidebar";

/**
 * The layout for documents that are filled in and then posted — shipments,
 * receipts, transfers, journal entries. One readable column for the work, and
 * a resizable, collapsible side panel for what surrounds it. The panel's size
 * and collapsed state are shared by every document that uses this layout.
 */
export function DocumentPage({ header, children, sidebar }: DocumentPageProps) {
  const { isPhone: isMobile } = useViewport();
  const sidebarRef = useRef<ImperativePanelHandle>(null);
  // Desktop: mirrors the panel, which restores its own saved layout and
  // reports back through onCollapse / onExpand. Mobile: the drawer, closed
  // until asked for.
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const hasSidebar = Boolean(sidebar);

  const toggleSidebar = () => {
    if (isMobile) {
      setIsDrawerOpen((open) => !open);
      return;
    }
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  const context = {
    hasSidebar,
    isSidebarOpen: isMobile ? isDrawerOpen : isSidebarOpen,
    toggleSidebar
  };

  const content = (
    <div className="h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] w-full overflow-y-auto scrollbar-hide">
      {header}
      <div className="@container w-full max-w-5xl mx-auto px-4 md:px-8 pb-16">
        <div className="flex flex-col gap-4 w-full">{children}</div>
      </div>
    </div>
  );

  const showPanel = hasSidebar && !isMobile;

  // One tree for every case, the content panel always in the same place, so
  // crossing the mobile breakpoint never remounts the form underneath (and
  // its unsaved state). The group is `react-resizable-panels` itself rather
  // than the `@carbon/react` wrapper: the wrapper renders nothing on the
  // server, and the page's content has to be in the server HTML.
  return (
    <DocumentPageContext.Provider value={context}>
      <PanelGroup
        direction="horizontal"
        autoSaveId={showPanel ? "document-page" : undefined}
        className="flex h-full w-full"
      >
        <Panel
          id="document-page-content"
          order={1}
          defaultSize={showPanel ? 70 : 100}
          minSize={40}
        >
          {content}
        </Panel>
        {showPanel && (
          <>
            <ResizableHandle withHandle />
            <Panel
              ref={sidebarRef}
              id={SIDEBAR_PANEL_ID}
              order={2}
              defaultSize={30}
              minSize={20}
              maxSize={50}
              collapsible
              collapsedSize={0}
              onCollapse={() => setIsSidebarOpen(false)}
              onExpand={() => setIsSidebarOpen(true)}
              className="bg-background/30"
            >
              {isSidebarOpen && (
                <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] flex-col overflow-hidden">
                  {sidebar}
                </div>
              )}
            </Panel>
          </>
        )}
      </PanelGroup>
      {hasSidebar && isMobile && (
        <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
          <DrawerContent
            position="right"
            size="content"
            className="w-[24rem] max-w-[90vw] p-0"
          >
            <DrawerTitle className="sr-only">
              <Trans>Documents and activity</Trans>
            </DrawerTitle>
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              {sidebar}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </DocumentPageContext.Provider>
  );
}
