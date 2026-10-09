// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import {
  parseAbsolute,
  parseDate,
  toCalendarDate
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import { useDateFormatter, useUrlParams } from "~/hooks";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";
import type { ServiceVisitStatus as ServiceVisitStatusType } from "../../service.models";
import { serviceVisitStatuses } from "../../service.models";
import type { ServiceVisit } from "../../types";
import { ServiceVisitStatus } from "../ServiceStatus";

/** The filter value that shows every visit not yet done. */
export const OPEN_VISITS = "open";

type DayGroup = {
  day: string;
  technicians: { technicianId: string; visits: ServiceVisit[] }[];
};

/**
 * Groups visits by the company's day of their planned start, then by
 * technician (by name). Visits keep their order (planned start).
 */
function groupVisits(
  visits: ServiceVisit[],
  timeZone: string,
  nameOf: (id: string) => string
): DayGroup[] {
  const days = new Map<string, Map<string, ServiceVisit[]>>();
  for (const visit of visits) {
    if (!visit.plannedStart) continue;
    const day = toCalendarDate(
      parseAbsolute(visit.plannedStart, timeZone)
    ).toString();
    const technicians = days.get(day) ?? new Map<string, ServiceVisit[]>();
    technicians.set(visit.technicianId, [
      ...(technicians.get(visit.technicianId) ?? []),
      visit
    ]);
    days.set(day, technicians);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, technicians]) => ({
      day,
      technicians: [...technicians.entries()]
        .map(([technicianId, list]) => ({ technicianId, visits: list }))
        .sort((a, b) =>
          nameOf(a.technicianId).localeCompare(nameOf(b.technicianId))
        )
    }));
}

/**
 * Dispatch's view of the field: the visits of a week, by day and then by
 * technician, filtered by status and technician. A row opens the visit.
 */
export default function ServiceSchedule({
  visits,
  timeZone,
  from,
  days
}: {
  visits: ServiceVisit[];
  timeZone: string;
  /** The first day shown, `YYYY-MM-DD` on the company's calendar. */
  from: string;
  days: number;
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const [params, setParams] = useUrlParams();
  const { formatDate } = useDateFormatter();

  const nameOf = useMemo(() => {
    const names = new Map(people.map((person) => [person.id, person.name]));
    return (id: string) => names.get(id) ?? "";
  }, [people]);
  const groups = useMemo(
    () => groupVisits(visits, timeZone, nameOf),
    [visits, timeZone, nameOf]
  );

  const statusLabels: Record<ServiceVisitStatusType, string> = {
    Scheduled: t`Scheduled`,
    Traveling: t`Traveling`,
    "On Site": t`On Site`,
    Completed: t`Completed`,
    Cancelled: t`Cancelled`
  };

  const start = parseDate(from);
  const end = start.add({ days: days - 1 });
  const shift = (offset: number) =>
    setParams({ from: start.add({ days: offset }).toString() });

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Heading size="h3">
            <Trans>Schedule</Trans>
          </Heading>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {formatDate(start.toString())} – {formatDate(end.toString())}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            aria-label={t`Previous week`}
            icon={<LuChevronLeft />}
            variant="secondary"
            onClick={() => shift(-days)}
          />
          <Button variant="secondary" onClick={() => setParams({ from: null })}>
            <Trans>Today</Trans>
          </Button>
          <IconButton
            aria-label={t`Next week`}
            icon={<LuChevronRight />}
            variant="secondary"
            onClick={() => shift(days)}
          />
          <Select
            value={params.get("status") ?? OPEN_VISITS}
            onValueChange={(value) =>
              setParams({ status: value === OPEN_VISITS ? null : value })
            }
          >
            <SelectTrigger aria-label={t`Status`} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={OPEN_VISITS}>{t`Not done`}</SelectItem>
              <SelectItem value="all">{t`All statuses`}</SelectItem>
              {serviceVisitStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {statusLabels[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={params.get("technicianId") ?? "all"}
            onValueChange={(value) =>
              setParams({ technicianId: value === "all" ? null : value })
            }
          >
            <SelectTrigger aria-label={t`Technician`} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t`All technicians`}</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          <Trans>No visits are planned in these days.</Trans>
        </p>
      ) : (
        groups.map((group) => (
          <Card key={group.day}>
            <CardHeader>
              <CardTitle>
                {formatDate(group.day, {
                  weekday: "long",
                  month: "long",
                  day: "numeric"
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {group.technicians.map(({ technicianId, visits: list }) => (
                <div key={technicianId} className="flex flex-col gap-2">
                  <EmployeeAvatar employeeId={technicianId} />
                  <ul className="flex flex-col rounded-lg border border-border divide-y divide-border">
                    {list.map((visit) => (
                      <li key={visit.id}>
                        <Link
                          to={path.to.serviceVisit(
                            visit.serviceOrderId,
                            visit.id
                          )}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm hover:bg-accent/30"
                        >
                          <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
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
                          <span className="shrink-0 whitespace-nowrap font-medium">
                            {visit.serviceOrder?.serviceOrderId}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {[
                              visit.serviceOrder?.customer?.name,
                              visit.serviceOrder?.customerLocation?.name
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                            {visit.serviceOrder?.trackedEntity?.readableId}
                          </span>
                          <span className="shrink-0">
                            <ServiceVisitStatus status={visit.status} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
