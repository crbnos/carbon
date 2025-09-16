"use client";

import { cn } from "@carbon/react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import useMeasure from "react-use-measure";

type Tab = {
  id: number;
  label: string | ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

interface OgImageSectionProps {
  tabs: Tab[];
  className?: string;
  rounded?: string;
  onChange?: () => void;
}

function DirectionAwareTabs({
  tabs,
  className,
  rounded,
  onChange,
}: OgImageSectionProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [ref, bounds] = useMeasure();

  const content = useMemo(() => {
    const activeTabContent = tabs.find((tab) => tab.id === activeTab)?.content;
    return activeTabContent || null;
  }, [activeTab, tabs]);

  const handleTabClick = (newTabId: number) => {
    if (newTabId !== activeTab && !isAnimating) {
      const newDirection = newTabId > activeTab ? 1 : -1;
      setDirection(newDirection);
      setActiveTab(newTabId);
      onChange?.();
    }
  };

  const variants = {
    initial: (direction: number) => ({
      x: 300 * direction,
      opacity: 0,
      filter: "blur(4px)",
    }),
    active: {
      x: 0,
      opacity: 1,
      filter: "blur(0px)",
    },
    exit: (direction: number) => ({
      x: -300 * direction,
      opacity: 0,
      filter: "blur(4px)",
    }),
  };

  return (
    <motion.div
      initial={{
        opacity: 0,
        filter: "blur(4px)",
      }}
      animate={{
        opacity: 1,
        filter: "blur(0px)",
      }}
      transition={{ duration: 0.2, delay: 0.3 }}
      className="flex flex-col items-center w-full"
    >
      <div
        className={cn(
          "flex flex-wrap  gap-1 rounded-lg cursor-pointer bg-muted p-1 shadow-inner w-auto",
          className,
          rounded
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            disabled={tab.disabled}
            onClick={() => handleTabClick(tab.id)}
            className={cn(
              "relative rounded-md px-3.5 py-1.5 text-sm font-medium text-foreground/80 transition focus-visible:outline-1 focus-visible:ring-2 ring-ring ring-offset-ring focus-visible:outline-none flex gap-2 items-center justify-center flex-initial",
              activeTab === tab.id
                ? "text-foreground"
                : "hover:text-foreground/60 text-foreground/80",
              rounded,
              tab.disabled && "cursor-not-allowed opacity-50"
            )}
            style={{ WebkitTapHighlightColor: "transparent" }}
          >
            {activeTab === tab.id && (
              <motion.span
                layoutId="bubble"
                className="absolute inset-0 z-10 bg-background text-foreground rounded-md border"
                transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              />
            )}
            <span className="z-20 text-center">{tab.label}</span>
          </button>
        ))}
      </div>
      <MotionConfig transition={{ duration: 0.4, type: "spring", bounce: 0 }}>
        <motion.div
          className="relative mx-auto w-full h-full overflow-hidden"
          initial={false}
          animate={{ height: bounds.height }}
        >
          <div className="p-1" ref={ref}>
            <AnimatePresence
              custom={direction}
              mode="popLayout"
              onExitComplete={() => setIsAnimating(false)}
            >
              <motion.div
                key={activeTab}
                variants={variants}
                initial="initial"
                animate="active"
                exit="exit"
                custom={direction}
                onAnimationStart={() => setIsAnimating(true)}
                onAnimationComplete={() => setIsAnimating(false)}
              >
                {content}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </MotionConfig>
    </motion.div>
  );
}
export { DirectionAwareTabs };
