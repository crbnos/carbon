// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { cn, useViewport } from "@carbon/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { CompactTabRow } from "./Layout/CompactTabRow";

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
  onChange
}: OgImageSectionProps) {
  const [activeTab, setActiveTab] = useState(0);
  const { isPhone } = useViewport();

  const content = useMemo(() => {
    const activeTabContent = tabs.find((tab) => tab.id === activeTab)?.content;
    return activeTabContent || null;
  }, [activeTab, tabs]);

  const handleTabClick = (newTabId: number) => {
    if (newTabId !== activeTab) {
      setActiveTab(newTabId);
      onChange?.();
    }
  };

  return (
    <div className="flex flex-col items-center w-full">
      {isPhone ? (
        // Phones: the record pages' scrolling tab row, pinned over the content.
        <CompactTabRow
          className="sticky top-0 z-10 -mx-4 w-[calc(100%+2rem)] bg-popover"
          items={tabs.map((tab) => ({
            id: String(tab.id),
            label: tab.label,
            active: activeTab === tab.id,
            disabled: tab.disabled,
            onClick: () => handleTabClick(tab.id)
          }))}
        />
      ) : (
        <div
          className={cn(
            "flex flex-wrap  gap-1 rounded-lg cursor-pointer bg-muted p-1 shadow-inner w-auto",
            className,
            rounded
          )}
        >
          {tabs.map((tab) => (
            <button
              type="button"
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
                <span className="absolute inset-0 z-10 bg-background text-foreground rounded-md border" />
              )}
              <span className="z-20 text-center">{tab.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative mx-auto w-full h-full">
        <div className="p-1">{content}</div>
      </div>
    </div>
  );
}

export { DirectionAwareTabs };
