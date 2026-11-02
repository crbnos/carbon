// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useIsomorphicLayoutEffect,
  useViewport
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { animate, useReducedMotion } from "motion/react";
import type { PropsWithChildren, ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useOptimisticLocation } from "~/hooks";
import type { CompactTabItem } from "./CompactTabRow";
import { CompactTabRow } from "./CompactTabRow";
import { createValueSlot } from "./Mobile/slots";
import { dockedPanelTransition } from "./Navigation/CollapsibleSidebar";

/**
 * Phones: a record's sub-route tabs (Details, Purchasing, …), provided by its
 * DetailsTopbar, and whether a record frame is mounted to show them in its
 * one tab row (DetailsTopbar renders its own row otherwise).
 */
export const recordTabsSlot = createValueSlot<CompactTabItem[]>();
export const recordFrameSlot = createValueSlot<true>();

interface PanelContextType {
  isExplorerCollapsed: boolean;
  isPropertiesCollapsed: boolean;
  /**
   * The last properties change came from `toggleProperties`. Only a toggle
   * slides the panel: the collapse for small screens after mount snaps, so
   * nothing animates on page load.
   */
  shouldSlideProperties: boolean;
  toggleExplorer: () => void;
  toggleProperties: () => void;
  setIsExplorerCollapsed: (collapsed: boolean) => void;
  setIsPropertiesCollapsed: (collapsed: boolean) => void;
}

const defaultPanelContext: PanelContextType = {
  isExplorerCollapsed: false,
  isPropertiesCollapsed: false,
  shouldSlideProperties: false,
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleExplorer: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  toggleProperties: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsExplorerCollapsed: () => {},
  // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
  setIsPropertiesCollapsed: () => {}
};

const PanelContext = createContext<PanelContextType>(defaultPanelContext);

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
  const { isPhone } = useViewport();

  // Seed both to `false` so the first client render matches the server (which
  // has no `window`); collapsing based on viewport happens post-mount in the
  // effect below. Reading `window.innerWidth` during render forks server vs
  // client output and triggers a hydration mismatch.
  const [isExplorerCollapsed, setIsExplorerCollapsed] = useState(false);
  // `slide`: the change came from `toggleProperties`.
  const [properties, setProperties] = useState({
    isCollapsed: false,
    slide: false
  });

  const value = {
    isExplorerCollapsed,
    isPropertiesCollapsed: properties.isCollapsed,
    shouldSlideProperties: properties.slide,
    toggleExplorer: () => setIsExplorerCollapsed((prev) => !prev),
    toggleProperties: () =>
      setProperties((prev) => ({
        isCollapsed: !prev.isCollapsed,
        slide: true
      })),
    setIsExplorerCollapsed,
    setIsPropertiesCollapsed: (isCollapsed: boolean) =>
      setProperties({ isCollapsed, slide: false })
  };

  useEffect(() => {
    if (isPhone) {
      setIsExplorerCollapsed(true);
      setProperties({ isCollapsed: true, slide: false });
    } else if (window.innerWidth < 1024) {
      setProperties({ isCollapsed: true, slide: false });
    }
  }, [isPhone]);

  return (
    <PanelContext.Provider value={value}>{children}</PanelContext.Provider>
  );
}

interface ResizablePanelsProps {
  explorer?: React.ReactNode;
  content: React.ReactNode;
  properties?: React.ReactNode;
  /** Compact tab label for the explorer; defaults to "Lines". */
  explorerLabel?: ReactNode;
}

/** True inside a compact record frame's tab panel (see CompactToolbar). */
export const RecordFrameContext = createContext(false);

type RecordPanel = "content" | "explorer" | "properties";
const RecordPanelContext = createContext<(panel: RecordPanel) => void>(
  () => {}
);

/**
 * Phones: switch the record frame's tab, e.g. "See all 30" opening Lines.
 * A no-op outside a compact record frame.
 */
export const useShowRecordPanel = () => useContext(RecordPanelContext);

/**
 * Phones: one sticky underline tab row instead of side panels: the record's
 * content (or its sub-route tabs), the explorer and the properties. Content
 * comes first because tapping a line changes it.
 */
function CompactRecordTabs({
  explorer,
  content,
  properties,
  explorerLabel
}: ResizablePanelsProps) {
  const { t } = useLingui();
  const location = useOptimisticLocation();
  const recordTabs = recordTabsSlot.useValue();
  recordFrameSlot.useProvide(true);
  const [panel, setPanel] = useState<RecordPanel>("content");

  // A tapped line (or any navigation) shows its content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: switch back on navigation only
  useEffect(() => {
    setPanel("content");
  }, [location.pathname]);

  const showContent = () => setPanel("content");
  const tabs: CompactTabItem[] = [
    ...(recordTabs?.length
      ? recordTabs.map((tab) => ({
          ...tab,
          active: panel === "content" && tab.active,
          onClick: showContent
        }))
      : [
          {
            id: "content",
            label: t`Overview`,
            active: panel === "content",
            onClick: showContent
          }
        ]),
    ...(explorer
      ? [
          {
            id: "explorer",
            label: explorerLabel ?? t`Lines`,
            active: panel === "explorer",
            onClick: () => setPanel("explorer")
          }
        ]
      : []),
    ...(properties
      ? [
          {
            id: "properties",
            label: t`Properties`,
            active: panel === "properties",
            onClick: () => setPanel("properties")
          }
        ]
      : [])
  ];

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] w-full flex-col overflow-hidden">
      <CompactTabRow items={tabs} />
      {/* Panels fill the tab area: their own desktop sizes (w-96 border-l,
          fixed heights) give way to the full width and height. */}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto bg-card",
          // Sub-routes size themselves from --header-height: here that is the
          // hero plus this tab row (44 + 1 border), not the hero alone.
          "[--header-height:calc(var(--hero-height,0px)+45px)]",
          "[&>*]:h-auto [&>*]:min-h-full [&>*]:w-full [&>*]:max-w-none [&>*]:flex-1 [&>*]:border-0"
        )}
      >
        <RecordFrameContext.Provider value>
          <RecordPanelContext.Provider value={setPanel}>
            {panel === "content"
              ? content
              : panel === "explorer"
                ? explorer
                : properties}
          </RecordPanelContext.Provider>
        </RecordFrameContext.Provider>
      </div>
    </div>
  );
}

/** Back to rest: both wrappers lay out as `display: contents` again. */
function clearSlideStyles(...elements: (HTMLElement | null)[]) {
  for (const element of elements) element?.removeAttribute("style");
}

/**
 * The properties panel beside a record's content. A toggle slides it in and
 * out the way the module sidebar does (`CollapsibleSidebar`: width and
 * opacity, `dockedPanelTransition`).
 *
 * At rest both wrappers are `display: contents`, so the panel lays out as a
 * direct child of the record's row, as it would without them. While it
 * slides, the outer wrapper clips to an animated width and the inner one
 * holds the panel at its open width: the content column resizes smoothly and
 * the panel's own contents never reflow.
 */
function PropertiesColumn({
  isOpen,
  shouldSlide,
  children
}: PropsWithChildren<{ isOpen: boolean; shouldSlide: boolean }>) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  // The panel stays mounted while it slides out.
  const [isMounted, setIsMounted] = useState(isOpen);
  if (isOpen && !isMounted) setIsMounted(true);

  const wasOpen = useRef(isOpen);
  const slide = useRef<ReturnType<typeof animate> | null>(null);
  // The panel's open width, held while it slides.
  const openWidth = useRef(0);

  useEffect(() => () => slide.current?.stop(), []);

  // Slid out: back to rest in the same commit that unmounts the panel.
  useIsomorphicLayoutEffect(() => {
    if (!isMounted) clearSlideStyles(outerRef.current, innerRef.current);
  }, [isMounted]);

  useIsomorphicLayoutEffect(() => {
    if (wasOpen.current === isOpen) return;
    wasOpen.current = isOpen;

    const wasSliding = slide.current !== null;
    slide.current?.stop();
    slide.current = null;

    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !shouldSlide || shouldReduceMotion) {
      clearSlideStyles(outer, inner);
      if (!isOpen) setIsMounted(false);
      return;
    }

    let fromWidth: number;
    let fromOpacity: number;
    if (wasSliding) {
      // Reversed mid-slide: carry on from where it is.
      fromWidth = outer.getBoundingClientRect().width;
      fromOpacity = Number(window.getComputedStyle(outer).opacity);
    } else {
      // At rest the panel sits in the row itself, at its open width (on
      // opening it was mounted in this commit).
      clearSlideStyles(outer, inner);
      openWidth.current =
        inner.firstElementChild?.getBoundingClientRect().width ?? 0;
      fromWidth = isOpen ? 0 : openWidth.current;
      fromOpacity = isOpen ? 0 : 1;
    }

    Object.assign(outer.style, {
      display: "flex",
      flexShrink: "0",
      overflow: "hidden",
      width: `${fromWidth}px`,
      opacity: String(fromOpacity)
    });
    Object.assign(inner.style, {
      display: "flex",
      flexShrink: "0",
      width: `${openWidth.current}px`
    });

    const animation = animate(
      outer,
      {
        width: [fromWidth, isOpen ? openWidth.current : 0],
        opacity: [fromOpacity, isOpen ? 1 : 0]
      },
      dockedPanelTransition
    );
    slide.current = animation;
    animation.then(() => {
      if (slide.current !== animation) return;
      slide.current = null;
      if (isOpen) clearSlideStyles(outer, inner);
      else setIsMounted(false);
    });
  }, [isOpen, shouldSlide, shouldReduceMotion]);

  return (
    <div ref={outerRef} className="contents">
      <div ref={innerRef} className="contents">
        {isMounted ? children : null}
      </div>
    </div>
  );
}

export function ResizablePanels({
  explorer,
  content,
  properties,
  explorerLabel
}: ResizablePanelsProps) {
  const {
    isExplorerCollapsed,
    isPropertiesCollapsed,
    shouldSlideProperties,
    setIsExplorerCollapsed
  } = usePanels();
  const panelRef = useRef<ImperativePanelHandle>(null);
  const { isPhone } = useViewport();

  useEffect(() => {
    if (isExplorerCollapsed) {
      panelRef.current?.collapse();
    } else {
      panelRef.current?.expand();
    }
  }, [isExplorerCollapsed]);

  if (isPhone) {
    return (
      <CompactRecordTabs
        explorer={explorer}
        content={content}
        properties={properties}
        explorerLabel={explorerLabel}
      />
    );
  }

  // A layout with no explorer renders no left panel at all -- an always-present
  // `ResizablePanel` would leave an empty column and a drag handle with nothing
  // behind it.
  return (
    <ResizablePanelGroup direction="horizontal">
      {explorer && (
        <>
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
        </>
      )}
      <ResizablePanel order={2} className="z-1 relative">
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          {content}
          {properties ? (
            <PropertiesColumn
              isOpen={!isPropertiesCollapsed}
              shouldSlide={shouldSlideProperties}
            >
              {properties}
            </PropertiesColumn>
          ) : null}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
