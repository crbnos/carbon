import {
  Alert,
  AlertDescription,
  cn,
  Table,
  Tabs,
  TabsList,
  TabsTrigger,
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
import { Fragment, useCallback, useMemo, useState } from "react";
import { LuInfo, LuTriangleAlert } from "react-icons/lu";
import { DateTime } from "~/components";
import { PeopleChip } from "./PeopleChip";
import {
  assignmentHours,
  buildAbsentSet,
  formatHours,
  STICKY_HEADER
} from "./peopleShared";

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

type CapacityTab = "load" | "due";

type PeopleCapacityProps = {
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
  /** per-work-center calendar hours (the availability ladder) — the Available series. */
  calendarHoursByWorkCenter: Record<string, Record<string, number>>;
  /** which ladder rung each work center resolved via (1 explicit, 2 location, 3 stock). */
  capacityRungByWorkCenter: Record<string, number>;
};

function loadCellClass(loadPct: number | null) {
  if (loadPct === null) return "text-muted-foreground";
  if (loadPct > 1.2) return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (loadPct > 1) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
}

/**
 * The load verdict in hours, not percentages: "+34h" = 34 hours more work
 * scheduled than the station has available; "6h free" = headroom. Compares
 * Scheduled against Available on ONE date basis (both are the day the work
 * actually runs). The load % lives in the tooltip.
 */
function LoadCell({
  scheduled,
  available
}: {
  scheduled: number;
  available: number;
}) {
  if (scheduled === 0 && available === 0) {
    return <span className="text-sm text-muted-foreground/50">—</span>;
  }
  const pct = available > 0 ? scheduled / available : Number.POSITIVE_INFINITY;
  const delta = scheduled - available;
  const title = Number.isFinite(pct)
    ? `${Math.round(pct * 100)}% loaded (${formatHours(scheduled)}h scheduled / ${formatHours(available)}h available)`
    : `${formatHours(scheduled)}h scheduled with no available hours`;
  return (
    <PeopleChip
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
    </PeopleChip>
  );
}

export function PeopleCapacity({
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
  calendarHoursByWorkCenter,
  capacityRungByWorkCenter
}: PeopleCapacityProps) {
  const [tab, setTab] = useState<CapacityTab>("load");
  const absentSet = useMemo(() => buildAbsentSet(absences), [absences]);

  // present people labor hours per work center per date (all shifts, minus
  // absent), using each assignment's real shift duration — shown as a secondary
  // "staffed" annotation, never as the Available base
  const peopleHours = useMemo(() => {
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

  // Available is the calendar-hours ladder, never people-derived — staffing a
  // station no longer lowers its displayed available hours (the fallback cliff).
  const availableHours = useCallback(
    (workCenterId: string, date: string) =>
      calendarHoursByWorkCenter[workCenterId]?.[date] ?? 0,
    [calendarHoursByWorkCenter]
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
  const staffedForColumn = useCallback(
    (workCenterId: string, column: CapacityColumn) =>
      column.dates.reduce(
        (sum, date) => sum + (peopleHours.get(`${workCenterId}:${date}`) ?? 0),
        0
      ),
    [peopleHours]
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
  // (Scheduled vs Available — the same verdict the Load row renders)
  const summary = useMemo(() => {
    let green = 0;
    let amber = 0;
    let red = 0;
    for (const workCenter of workCenters) {
      for (const column of columns) {
        const scheduled = scheduledForColumn(workCenter.id, column);
        const available = availableForColumn(workCenter.id, column);
        if (scheduled === 0) continue;
        const pct = available > 0 ? scheduled / available : Infinity;
        if (pct > 1.2) red += 1;
        else if (pct > 1) amber += 1;
        else green += 1;
      }
    }
    return { green, amber, red };
  }, [workCenters, columns, scheduledForColumn, availableForColumn]);

  // Assumption banner: only when the hours are ASSUMED for every shown station —
  // not when they're explicitly configured (alwaysOn or per-work-center shifts).
  const assumption = useMemo<"none" | "location-shifts" | "no-shifts">(() => {
    if (workCenters.length === 0) return "none";
    const rungs = workCenters.map((wc) => capacityRungByWorkCenter[wc.id] ?? 3);
    if (rungs.every((rung) => rung === 2)) return "location-shifts";
    if (rungs.every((rung) => rung === 3)) return "no-shifts";
    return "none";
  }, [workCenters, capacityRungByWorkCenter]);

  const loadColSpan = columns.length + 3;

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden p-4 gap-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as CapacityTab)}
          >
            <TabsList>
              <TabsTrigger value="load">
                <Trans>Load</Trans>
              </TabsTrigger>
              <TabsTrigger value="due">
                <Trans>Due (by due date)</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
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
                    <Trans>Scheduled</Trans>
                  </span>{" "}
                  —{" "}
                  <Trans>the hours the scheduler placed on the station.</Trans>
                </p>
                <p>
                  <span className="font-medium">
                    <Trans>Available</Trans>
                  </span>{" "}
                  —{" "}
                  <Trans>
                    the station's calendar hours from its shifts. Staffed hours
                    (the people you've assigned) show beneath.
                  </Trans>
                </p>
                <p>
                  <span className="font-medium">
                    <Trans>Load</Trans>
                  </span>{" "}
                  —{" "}
                  <Trans>
                    how far the scheduled work is over the available hours (+)
                    or how many hours are still free.
                  </Trans>
                </p>
                <p>
                  <span className="font-medium">
                    <Trans>Due</Trans>
                  </span>{" "}
                  —{" "}
                  <Trans>
                    the job hours due that day (a due-date basis, not the day
                    the work runs), with overdue work in Past due.
                  </Trans>
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
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

      {assumption !== "none" && (
        <Alert variant="warning">
          <LuTriangleAlert />
          <AlertDescription>
            {assumption === "location-shifts" ? (
              <Trans>Hours assumed from location shifts</Trans>
            ) : (
              <Trans>No shifts configured — assuming Mon–Fri, 8h days</Trans>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border bg-card shadow-sm">
        {tab === "load" ? (
          <Table full>
            <Thead>
              <Tr>
                <CapacityTh className={cn(STICKY_HEADER, "min-w-[180px]")}>
                  <Trans>Work Center</Trans>
                </CapacityTh>
                <CapacityTh className={cn(STICKY_HEADER, "min-w-[90px]")}>
                  <Trans>Series</Trans>
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
                        colSpan={loadColSpan}
                        className="bg-muted/50 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {departmentName}
                      </Td>
                    </Tr>
                  </Tbody>
                )}
                {group.map((workCenter) => {
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
                  const staffedWeek = columns.reduce(
                    (sum, column) =>
                      sum + staffedForColumn(workCenter.id, column),
                    0
                  );
                  return (
                    <Tbody
                      key={workCenter.id}
                      className="border-b border-border last:border-0"
                    >
                      <Tr className="border-b border-border/40">
                        <Td
                          rowSpan={3}
                          className="bg-card align-middle group-hover:bg-transparent"
                        >
                          <span className="text-sm font-semibold text-foreground">
                            {workCenter.name}
                          </span>
                        </Td>
                        <Td className={SERIES_LABEL}>
                          <Trans>Scheduled</Trans>
                        </Td>
                        {columns.map((column) => {
                          const value = scheduledForColumn(
                            workCenter.id,
                            column
                          );
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
                        {columns.map((column) => {
                          const available = availableForColumn(
                            workCenter.id,
                            column
                          );
                          const staffed = staffedForColumn(
                            workCenter.id,
                            column
                          );
                          return (
                            <Td
                              key={column.key}
                              className={cn(
                                "text-center text-sm tabular-nums text-muted-foreground",
                                column.isCurrent && "bg-muted/30"
                              )}
                            >
                              <div className="flex flex-col items-center leading-tight">
                                <span>{formatHours(available)}</span>
                                {staffed > 0 && (
                                  <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                                    <Trans>
                                      {formatHours(staffed)}h staffed
                                    </Trans>
                                  </span>
                                )}
                              </div>
                            </Td>
                          );
                        })}
                        <Td className="border-l border-border/60 text-center text-sm tabular-nums text-muted-foreground">
                          <div className="flex flex-col items-center leading-tight">
                            <span>{formatHours(availableWeek)}</span>
                            {staffedWeek > 0 && (
                              <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                                <Trans>
                                  {formatHours(staffedWeek)}h staffed
                                </Trans>
                              </span>
                            )}
                          </div>
                        </Td>
                      </Tr>
                      <Tr>
                        <Td className={SERIES_LABEL}>
                          <Trans>Load</Trans>
                        </Td>
                        {columns.map((column) => {
                          const scheduled = scheduledForColumn(
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
                                scheduled={scheduled}
                                available={available}
                              />
                            </Td>
                          );
                        })}
                        <Td className="border-l border-border/60 text-center">
                          <LoadCell
                            scheduled={scheduledWeek}
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
        ) : (
          <Table full>
            <Thead>
              <Tr>
                <CapacityTh className={cn(STICKY_HEADER, "min-w-[180px]")}>
                  <Trans>Work Center</Trans>
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
                        colSpan={loadColSpan}
                        className="bg-muted/50 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        {departmentName}
                      </Td>
                    </Tr>
                  </Tbody>
                )}
                <Tbody className="border-b border-border last:border-0">
                  {group.map((workCenter) => {
                    const demand = demandByWorkCenter[workCenter.id];
                    const pastDue = demand?.pastDue ?? 0;
                    const demandWeek = columns.reduce(
                      (sum, column) =>
                        sum + demandForColumn(workCenter.id, column),
                      0
                    );
                    return (
                      <Tr
                        key={workCenter.id}
                        className="border-b border-border/40 last:border-0 hover:bg-muted/40"
                      >
                        <Td className="bg-card align-middle group-hover:bg-transparent">
                          <span className="text-sm font-semibold text-foreground">
                            {workCenter.name}
                          </span>
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
                    );
                  })}
                </Tbody>
              </Fragment>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}
