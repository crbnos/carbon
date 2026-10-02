// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import type { TabDef } from "~/components/Tabs";
import { TabBar } from "~/components/Tabs";
import { useActiveQuery } from "./useQueueQueries";

/**
 * Schedule · Assigned · Active · Recent — web MES's four OPERATIONS sidebar
 * items, as a segmented control at the top of this app's Schedule tab.
 *
 * Why a switcher and not four tabs: the bottom bar is full at five (Schedule,
 * Picking, Scan, Time card, More) and a sixth would start truncating labels,
 * which is exactly the bug that made the bar unusable before. Why a switcher
 * and not four rows on the More screen: these four are one body of work seen
 * four ways and an operator moves between them constantly — "what am I meant to
 * be doing", "what am I clocked onto", "what was I just on" — so the move has
 * to be one tap from any of them, and the Active count has to be readable
 * without opening anything.
 *
 * It is the SAME `TabBar` the operation screen uses, so the control an operator
 * already knows from inside a job is the one that moves them between queues.
 *
 * Switching `replace`s rather than pushes. These are siblings, not a drill-down:
 * pushing would stack Assigned on Active on Recent behind a Back button nobody
 * wants, and would make the hardware back button walk an operator through every
 * queue they had glanced at. Replacing also makes the chosen view the tab's
 * root, so tapping away to Picking and back returns to the queue they were on
 * rather than resetting to the board.
 */
export type QueueView = "board" | "assigned" | "active" | "recent";

const HREF: Record<QueueView, string> = {
  board: "/(app)/(tabs)/operations",
  assigned: "/(app)/(tabs)/operations/assigned",
  active: "/(app)/(tabs)/operations/active",
  recent: "/(app)/(tabs)/operations/recent"
};

export function QueueSwitcher({ current }: { current: QueueView }) {
  const { t } = useLingui();
  // Web MES badges this count in its sidebar; it is the one number of the four
  // that tells an operator something they cannot see from where they are.
  const active = useActiveQuery();
  const running = active.data?.operations.length ?? 0;

  const tabs: TabDef<QueueView>[] = [
    { value: "board", label: t`Schedule` },
    { value: "assigned", label: t`Assigned` },
    {
      value: "active",
      label: t`Active`,
      badge: running ? String(running) : undefined
    },
    { value: "recent", label: t`Recent` }
  ];

  return (
    <TabBar
      tabs={tabs}
      value={current}
      onChange={(next) => {
        if (next === current) return;
        router.replace(HREF[next] as never);
      }}
    />
  );
}
