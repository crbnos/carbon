// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, NavRailItem, NavRailLink } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuClock, LuPlay, LuSquare } from "react-icons/lu";
import { useFetcher, useLocation } from "react-router";
import { path } from "~/utils/path";

type TimeCardButtonProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

function formatElapsed(since: string) {
  const ms = Date.now() - new Date(since).getTime();
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function TimeCardButton({ openClockEntry }: TimeCardButtonProps) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const { pathname } = useLocation();
  const [, setTick] = useState(0);

  const isClockedIn =
    openClockEntry !== null ||
    (fetcher.formData?.get("intent") === "clockIn" && fetcher.state !== "idle");

  useEffect(() => {
    if (!openClockEntry) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  const handleClockOut = () => {
    const formData = new FormData();
    formData.append("intent", "clockOut");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timecard
    });
  };

  const handleClockIn = () => {
    const formData = new FormData();
    formData.append("intent", "clockIn");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timecard
    });
  };

  const isOnTimeCardPage = pathname.includes("/timecard");

  return (
    <>
      {isClockedIn ? (
        <NavRailItem
          icon={<LuSquare />}
          label={t`Clock Out`}
          onClick={handleClockOut}
          disabled={fetcher.state !== "idle"}
          trailing={
            openClockEntry && (
              <Badge
                variant="red"
                className="min-h-5 px-1 text-[10px] tabular-nums"
              >
                {formatElapsed(openClockEntry.clockIn)}
              </Badge>
            )
          }
        />
      ) : (
        <NavRailItem
          icon={<LuPlay />}
          label={t`Clock In`}
          onClick={handleClockIn}
          disabled={fetcher.state !== "idle"}
        />
      )}

      <NavRailLink
        to={path.to.timeCardPage}
        icon={<LuClock />}
        label={t`My Hours`}
        isActive={isOnTimeCardPage}
      />
    </>
  );
}
