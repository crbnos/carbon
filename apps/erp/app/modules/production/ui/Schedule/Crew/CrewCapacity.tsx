import {
  cn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import {
  today as calendarToday,
  getLocalTimeZone
} from "@internationalized/date";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, useCallback, useMemo } from "react";
import { LuInfo } from "react-icons/lu";
import { DateTime } from "~/components";
import { CrewChip } from "./CrewChip";
import {
  assignmentHours,
  buildAbsentSet,
  formatHours,
  STICKY_HEADER
} from "./crewShared";

// the base Th ships with group-hover:bg-muted (Tr has class "group");
// keep headers hover-inert while data rows use the default row hover
function CapacityTh({ className, ...props }: ComponentProps<typeof Th>) {
  return (
    <Th className={cn("group-hover:bg-transparent", className)} {...props} />
  );
}

const SERIES_LABEL =
  "whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted-foreground";

type CapacityWorkCenter = {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
};

// internal column shape (one per day) so the sums are written once
type CapacityColumn = {
  key: string;
  label: ReactNode;
  dates: string[];
  isCurrent?: boolean;
};

type CrewCapacityProps = {
  weekDates: string[];
  locationTimeZone?: string;
  workCenters: CapacityWorkCenter[];
  assignments: {
    employeeId: string;
    workCenterId: string;
    date: string;
    shiftId: string | null;
    overtimeHours: number;
    hours: number | null;
  }[];
  absences: { employeeId: string; date: string }[];
  demandByWorkCenter: Record<
    string,
    { pastDue: number; days: Record<string, number> }
  >;
  scheduledByWorkCenter: Record<string, Record<string, number>>;
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
  calendarHoursByDate: Record<string, number>;
};

function loadCellClass(loadPct: number | null) {
  if (loadPct === null) return "text-muted-foreground";
  if (loadPct > 1.2) return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (loadPct > 1) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
}

/**
 * The load verdict in hours, not percentages: "+34h" = 34 hours more work due
 * than the station has; "6h free" = headroom. The load % lives in the tooltip.
 */
function LoadCell({
  demand,
  available
}: {
  demand: number;
  available: number;
}) {
  if (demand === 0) {
    return <span className="text-sm text-muted-foreground/50">—</span>;
  }
  const pct = available > 0 ? demand / available : Number.POSITIVE_INFINITY;
  const delta = demand - available;
  const title = Number.isFinite(pct)
    ? `${Math.round(pct * 100)}% loaded (${formatHours(demand)}h due / ${formatHours(available)}h available)`
    : `${formatHours(demand)}h due with no available hours`;
  return (
    <CrewChip
      tooltip={title}
      className={cn(
        "min-w-[52px] justify-center tabular-nums",
        loadCellClass(pct)
      )}
    >
      {delta > 0 ? (
        <Trans>+{formatHours(delta)}h</Trans>
      ) : (
        <Trans>{formatHours(-delta)}h free</Trans>
      )}
    </CrewChip>
  );
}

export function CrewCapacity({
  weekDates,
  locationTimeZone,
  workCenters,
  assignments,
  absences,
  demandByWorkCenter,
  scheduledByWorkCenter,
  shiftHoursById,
  employeeShiftHours,
  defaultShiftHours,
  calendarHoursByDate
}: CrewCapacityProps) {
  const absentSet = useMemo(() => buildAbsentSet(absences), [absences]);

  // present crew labor hours per work center per date (all shifts, minus
  // absent), using each assignment's real shift duration
  const crewHours = useMemo(() => {
    const map = new Map<string, number>();
    // Overtime is day-scoped and stamped on every row of the person's day, so
    // it's added ONCE — to their last station of the day, mirroring the
    // scheduler, which extends the last window of the day.
    const lastRowByPersonDate = new Map<string, (typeof assignments)[number]>();
    for (const assignment of assignments) {
      if (absentSet.has(`${assignment.employeeId}:${assignment.date}`)) {
        continue;
      }
      const hours = assignmentHours(assignment, {
        shiftHoursById,
        employeeShiftHours,
        defaultShiftHours
      });
      const key = `${assignment.workCenterId}:${assignment.date}`;
      map.set(key, (map.get(key) ?? 0) + hours);
      lastRowByPersonDate.set(
        `${assignment.employeeId}:${assignment.date}`,
        assignment
      );
    }
    for (const assignment of lastRowByPersonDate.values()) {
      const overtime = assignment.overtimeHours ?? 0;
      if (overtime <= 0) continue;
      const key = `${assignment.workCenterId}:${assignment.date}`;
      map.set(key, (map.get(key) ?? 0) + overtime);
    }
    return map;
  }, [
    assignments,
    absentSet,
    shiftHoursById,
    employeeShiftHours,
    defaultShiftHours
  ]);

  const availableHours = useCallback(
    (workCenterId: string, date: string) => {
      const crew = crewHours.get(`${workCenterId}:${date}`) ?? 0;
      if (crew > 0) return crew;
      // uncrewed fallback: the location's shift calendar for that weekday
      return calendarHoursByDate[date] ?? 0;
    },
    [crewHours, calendarHoursByDate]
  );

  const today = calendarToday(getLocalTimeZone()).toString();

  const columns: CapacityColumn[] = useMemo(
    () =>
      weekDates.map((date) => ({
        key: date,
        label: (
          <DateTime
            value={date}
            variant="date"
            dateOptions={{ weekday: "short", month: "short", day: "numeric" }}
            locationTimeZone={locationTimeZone}
          />
        ),
        dates: [date],
        isCurrent: date === today
      })),
    [weekDates, locationTimeZone, today]
  );

  const demandForColumn = useCallback(
    (workCenterId: string, column: CapacityColumn) =>
      column.dates.reduce(
        (sum, date) =>
          sum + (demandByWorkCenter[workCenterId]?.days[date] ?? 0),
        0
      ),
    [demandByWorkCenter]
  );
  const scheduledForColumn = useCallback(
    (workCenterId: string, column: CapacityColumn) =>
      column.dates.reduce(
        (sum, date) => sum + (scheduledByWorkCenter[workCenterId]?.[date] ?? 0),
        0
      ),
    [scheduledByWorkCenter]
  );
  const availableForColumn = useCallback(
    (workCenterId: string, column: CapacityColumn) =>
      column.dates.reduce(
        (sum, date) => sum + availableHours(workCenterId, date),
        0
      ),
    [availableHours]
  );

  const byDepartment = useMemo(() => {
    const groups = new Map<string, CapacityWorkCenter[]>();
    for (const workCenter of workCenters) {
      const key = workCenter.departmentName ?? "";
      const group = groups.get(key);
      if (group) group.push(workCenter);
      else groups.set(key, [workCenter]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workCenters]);

  // traffic-light totals across every work-center/column load cell
  const summary = useMemo(() => {
    let green = 0;
    let amber = 0;
    let red = 0;
    for (const workCenter of workCenters) {
      for (const column of columns) {
        const demand = demandForColumn(workCenter.id, column);
        const available = availableForColumn(workCenter.id, column);
        if (demand === 0) continue;
        const pct = available > 0 ? demand / available : Infinity;
        if (pct > 1.2) red += 1;
        else if (pct > 1) amber += 1;
        else green += 1;
      }
    }
    return { green, amber, red };
  }, [workCenters, columns, demandForColumn, availableForColumn]);

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden p-4 gap-4">
      <div className="flex items-center justify-between gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <LuInfo className="h-3.5 w-3.5" />
              <Trans>What these rows mean</Trans>
            </button>
          </TooltipTrigger>
          <TooltipContent align="start" className="max-w-[320px]">
            <div className="flex flex-col gap-1.5 text-xs">
              <p>
                <span className="font-medium">
                  <Trans>Demand</Trans>
                </span>{" "}
                — <Trans>the job hours due that day.</Trans>
              </p>
              <p>
                <span className="font-medium">
                  <Trans>Scheduled</Trans>
                </span>{" "}
                — <Trans>the hours the scheduler actually placed.</Trans>
              </p>
              <p>
                <span className="font-medium">
                  <Trans>Available</Trans>
                </span>{" "}
                —{" "}
                <Trans>
                  the shift hours of the crew you've assigned. Stations with
                  nobody on them fall back to the location's shift calendar.
                </Trans>
              </p>
              <p>
                <span className="font-medium">
                  <Trans>Load</Trans>
                </span>{" "}
                —{" "}
                <Trans>
                  how far over capacity the day is (+) or how many hours are
                  still free.
                </Trans>
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
            {summary.green} <Trans>ok</Trans>
          </span>
          <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400">
            {summary.amber} <Trans>tight</Trans>
          </span>
          <span className="inline-flex items-center rounded-md bg-red-500/15 px-2 py-0.5 text-red-700 dark:text-red-400">
            {summary.red} <Trans>overloaded</Trans>
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border bg-card shadow-sm">
        <Table full>
          <Thead>
            <Tr>
              <CapacityTh className={cn(STICKY_HEADER, "min-w-[180px]")}>
                <Trans>Work Center</Trans>
              </CapacityTh>
              <CapacityTh className={cn(STICKY_HEADER, "min-w-[90px]")}>
                <Trans>Series</Trans>
              </CapacityTh>
              <CapacityTh
                className={cn(STICKY_HEADER, "text-center min-w-[80px]")}
              >
                <Trans>Past due</Trans>
              </CapacityTh>
              {columns.map((column) => (
                <CapacityTh
                  key={column.key}
                  className={cn(
                    STICKY_HEADER,
                    "text-center min-w-[110px]",
                    column.isCurrent && "text-primary"
                  )}
                >
                  {column.label}
                </CapacityTh>
              ))}
              <CapacityTh
                className={cn(STICKY_HEADER, "text-center min-w-[80px]")}
              >
                <Trans>Week</Trans>
              </CapacityTh>
            </Tr>
          </Thead>
          {byDepartment.map(([departmentName, group]) => (
            <Fragment key={departmentName || "no-department"}>
              {departmentName && (
                <Tbody>
                  <Tr>
                    <Td
                      colSpan={columns.length + 4}
                      className="bg-muted/50 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {departmentName}
                    </Td>
                  </Tr>
                </Tbody>
              )}
              {group.map((workCenter) => {
                const demand = demandByWorkCenter[workCenter.id];
                const demandWeek = columns.reduce(
                  (sum, column) => sum + demandForColumn(workCenter.id, column),
                  0
                );
                const scheduledWeek = columns.reduce(
                  (sum, column) =>
                    sum + scheduledForColumn(workCenter.id, column),
                  0
                );
                const availableWeek = columns.reduce(
                  (sum, column) =>
                    sum + availableForColumn(workCenter.id, column),
                  0
                );
                const pastDue = demand?.pastDue ?? 0;
                return (
                  <Tbody
                    key={workCenter.id}
                    className="border-b border-border last:border-0"
                  >
                    <Tr className="border-b border-border/40">
                      <Td
                        rowSpan={4}
                        className="bg-card align-middle group-hover:bg-transparent"
                      >
                        <span className="text-sm font-semibold text-foreground">
                          {workCenter.name}
                        </span>
                      </Td>
                      <Td className={SERIES_LABEL}>
                        <Trans>Demand</Trans>
                      </Td>
                      <Td
                        className={cn(
                          "text-center text-sm tabular-nums",
                          pastDue > 0
                            ? "font-semibold text-red-700 dark:text-red-400"
                            : "text-muted-foreground/50"
                        )}
                      >
                        {pastDue > 0 ? formatHours(pastDue) : "—"}
                      </Td>
                      {columns.map((column) => {
                        const value = demandForColumn(workCenter.id, column);
                        return (
                          <Td
                            key={column.key}
                            className={cn(
                              "text-center text-sm tabular-nums",
                              value === 0
                                ? "text-muted-foreground/50"
                                : "font-medium",
                              column.isCurrent && "bg-muted/30"
                            )}
                          >
                            {value === 0 ? "—" : formatHours(value)}
                          </Td>
                        );
                      })}
                      <Td className="border-l border-border/60 text-center text-sm font-semibold tabular-nums">
                        {formatHours(demandWeek)}
                      </Td>
                    </Tr>
                    <Tr className="border-b border-border/40">
                      <Td className={SERIES_LABEL}>
                        <Trans>Scheduled</Trans>
                      </Td>
                      <Td className="text-center text-sm text-muted-foreground/50">
                        —
                      </Td>
                      {columns.map((column) => {
                        const value = scheduledForColumn(workCenter.id, column);
                        return (
                          <Td
                            key={column.key}
                            className={cn(
                              "text-center text-sm tabular-nums",
                              value === 0
                                ? "text-muted-foreground/50"
                                : "text-muted-foreground",
                              column.isCurrent && "bg-muted/30"
                            )}
                          >
                            {value === 0 ? "—" : formatHours(value)}
                          </Td>
                        );
                      })}
                      <Td className="border-l border-border/60 text-center text-sm tabular-nums text-muted-foreground">
                        {formatHours(scheduledWeek)}
                      </Td>
                    </Tr>
                    <Tr className="border-b border-border/40">
                      <Td className={SERIES_LABEL}>
                        <Trans>Available</Trans>
                      </Td>
                      <Td className="text-center text-sm text-muted-foreground/50">
                        —
                      </Td>
                      {columns.map((column) => (
                        <Td
                          key={column.key}
                          className={cn(
                            "text-center text-sm tabular-nums text-muted-foreground",
                            column.isCurrent && "bg-muted/30"
                          )}
                        >
                          {formatHours(
                            availableForColumn(workCenter.id, column)
                          )}
                        </Td>
                      ))}
                      <Td className="border-l border-border/60 text-center text-sm tabular-nums text-muted-foreground">
                        {formatHours(availableWeek)}
                      </Td>
                    </Tr>
                    <Tr>
                      <Td className={SERIES_LABEL}>
                        <Trans>Load</Trans>
                      </Td>
                      <Td className="text-center text-sm text-muted-foreground/50">
                        —
                      </Td>
                      {columns.map((column) => {
                        const dayDemand = demandForColumn(
                          workCenter.id,
                          column
                        );
                        const available = availableForColumn(
                          workCenter.id,
                          column
                        );
                        return (
                          <Td
                            key={column.key}
                            className={cn(
                              "text-center",
                              column.isCurrent && "bg-muted/30"
                            )}
                          >
                            <LoadCell
                              demand={dayDemand}
                              available={available}
                            />
                          </Td>
                        );
                      })}
                      <Td className="border-l border-border/60 text-center">
                        <LoadCell
                          demand={demandWeek}
                          available={availableWeek}
                        />
                      </Td>
                    </Tr>
                  </Tbody>
                );
              })}
            </Fragment>
          ))}
        </Table>
      </div>
    </div>
  );
}
