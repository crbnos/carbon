import {
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
import { useMemo, useState } from "react";
import { LuInfo } from "react-icons/lu";
import { DateTime, EmployeeAvatar } from "~/components";
import { usePermissions } from "~/hooks";
import { PeopleChip } from "./PeopleChip";
import { PeopleHoursModal } from "./PeopleHoursModal";
import {
  assignmentHours,
  assignmentMatchesShift,
  buildAbsentSet,
  dayOvertime,
  ladderShiftHours,
  ladderShiftTime,
  STICKY_FIRST_COL,
  STICKY_HEADER
} from "./peopleShared";

// deterministic per-work-center chip colors (cycled by stable index)
const WC_CHIP_CLASSES = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  "bg-lime-500/15 text-lime-700 dark:text-lime-400",
  "bg-amber-500/15 text-amber-700 dark:text-amber-400"
];

type MatrixWorkCenter = {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
};

type MatrixAssignment = {
  id: string;
  employeeId: string;
  workCenterId: string;
  date: string;
  shiftId: string | null;
  note: string | null;
  overtimeHours: number;
  hours: number | null;
};

type PeopleMatrixProps = {
  weekDates: string[];
  locationTimeZone?: string;
  employees: { id: string; name: string | null; avatarUrl: string | null }[];
  workCenters: MatrixWorkCenter[];
  assignments: MatrixAssignment[];
  absences: { id: string; employeeId: string; date: string }[];
  demandByWorkCenter: Record<string, { days: Record<string, number> }>;
  shiftId: string | null;
  locationId: string;
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
  shiftStartById: Record<string, string>;
  shiftEndById: Record<string, string>;
  employeeShiftStart: Record<string, string>;
  employeeShiftEnd: Record<string, string>;
  /** each person's own shift — what new assignments get stamped with */
  employeeShiftId: Record<string, string>;
  defaultShiftStart: string;
  defaultShiftEnd: string | null;
};

export function PeopleMatrix({
  weekDates,
  locationTimeZone,
  employees,
  workCenters,
  assignments,
  absences,
  demandByWorkCenter,
  shiftId,
  locationId,
  shiftHoursById,
  employeeShiftHours,
  defaultShiftHours,
  shiftStartById,
  shiftEndById,
  employeeShiftStart,
  employeeShiftEnd,
  employeeShiftId,
  defaultShiftStart,
  defaultShiftEnd
}: PeopleMatrixProps) {
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "production");
  const [tab, setTab] = useState<"assignments" | "coverage">("assignments");

  const today = calendarToday(getLocalTimeZone()).toString();

  const workCenterById = useMemo(
    () => new Map(workCenters.map((wc) => [wc.id, wc])),
    [workCenters]
  );
  const chipClassByWorkCenter = useMemo(
    () =>
      new Map(
        workCenters.map((wc, index) => [
          wc.id,
          WC_CHIP_CLASSES[index % WC_CHIP_CLASSES.length]
        ])
      ),
    [workCenters]
  );

  // shift-filtered assignments (page-level shift tabs apply here like the
  // board) — shift-less rows resolve through the person's own shift
  const visibleAssignments = useMemo(
    () =>
      shiftId
        ? assignments.filter((a) =>
            assignmentMatchesShift(a, shiftId, employeeShiftId)
          )
        : assignments,
    [assignments, shiftId, employeeShiftId]
  );

  // a person can legally hold one assignment PER SHIFT on the same date —
  // keep them all (the unique index is per employee/date/shift)
  const assignmentsByEmployeeDate = useMemo(() => {
    const map = new Map<string, Map<string, MatrixAssignment[]>>();
    for (const assignment of visibleAssignments) {
      let byDate = map.get(assignment.employeeId);
      if (!byDate) {
        byDate = new Map();
        map.set(assignment.employeeId, byDate);
      }
      const list = byDate.get(assignment.date);
      if (list) list.push(assignment);
      else byDate.set(assignment.date, [assignment]);
    }
    return map;
  }, [visibleAssignments]);

  const absentSet = useMemo(() => buildAbsentSet(absences), [absences]);
  const absenceIdByKey = useMemo(
    () => new Map(absences.map((a) => [`${a.employeeId}:${a.date}`, a.id])),
    [absences]
  );

  // department scoping happens at the page level (workCenters/employees
  // arrive pre-filtered); rows are just the employees, sorted
  const rows = useMemo(
    () =>
      [...employees].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [employees]
  );

  const hoursLadder = { shiftHoursById, employeeShiftHours, defaultShiftHours };
  const hoursFor = (assignment: MatrixAssignment) =>
    assignmentHours(assignment, hoursLadder);

  const assignedCount = (workCenterId: string, date: string) =>
    visibleAssignments.filter(
      (a) =>
        a.workCenterId === workCenterId &&
        a.date === date &&
        !absentSet.has(`${a.employeeId}:${a.date}`)
    ).length;

  // One person's contribution for a day, on the same ladder the rest of the
  // page uses: the shift you're filtering by → the location's most common
  // shift length. Never a hard-coded number — a company running 8h, 10h or
  // 12h shifts gets its own divisor.
  const personDayHours =
    (shiftId ? shiftHoursById[shiftId] : undefined) ?? defaultShiftHours;

  const neededCount = (workCenterId: string, date: string) => {
    const demand = demandByWorkCenter[workCenterId]?.days[date] ?? 0;
    return Math.ceil(demand / personDayHours);
  };

  const dayHeaders = weekDates.map((date) => (
    <Th
      key={date}
      className={cn(
        STICKY_HEADER,
        "text-center min-w-[120px]",
        date === today && "text-primary"
      )}
    >
      <DateTime
        value={date}
        variant="date"
        dateOptions={{ weekday: "short", month: "short", day: "numeric" }}
        locationTimeZone={locationTimeZone}
      />
    </Th>
  ));

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden p-4 gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as typeof tab)}
        >
          <TabsList>
            <TabsTrigger value="assignments">
              <Trans>Assignments</Trans>
            </TabsTrigger>
            <TabsTrigger value="coverage">
              <Trans>Coverage</Trans>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "coverage" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <LuInfo className="h-3.5 w-3.5" />
                <Trans>How coverage is worked out</Trans>
              </button>
            </TooltipTrigger>
            <TooltipContent align="end" className="max-w-[320px]">
              <div className="flex flex-col gap-1.5 text-xs">
                <p>
                  <Trans>
                    Each cell is the people assigned against the people the
                    day's work needs.
                  </Trans>
                </p>
                <p>
                  <Trans>
                    Needed is the job hours due that day divided by{" "}
                    {personDayHours}h, rounded up — the shift you're filtering
                    by, or the most common shift length at this location.
                  </Trans>
                </p>
                <p>
                  <Trans>
                    Red is short-staffed, green is covered, amber is more people
                    than the work needs.
                  </Trans>
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border bg-card shadow-sm">
        {tab === "assignments" ? (
          <Table full>
            <Thead>
              <Tr>
                <Th
                  className={cn(
                    STICKY_HEADER,
                    STICKY_FIRST_COL,
                    "z-20 min-w-[200px]"
                  )}
                >
                  <Trans>Employee</Trans>
                </Th>
                {dayHeaders}
                <Th className={cn(STICKY_HEADER, "text-center min-w-[70px]")}>
                  <Trans>Hours</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.length === 0 && (
                <Tr>
                  <Td
                    colSpan={weekDates.length + 2}
                    className="text-center text-muted-foreground py-8"
                  >
                    <Trans>No employees assigned this week</Trans>
                  </Td>
                </Tr>
              )}
              {rows.map((employee) => {
                const byDate = assignmentsByEmployeeDate.get(employee.id);
                let assignedHours = 0;
                const cells = weekDates.map((date) => {
                  const absent = absentSet.has(`${employee.id}:${date}`);
                  const dayAssignments = byDate?.get(date) ?? [];
                  if (!absent) {
                    for (const assignment of dayAssignments) {
                      assignedHours += hoursFor(assignment);
                    }
                    assignedHours += dayOvertime(dayAssignments);
                  }
                  const cellContent = absent ? (
                    <PeopleChip className="bg-muted text-muted-foreground">
                      <Trans>Absent</Trans>
                    </PeopleChip>
                  ) : dayAssignments.length > 0 ? (
                    <span className="inline-flex flex-col items-center gap-1">
                      {dayAssignments.map((assignment) => {
                        const workCenter = workCenterById.get(
                          assignment.workCenterId
                        );
                        return (
                          <PeopleChip
                            key={assignment.id}
                            className={chipClassByWorkCenter.get(
                              assignment.workCenterId
                            )}
                          >
                            {workCenter?.name ?? assignment.workCenterId}
                            {assignment.hours != null && (
                              <span className="ml-1 tabular-nums opacity-80">
                                {assignment.hours}h
                              </span>
                            )}
                          </PeopleChip>
                        );
                      })}
                      {/* overtime is the day's, not any one station's */}
                      {dayOvertime(dayAssignments) > 0 && (
                        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 tabular-nums">
                          +{dayOvertime(dayAssignments)}h OT
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  );
                  return (
                    <Td
                      key={date}
                      className={cn(
                        "text-center",
                        date === today && "bg-muted/30"
                      )}
                    >
                      {canEdit ? (
                        // grid-cell anchor: clicking the day opens the same
                        // Working-hours editor the board's hours chip uses
                        <PeopleHoursModal
                          trigger={
                            <button
                              type="button"
                              className="w-full rounded-md px-1 py-1 transition-colors hover:bg-muted/60"
                            >
                              {cellContent}
                            </button>
                          }
                          employeeId={employee.id}
                          employeeName={employee.name}
                          date={date}
                          shiftId={employeeShiftId[employee.id] ?? null}
                          locationId={locationId}
                          locationTimeZone={locationTimeZone}
                          workCenters={workCenters}
                          rows={dayAssignments.map((assignment) => ({
                            workCenterId: assignment.workCenterId,
                            hours: assignment.hours
                          }))}
                          note={
                            dayAssignments.find((a) => a.note)?.note ?? null
                          }
                          overtimeHours={dayOvertime(dayAssignments)}
                          baseHours={ladderShiftHours(
                            shiftId,
                            employee.id,
                            hoursLadder
                          )}
                          dayStartTime={ladderShiftTime(
                            dayAssignments[0]?.shiftId,
                            employee.id,
                            {
                              byShift: shiftStartById,
                              byEmployee: employeeShiftStart,
                              fallback: defaultShiftStart
                            }
                          )}
                          dayEndTime={ladderShiftTime(
                            dayAssignments[0]?.shiftId,
                            employee.id,
                            {
                              byShift: shiftEndById,
                              byEmployee: employeeShiftEnd,
                              fallback: defaultShiftEnd
                            }
                          )}
                          isAbsent={absent}
                          absenceId={
                            absenceIdByKey.get(`${employee.id}:${date}`) ?? null
                          }
                        />
                      ) : (
                        cellContent
                      )}
                    </Td>
                  );
                });
                return (
                  <Tr
                    key={employee.id}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/40"
                  >
                    <Td className={STICKY_FIRST_COL}>
                      <EmployeeAvatar employeeId={employee.id} size="xs" />
                    </Td>
                    {cells}
                    <Td className="text-center text-xs text-muted-foreground tabular-nums">
                      {Number.isInteger(assignedHours)
                        ? assignedHours
                        : assignedHours.toFixed(1)}
                      h
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        ) : (
          <Table full>
            <Thead>
              <Tr>
                <Th
                  className={cn(
                    STICKY_HEADER,
                    STICKY_FIRST_COL,
                    "z-20 min-w-[200px]"
                  )}
                >
                  <Trans>Work Center</Trans>
                </Th>
                {dayHeaders}
              </Tr>
            </Thead>
            <Tbody>
              {workCenters.map((workCenter) => (
                <Tr
                  key={workCenter.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/40"
                >
                  <Td className={STICKY_FIRST_COL}>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {workCenter.name}
                      </span>
                      {workCenter.departmentName && (
                        <span className="text-xs text-muted-foreground">
                          {workCenter.departmentName}
                        </span>
                      )}
                    </div>
                  </Td>
                  {weekDates.map((date) => {
                    const assigned = assignedCount(workCenter.id, date);
                    const needed = neededCount(workCenter.id, date);
                    const className =
                      needed === 0 && assigned === 0
                        ? "text-muted-foreground/50 ring-0"
                        : assigned < needed
                          ? "bg-red-500/15 text-red-700 dark:text-red-400"
                          : assigned === needed
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-amber-500/15 text-amber-700 dark:text-amber-400";
                    return (
                      <Td
                        key={date}
                        className={cn(
                          "text-center",
                          date === today && "bg-muted/30"
                        )}
                      >
                        <PeopleChip className={cn("tabular-nums", className)}>
                          {assigned} / {needed}
                        </PeopleChip>
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
