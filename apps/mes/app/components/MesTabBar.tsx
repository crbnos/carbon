// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, isEditableTarget, TabBar, TabBarItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuMenu } from "react-icons/lu";
import { useLocation } from "react-router";
import { path } from "~/utils/path";
import type { QueueKey } from "./AppSidebar";
import { QUEUES, queuePath, useQueueTitles } from "./AppSidebar";

const TAB_KEYS: QueueKey[] = [
  "operations",
  "assigned",
  "active",
  "maintenance"
];

// Root pages that the More tab stands for.
const MORE_PATHS: string[] = [path.to.timeCardPage];

// Exact paths: `/x/picking/:id` shares the Picking prefix but is a pushed page.
const ROOT_PATHS = new Set([
  ...QUEUES.map((queue) => queuePath(queue.to)),
  path.to.timeCardPage
]);

const trimSlash = (pathname: string) => pathname.replace(/\/$/, "");

/** True on the root pages that show the tab bar. */
export function isTabBarPath(pathname: string) {
  return ROOT_PATHS.has(trimSlash(pathname));
}

const NON_TEXT_INPUTS = ["checkbox", "radio", "button", "submit", "reset"];

/**
 * Phones: Schedule · Assigned · Active · Maintenance · More, on root pages
 * only. More opens the More sheet (tools and the user menu); the other queues
 * are behind the app bar title. Hidden while a text field has focus.
 */
export function MesTabBar({
  activeEvents,
  activeMaintenanceCount,
  moreOpen,
  onMoreOpenChange
}: {
  activeEvents: number;
  activeMaintenanceCount: number;
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const titles = useQueueTitles();
  const { pathname } = useLocation();
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      setIsTyping(
        isEditableTarget(target) &&
          !(
            target instanceof HTMLInputElement &&
            NON_TEXT_INPUTS.includes(target.type)
          )
      );
    };
    const onFocusOut = () => setIsTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  if (!isTabBarPath(pathname)) return null;

  const current = trimSlash(pathname);
  const counts: Partial<Record<QueueKey, number>> = {
    active: activeEvents,
    maintenance: activeMaintenanceCount
  };

  return (
    <TabBar
      aria-label={t`Main`}
      data-mes-tab-bar=""
      data-visible={isTyping ? "false" : "true"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 min-h-[var(--mes-tab-bar-h)]",
        isTyping && "hidden"
      )}
    >
      {QUEUES.filter((queue) => TAB_KEYS.includes(queue.key)).map((queue) => (
        <TabBarItem
          key={queue.key}
          to={queue.to}
          icon={<queue.icon />}
          label={titles[queue.key]}
          isActive={current === queuePath(queue.to)}
          count={counts[queue.key]}
          pill
        />
      ))}
      <TabBarItem
        icon={<LuMenu />}
        label={t`More`}
        isActive={MORE_PATHS.includes(current)}
        onClick={() => onMoreOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        pill
      />
    </TabBar>
  );
}
