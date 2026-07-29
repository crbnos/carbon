import { cn, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ComponentProps } from "react";
import { Fragment, useCallback, useMemo } from "react";

const CHIP_BASE =
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/5 dark:ring-white/10";

const STICKY_HEADER =
  "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]";

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

type CrewCapacityProps = {
  weekDates: string[];
  workCenters: CapacityWorkCenter[];
  assignments: {
    employeeId: string;
    workCenterId: string;
    date: string;
    shiftId: string | null;
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

function formatHours(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
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
    <span
      title={title}
      className={cn(
        CHIP_BASE,
        "min-w-[52px] justify-center tabular-nums",
        loadCellClass(pct)
      )}
    >
      {delta > 0 ? (
        <Trans>+{formatHours(delta)}h</Trans>
      ) : (
        <Trans>{formatHours(-delta)}h free</Trans>
      )}
    </span>
  );
}

export function CrewCapacity({
  weekDates,
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
  const { locale } = useLocale();

  const absentSet = useMemo(
    () => new Set(absences.map((a) => `${a.employeeId}:${a.date}`)),
    [absences]
  );

  // present crew labor hours per work center per date (all shifts, minus
  // absent), using each assignment's real shift duration
  const crewHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const assignment of assignments) {
      if (absentSet.has(`${assignment.employeeId}:${assignment.date}`)) {
        continue;
      }
      const hours =
        (assignment.shiftId ? shiftHoursById[assignment.shiftId] : undefined) ??
        employeeShiftHours[assignment.employeeId] ??
        defaultShiftHours;
      const key = `${assignment.workCenterId}:${assignment.date}`;
      map.set(key, (map.get(key) ?? 0) + hours);
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

  // traffic-light totals across every work-center/day load cell
  const summary = useMemo(() => {
    let green = 0;
    let amber = 0;
    let red = 0;
    for (const workCenter of workCenters) {
      for (const date of weekDates) {
        const demand = demandByWorkCenter[workCenter.id]?.days[date] ?? 0;
        const available = availableHours(workCenter.id, date);
        if (demand === 0) continue;
        const pct = available > 0 ? demand / available : Infinity;
        if (pct > 1.2) red += 1;
        else if (pct > 1) amber += 1;
        else green += 1;
      }
    }
    return { green, amber, red };
  }, [workCenters, weekDates, demandByWorkCenter, availableHours]);

  const dayLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });

  const today = new Date().toLocaleDateString("en-CA");

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden p-4 gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground text-pretty">
          <Trans>
            Demand = job hours due · Scheduled = work hours the scheduler placed
            · Available = assigned crew's shift hours (uncrewed stations use the
            location's shift calendar) · Load = hours over (+) or free
          </Trans>
        </p>
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
              {weekDates.map((date) => (
                <CapacityTh
                  key={date}
                  className={cn(
                    STICKY_HEADER,
                    "text-center min-w-[110px]",
                    date === today && "text-primary"
                  )}
                >
                  {dayLabel(date)}
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
                      colSpan={weekDates.length + 4}
                      className="bg-muted/50 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {departmentName}
                    </Td>
                  </Tr>
                </Tbody>
              )}
              {group.map((workCenter) => {
                const demand = demandByWorkCenter[workCenter.id];
                const scheduled = scheduledByWorkCenter[workCenter.id] ?? {};
                const demandWeek = weekDates.reduce(
                  (sum, date) => sum + (demand?.days[date] ?? 0),
                  0
                );
                const scheduledWeek = weekDates.reduce(
                  (sum, date) => sum + (scheduled[date] ?? 0),
                  0
                );
                const availableWeek = weekDates.reduce(
                  (sum, date) => sum + availableHours(workCenter.id, date),
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
                      {weekDates.map((date) => {
                        const value = demand?.days[date] ?? 0;
                        return (
                          <Td
                            key={date}
                            className={cn(
                              "text-center text-sm tabular-nums",
                              value === 0
                                ? "text-muted-foreground/50"
                                : "font-medium",
                              date === today && "bg-muted/30"
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
                      {weekDates.map((date) => {
                        const value = scheduled[date] ?? 0;
                        return (
                          <Td
                            key={date}
                            className={cn(
                              "text-center text-sm tabular-nums",
                              value === 0
                                ? "text-muted-foreground/50"
                                : "text-muted-foreground",
                              date === today && "bg-muted/30"
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
                      {weekDates.map((date) => (
                        <Td
                          key={date}
                          className={cn(
                            "text-center text-sm tabular-nums text-muted-foreground",
                            date === today && "bg-muted/30"
                          )}
                        >
                          {formatHours(availableHours(workCenter.id, date))}
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
                      {weekDates.map((date) => {
                        const dayDemand = demand?.days[date] ?? 0;
                        const available = availableHours(workCenter.id, date);
                        return (
                          <Td
                            key={date}
                            className={cn(
                              "text-center",
                              date === today && "bg-muted/30"
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
