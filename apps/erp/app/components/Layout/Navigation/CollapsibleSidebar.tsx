import { cn, IconButton, useIsMobile } from "@carbon/react";
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

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    } else {
      setSidebarOpen(true);
    }
  }, [isMobile, setSidebarOpen]);

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
      className="relative flex h-[calc(100dvh-49px)]"
    >
      <div className="h-full w-full overflow-y-scroll scrollbar-thin bg-card border-r border-border">
        {isOpen ? children : null}
      </div>
    </motion.div>
  );
};
