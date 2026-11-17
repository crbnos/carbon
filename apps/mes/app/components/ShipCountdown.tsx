// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { getShipCountdown } from "@carbon/utils";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { LuTruck } from "react-icons/lu";

type ShipCountdownProps = {
  /** the job's ship-by date: its sales order line's promised date */
  shipByDate?: string | null;
  /** the plant's calendar day (the location's time zone) */
  today: string;
  /** a Completed or Cancelled job shows no countdown */
  jobStatus?: string | null;
  className?: string;
};

/**
 * Days until the job's sales order line must ship: "Ships in 3 days",
 * "Ships tomorrow", "Ships today", "2 days late". Amber today and tomorrow,
 * red once late. Nothing for a job with no sales order line.
 */
export function ShipCountdown({
  shipByDate,
  today,
  jobStatus,
  className
}: ShipCountdownProps) {
  const { t } = useLingui();
  if (jobStatus === "Completed" || jobStatus === "Cancelled") return null;
  const countdown = getShipCountdown(shipByDate, today);
  if (!countdown) return null;

  const { days, tone } = countdown;
  const late = -days;
  const label =
    days < 0
      ? t`${plural(late, { one: "# day late", other: "# days late" })}`
      : days === 0
        ? t`Ships today`
        : days === 1
          ? t`Ships tomorrow`
          : t`${plural(days, { one: "Ships in # day", other: "Ships in # days" })}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        tone === "late" && "text-red-500",
        tone === "warning" && "text-amber-500",
        className
      )}
    >
      <LuTruck aria-hidden className="shrink-0" />
      {label}
    </span>
  );
}
