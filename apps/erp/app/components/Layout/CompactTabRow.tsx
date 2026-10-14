// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Count, cn, PrefetchLink } from "@carbon/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

export type CompactTabItem = {
  id: string;
  label: ReactNode;
  active: boolean;
  /** A link tab; `onClick` still runs on tap. */
  to?: string;
  onClick?: () => void;
  count?: number;
  disabled?: boolean;
};

const tabClassName =
  "relative flex disabled:opacity-50 min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-[15px] font-medium text-muted-foreground outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full data-[active=true]:text-foreground data-[active=true]:after:bg-foreground";

/** Phones: a horizontally scrolling underline tab row. */
export function CompactTabRow({
  items,
  className
}: {
  items: CompactTabItem[];
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const activeId = items.find((item) => item.active)?.id;

  // Keep the current tab in view in the scrolling row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the active tab changes
  useEffect(() => {
    rowRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeId]);

  return (
    <div
      ref={rowRef}
      role="tablist"
      className={cn(
        "flex shrink-0 gap-5 overflow-x-auto scrollbar-hide scroll-fade-x border-b border-border bg-card px-4",
        className
      )}
    >
      {items.map((item) => {
        const content = (
          <>
            <span>{item.label}</span>
            {item.count !== undefined && <Count count={item.count} />}
          </>
        );
        return item.to ? (
          <PrefetchLink
            key={item.id}
            to={item.to}
            role="tab"
            data-active={item.active}
            aria-selected={item.active}
            aria-current={item.active ? "page" : undefined}
            className={tabClassName}
            onClick={item.onClick}
          >
            {content}
          </PrefetchLink>
        ) : (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-active={item.active}
            aria-selected={item.active}
            disabled={item.disabled}
            className={tabClassName}
            onClick={item.onClick}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
