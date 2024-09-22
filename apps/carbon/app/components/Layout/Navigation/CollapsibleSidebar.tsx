import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
} from "@carbon/react";
import { motion } from "framer-motion";
import { useMemo, type PropsWithChildren } from "react";
import { LuArrowLeftFromLine, LuArrowRightFromLine } from "react-icons/lu";

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
        width: 4,
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
            <IconButton
              onClick={sidebar.onToggle}
              icon={
                sidebar.isOpen ? (
                  <LuArrowLeftFromLine />
                ) : (
                  <LuArrowRightFromLine />
                )
              }
              aria-label="Toggle sidebar"
              className="bg-popover inline-block border border-border border-l-0 absolute pl-2 top-[calc(100vh-135px)] text-muted-foreground right-[-31px] left-auto rounded-l-none z-[3] hover:bg-popover p-0 shadow-none"
            />
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
