// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  Drawer,
  DrawerContent,
  DrawerTitle,
  IconButton,
  useIsMobile
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { motion, useReducedMotion } from "framer-motion";
import type { ComponentProps, PropsWithChildren } from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef
} from "react";
import { LuPanelLeft } from "react-icons/lu";
import type { Location } from "react-router";
import { useLocation, useMatches, useNavigation } from "react-router";
import { useOptimisticLocation } from "~/hooks";
import { useUIStore } from "~/stores/ui";
import type { Handle } from "~/utils/handle";

interface CollapsibleSidebarContextValue {
  hasSidebar: boolean;
  isOpen: boolean;
  onToggle: () => void;
}

const CollapsibleSidebarContext = createContext<
  CollapsibleSidebarContextValue | undefined
>(undefined);

export function useCollapsibleSidebar() {
  const context = useContext(CollapsibleSidebarContext);
  if (!context) {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: suppressed due to migration
    return { hasSidebar: false, isOpen: false, onToggle: () => {} };
  }
  return context;
}

function CollapsibleSidebarProvider({
  hasSidebar,
  children
}: PropsWithChildren<{ hasSidebar: boolean }>) {
  const isMobile = useIsMobile();
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setHasContentSidebar = useUIStore(
    (state) => state.setHasContentSidebar
  );

  // Only a change of breakpoint moves it: opening on mount would undo the
  // user's collapse, and on a phone open the drawer for a frame.
  const wasMobile = useRef(false);
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
    else if (wasMobile.current) setSidebarOpen(true);
    wasMobile.current = isMobile;
  }, [isMobile, setSidebarOpen]);

  // Tell the (global) Topbar that this route has a content sub-nav, so it can
  // surface a mobile "Sections" trigger.
  useEffect(() => {
    setHasContentSidebar(hasSidebar);
    return () => setHasContentSidebar(false);
  }, [hasSidebar, setHasContentSidebar]);

  return (
    <CollapsibleSidebarContext.Provider
      value={{
        hasSidebar,
        isOpen: isSidebarOpen,
        onToggle: toggleSidebar
      }}
    >
      {children}
    </CollapsibleSidebarContext.Provider>
  );
}

export const CollapsibleSidebarTrigger = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof IconButton>, "aria-label" | "icon">
>(({ className, ...props }, ref) => {
  const { isOpen, onToggle, hasSidebar } = useCollapsibleSidebar();

  if (!hasSidebar) return null;

  return (
    <IconButton
      variant="ghost"
      ref={ref}
      onClick={onToggle}
      {...props}
      aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      icon={<LuPanelLeft />}
      className={cn("-ml-1", className)}
    />
  );
});

CollapsibleSidebarTrigger.displayName = "CollapsibleSidebarTrigger";

// ease-out-quart: feels snappy and responsive for sidebar expand/collapse
const easeOutQuart = [0.165, 0.84, 0.44, 1] as const;

/**
 * The location a module sidebar highlights against: the pending one while it
 * is still inside this sidebar, otherwise the one on screen. A sidebar about
 * to be replaced keeps its highlight instead of going blank for the length of
 * the loader.
 */
export function useSidebarLocation(isInside: (pathname: string) => boolean) {
  const current = useLocation();
  const pending: Location | undefined = useNavigation().location;
  return pending && isInside(pending.pathname) ? pending : current;
}

/**
 * The scrolling list of links inside the module sidebar, with the same hover
 * card the icon rail has: one card for the whole list, moved with a transform
 * to the link under the pointer, so the highlight travels between links
 * instead of each one fading its own. The active link keeps its own
 * background. A link opts in with `data-nav-item`.
 */
export function SidebarLinks({ children }: PropsWithChildren) {
  const listRef = useRef<HTMLDivElement>(null);
  const hoverCardRef = useRef<HTMLSpanElement>(null);

  // Written straight to the element: a hover must not re-render the list.
  const moveHoverCard = (item: HTMLElement | null) => {
    const card = hoverCardRef.current;
    const list = listRef.current;
    if (!card || !list) return;
    if (!item) {
      card.style.opacity = "0";
      return;
    }
    const itemRect = item.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const left = itemRect.left - listRect.left + list.scrollLeft;
    const top = itemRect.top - listRect.top + list.scrollTop;
    // Entering the list: appear on the link rather than slide in from
    // wherever the card was last.
    card.style.transitionProperty = card.style.opacity === "1" ? "" : "opacity";
    card.style.transform = `translate(${left}px, ${top}px)`;
    card.style.width = `${itemRect.width}px`;
    card.style.height = `${itemRect.height}px`;
    card.style.opacity = "1";
  };

  return (
    <div
      ref={listRef}
      className="relative overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full w-full pb-8"
      // The gaps between links are not links: the card stays where it is
      // while the pointer crosses one, and only leaves with the pointer.
      onPointerOver={(event) => {
        if (event.pointerType !== "mouse") return;
        const item = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-nav-item]"
        );
        if (item) moveHoverCard(item);
      }}
      // A press navigates, expands a link's views or starts a reorder: the
      // row under the card is about to change or move.
      onPointerDown={() => moveHoverCard(null)}
      onPointerLeave={() => moveHoverCard(null)}
    >
      <span
        ref={hoverCardRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-md bg-active/60 opacity-0 transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      />
      {children}
    </div>
  );
}

/**
 * The one module sidebar, rendered by the app shell around every page. A
 * module layout names its sub-navigation on its route handle (`sidebar`) and
 * the shell renders it here, so the sidebar's frame, width and collapsed
 * state stay put from module to module and only its links change. Pages
 * outside a module (detail pages) have none and get the full width.
 */
export function ModuleSidebarLayout({ children }: PropsWithChildren) {
  const matches = useMatches();
  const handles = matches.map((match) => match.handle as Handle | undefined);
  const Sidebar = handles.some((handle) => handle?.hideModuleSidebar)
    ? undefined
    : handles.find((handle) => handle?.sidebar)?.sidebar;

  return (
    <CollapsibleSidebarProvider hasSidebar={Boolean(Sidebar)}>
      {/* `contents` when there is no sidebar: the page lays out exactly as if
          this wrapper were not here, and stays in the same place in the tree. */}
      <div
        className={
          Sidebar
            ? "grid grid-cols-[auto_minmax(0,1fr)] w-full h-full"
            : "contents"
        }
      >
        {Sidebar ? (
          <CollapsibleSidebar>
            <Sidebar />
          </CollapsibleSidebar>
        ) : null}
        {children}
      </div>
    </CollapsibleSidebarProvider>
  );
}

const CollapsibleSidebar = ({
  children,
  width = 240
}: PropsWithChildren<{ width?: number }>) => {
  const { isOpen } = useCollapsibleSidebar();
  const shouldReduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const location = useOptimisticLocation();

  const variants = useMemo(() => {
    return {
      visible: {
        width,
        opacity: 1
      },
      hidden: {
        width: 0,
        opacity: 0
      }
    };
  }, [width]);

  // On mobile the sub-nav is an overlay drawer; close it once the user picks a
  // section (the pathname changes) so it doesn't sit over the destination.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname, isMobile, setSidebarOpen]);

  if (isMobile) {
    return (
      <>
        {/* The sub-nav is a portaled overlay on mobile, but the module layout
            grid (`grid-cols-[auto_minmax(0,1fr)]`) still expects a node in its
            first (`auto`) track. Without this zero-width occupant the content
            slides into the `auto` track and the `1fr` track becomes an empty
            gutter on the right. */}
        <div aria-hidden className="w-0" />
        <Drawer open={isOpen} onOpenChange={setSidebarOpen}>
          <DrawerContent
            position="left"
            size="content"
            className="w-[17rem] max-w-[85vw] p-0"
          >
            <DrawerTitle className="px-4 py-3">
              <Trans>Submodules</Trans>
            </DrawerTitle>
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              {children}
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <motion.div
      animate={isOpen ? "visible" : "hidden"}
      // No enter animation: arriving from a page without a sidebar must not
      // replay the collapse.
      initial={false}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : {
              duration: 0.2,
              ease: easeOutQuart,
              opacity: { duration: 0.15 }
            }
      }
      variants={variants}
      className="relative flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]"
    >
      <div className="h-full w-full overflow-hidden bg-card border-r border-border">
        {isOpen ? children : null}
      </div>
    </motion.div>
  );
};
