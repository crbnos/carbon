import { cn, IconButton, useDisclosure } from "@carbon/react";
import { motion } from "framer-motion";
import type { ComponentProps, PropsWithChildren } from "react";
import { createContext, forwardRef, useContext, useMemo } from "react";
import { LuPanelLeft } from "react-icons/lu";

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
    return { hasSidebar: false, isOpen: false, onToggle: () => {} };
  }
  return context;
}

export function CollapsibleSidebarProvider({ children }: PropsWithChildren) {
  const disclosure = useDisclosure({ defaultIsOpen: true });

  return (
    <CollapsibleSidebarContext.Provider
      value={{
        hasSidebar: true,
        isOpen: disclosure.isOpen,
        onToggle: disclosure.onToggle,
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

export const CollapsibleSidebar = ({
  children,
  width = 180,
}: PropsWithChildren<{ width?: number }>) => {
  const { isOpen } = useCollapsibleSidebar();

  const variants = useMemo(() => {
    return {
      visible: {
        width,
      },
      hidden: {
        width: 0,
      },
    };
  }, [width]);

  return (
    <motion.div
      animate={isOpen ? "visible" : "hidden"}
      initial={variants.visible}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      variants={variants}
      className="relative flex h-[calc(100dvh-49px)]"
    >
      <div className="h-full w-full overflow-y-scroll scrollbar-thin bg-card border-r border-border">
        {isOpen ? children : null}
      </div>
    </motion.div>
  );
};
