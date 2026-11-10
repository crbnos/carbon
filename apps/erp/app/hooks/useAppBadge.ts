// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { useTopic } from "@carbon/query";
import { useCarbon, useRouteData } from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { employeeCompanyIds, setAppBadge } from "~/utils/app-badge";
import { path } from "~/utils/path";

const logger = getLogger("erp", "useappbadge");

// A bulk change (mark all read) broadcasts once per row; count once.
const RECOUNT_DELAY_MS = 500;

// The installed app's icon badge: the user's unread notifications in every
// company they work in. The bell counts one company; the icon stands for the
// whole app, and a push from any company sets it the same way (send-push
// "count-unread"). Recounted whenever the user's notifications change — the
// topic carries every company's rows.
export function useAppBadge({ userId }: { userId: string }) {
  const { carbon } = useCarbon();
  const shell = useRouteData<{
    companies: { companyId: string | null; role: string | null }[];
  }>(path.to.authenticatedRoot);
  // A string, so a revalidation that returns the same companies is no change.
  const companyIds = useMemo(
    () => employeeCompanyIds(shell?.companies ?? []).join(","),
    [shell?.companies]
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only the latest recount may set the badge: an older query that finishes
  // last would restore a stale count, and one still running at unmount (sign
  // out) would undo the login page's clear.
  const latest = useRef(0);

  const recount = useCallback(async () => {
    if (!carbon) return;
    const run = ++latest.current;
    // No company left to count (the last employee membership was removed):
    // nothing is unread, and the bump above discards a recount still running.
    if (!companyIds) {
      setAppBadge(0);
      return;
    }
    const { count, error } = await carbon
      .from("notification")
      .select("id", { count: "exact", head: true })
      .eq("userId", userId)
      .in("companyId", companyIds.split(","))
      .is("readAt", null)
      .is("digestedInto", null);
    if (run !== latest.current) return;
    if (error) {
      logger.warn("Failed to count unread notifications for the badge", {
        error
      });
      return;
    }
    setAppBadge(count ?? 0);
  }, [carbon, companyIds, userId]);

  useEffect(() => {
    recount();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      latest.current++;
    };
  }, [recount]);

  useTopic(`user:${userId}:notification`, () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(recount, RECOUNT_DELAY_MS);
  });
}
