import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { motion } from "framer-motion";
import { useMemo, type PropsWithChildren } from "react";
import { LuPanelLeftClose, LuPanelLeftOpen } from "react-icons/lu";

export const CollapsibleSidebar = ({
  children,
  width = 180,
}: PropsWithChildren<{ width?: number }>) => {
  const sidebar = useDisclosure({
    defaultIsOpen: true,
  });

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
      animate={sidebar.isOpen ? "visible" : "hidden"}
      initial={variants.visible}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      variants={variants}
      className="relative flex h-[calc(100vh-49px)]"
    >
      <div className="h-full w-full overflow-y-scroll bg-card border-r border-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={sidebar.onToggle}
              aria-label="Toggle sidebar"
              variant="secondary"
              className="bg-card inline-block border border-border border-l-0 absolute top-[calc(100vh-135px)] text-muted-foreground right-[-31px] left-auto rounded-l-none z-[3] hover:bg-card p-0 shadow-none w-8 h-8"
            >
              {sidebar.isOpen ? (
                <LuPanelLeftClose className="w-4 h-4 ml-1" />
              ) : (
                <LuPanelLeftOpen className="w-4 h-4 ml-1" />
              )}
            </Button>
          </TooltipTrigger>

          <TooltipContent side="right">
            {<span>{sidebar.isOpen ? "Collapse" : "Expand"}</span>}
          </TooltipContent>
        </Tooltip>

        {sidebar.isOpen ? children : null}
      </div>
    </motion.div>
  );
};
