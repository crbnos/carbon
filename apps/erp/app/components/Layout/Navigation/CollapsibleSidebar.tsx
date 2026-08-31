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
  useMemo
} from "react";
import { LuPanelLeft } from "react-icons/lu";
import { useOptimisticLocation } from "~/hooks";
import { useUIStore } from "~/stores/ui";

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

export function CollapsibleSidebarProvider({ children }: PropsWithChildren) {
  const isMobile = useIsMobile();
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setHasContentSidebar = useUIStore(
    (state) => state.setHasContentSidebar
  );

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    } else {
      setSidebarOpen(true);
    }
  }, [isMobile, setSidebarOpen]);

  // Tell the (global) Topbar that this route has a content sub-nav, so it can
  // surface a mobile "Sections" trigger. Cleared when the module unmounts.
  useEffect(() => {
    setHasContentSidebar(true);
    return () => setHasContentSidebar(false);
  }, [setHasContentSidebar]);

  return (
    <CollapsibleSidebarContext.Provider
      value={{
        hasSidebar: true,
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

export const CollapsibleSidebar = ({
  children,
  width = 180
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
      initial={shouldReduceMotion ? false : variants.visible}
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
      className="relative flex h-[calc(100dvh-var(--topbar-height))]"
    >
      <div className="h-full w-full overflow-hidden bg-card border-r border-border">
        {isOpen ? children : null}
      </div>
    </motion.div>
  );
};
