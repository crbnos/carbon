// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, IconButton, useViewport } from "@carbon/react";
import { motion, useReducedMotion } from "motion/react";
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
import { useUIStore } from "~/stores/ui";
import type { Handle } from "~/utils/handle";
import { useSlidingHoverCard } from "./useSlidingHoverCard";

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
  const { isPhone } = useViewport();
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Only a change of breakpoint moves it: opening on mount would undo the
  // user's collapse.
  const wasCompact = useRef(false);
  useEffect(() => {
    if (isPhone) setSidebarOpen(false);
    else if (wasCompact.current) setSidebarOpen(true);
    wasCompact.current = isPhone;
  }, [isPhone, setSidebarOpen]);

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
  const { containerRef, cardRef, handlers } =
    useSlidingHoverCard<HTMLDivElement>();

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full w-full pb-8"
      {...handlers}
    >
      <span
        ref={cardRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-md bg-active/60 opacity-0 transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      />
      {children}
    </div>
  );
}

/**
 * The current module's sub-navigation component from the route handles, or
 * undefined. The desktop sidebar and the compact section switcher both read it.
 */
export function useModuleSidebar() {
  const matches = useMatches();
  const handles = matches.map((match) => match.handle as Handle | undefined);
  return handles.some((handle) => handle?.hideModuleSidebar)
    ? undefined
    : handles.find((handle) => handle?.sidebar)?.sidebar;
}

/** Phones: the module sidebar, or a route's phone-only section switcher. */
export function useCompactModuleSidebar() {
  const matches = useMatches();
  const Sidebar = useModuleSidebar();
  if (Sidebar) return Sidebar;
  return matches
    .map((match) => match.handle as Handle | undefined)
    .find((handle) => handle?.compactSidebar)?.compactSidebar;
}

/**
 * The one module sidebar, rendered by the app shell around every page. A
 * module layout names its sub-navigation on its route handle (`sidebar`) and
 * the shell renders it here, so the sidebar's frame, width and collapsed
 * state stay put from module to module and only its links change. Pages
 * outside a module (detail pages) have none and get the full width.
 */
export function ModuleSidebarLayout({ children }: PropsWithChildren) {
  const Sidebar = useModuleSidebar();

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
  const { isPhone } = useViewport();

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

  // Compact: the app bar title opens the section switcher sheet instead.
  // Keep the zero-width occupant of the layout grid's first track.
  if (isPhone) return <div aria-hidden className="w-0" />;

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
