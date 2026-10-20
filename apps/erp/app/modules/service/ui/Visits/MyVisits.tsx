// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Heading } from "@carbon/react";
import {
  parseAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuChevronRight, LuMapPin } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, Empty } from "~/components";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import { formatSiteAddress, mapUrl } from "../../service.models";
import type { ServiceVisit } from "../../types";
import { ServiceVisitStatus } from "../ServiceStatus";

/**
 * The signed-in technician's visits for today and the next 7 days, by the
 * company's day. Each card opens the visit; the pin opens the site in maps.
 * Phone-first: one column, 44 px targets.
 */
export default function MyVisits({
  visits,
  timeZone,
  today
}: {
  visits: ServiceVisit[];
  timeZone: string;
  /** The company's today, `YYYY-MM-DD`. */
  today: string;
}) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();

  const days = useMemo(() => {
    const byDay = new Map<string, ServiceVisit[]>();
    for (const visit of visits) {
      if (!visit.plannedStart) continue;
      const day = toCalendarDate(
        parseAbsolute(visit.plannedStart, timeZone)
      ).toString();
      byDay.set(day, [...(byDay.get(day) ?? []), visit]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visits, timeZone]);

  const tomorrow = parseDate(today).add({ days: 1 }).toString();
  const dayLabel = (day: string) =>
    day === today
      ? t`Today`
      : day === tomorrow
        ? t`Tomorrow`
        : formatDate(day, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center max-md:hidden">
        <Heading size="h3">
          <Trans>My Visits</Trans>
        </Heading>
      </div>
      {days.length === 0 ? (
        <Empty
          className="flex-1"
          title={<Trans>No visits planned</Trans>}
          description={
            <Trans>Your visits for today and the next 7 days show here.</Trans>
          }
        />
      ) : (
        <div className="flex w-full max-w-xl flex-col gap-6">
          {days.map(([day, list]) => (
            <section key={day} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {dayLabel(day)}
              </h2>
              <ul className="flex flex-col gap-3">
                {list.map((visit) => {
                  const order = visit.serviceOrder;
                  const address = formatSiteAddress(
                    order?.customerLocation?.address
                  );
                  return (
                    <li
                      key={visit.id}
                      className="flex items-stretch rounded-lg border border-border bg-card"
                    >
                      <Link
                        to={path.to.serviceVisit(
                          visit.serviceOrderId,
                          visit.id
                        )}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 p-3 hover:bg-accent/30 rounded-l-lg"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="whitespace-nowrap tabular-nums text-sm font-medium">
                              <DateTime
                                value={visit.plannedStart}
                                variant="time"
                              />
                              {visit.plannedEnd && (
                                <>
                                  {" – "}
                                  <DateTime
                                    value={visit.plannedEnd}
                                    variant="time"
                                  />
                                </>
                              )}
                            </span>
                            <ServiceVisitStatus status={visit.status} />
                          </div>
                          <span className="truncate text-sm font-medium">
                            {order?.customer?.name}
                          </span>
                          <span className="truncate text-sm text-muted-foreground">
                            {[order?.customerLocation?.name, address]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            <span className="whitespace-nowrap">
                              {order?.serviceOrderId}
                            </span>
                            {order?.trackedEntity?.readableId &&
                              ` · ${order.trackedEntity.readableId}`}
                            {order?.item?.name && ` · ${order.item.name}`}
                          </span>
                        </div>
                        <LuChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                      {address && (
                        <div className="flex shrink-0 items-center border-l border-border px-2">
                          <Button variant="ghost" size="lg" isIcon asChild>
                            <a
                              href={mapUrl(address)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={t`Open in maps`}
                            >
                              <LuMapPin className="size-5" />
                            </a>
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
