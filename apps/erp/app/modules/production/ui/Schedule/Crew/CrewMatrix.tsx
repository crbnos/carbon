import {
  Combobox,
  cn,
  Table,
  Tabs,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo, useState } from "react";
import { EmployeeAvatar } from "~/components";

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

const CHIP_BASE =
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/5 dark:ring-white/10";

const STICKY_HEADER =
  "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]";
const STICKY_FIRST_COL = "sticky left-0 z-[1] bg-card";

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
};

type CrewMatrixProps = {
  weekDates: string[];
  employees: { id: string; name: string | null; avatarUrl: string | null }[];
  workCenters: MatrixWorkCenter[];
  assignments: MatrixAssignment[];
  absences: { employeeId: string; date: string }[];
  demandByWorkCenter: Record<string, { days: Record<string, number> }>;
  shiftId: string | null;
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
};

export function CrewMatrix({
  weekDates,
  employees,
  workCenters,
  assignments,
  absences,
  demandByWorkCenter,
  shiftId,
  shiftHoursById,
  employeeShiftHours,
  defaultShiftHours
}: CrewMatrixProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [tab, setTab] = useState<"assignments" | "coverage">("assignments");
  const [departmentId, setDepartmentId] = useState<string>("all");

  const today = new Date().toLocaleDateString("en-CA");

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

  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const wc of workCenters) {
      if (wc.departmentId && wc.departmentName) {
        seen.set(wc.departmentId, wc.departmentName);
      }
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [workCenters]);

  // shift-filtered assignments (page-level shift tabs apply here like the board)
  const visibleAssignments = useMemo(
    () =>
      shiftId ? assignments.filter((a) => a.shiftId === shiftId) : assignments,
    [assignments, shiftId]
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

  const absentSet = useMemo(
    () => new Set(absences.map((a) => `${a.employeeId}:${a.date}`)),
    [absences]
  );

  const filteredWorkCenters = useMemo(
    () =>
      departmentId === "all"
        ? workCenters
        : workCenters.filter((wc) => wc.departmentId === departmentId),
    [workCenters, departmentId]
  );
  const filteredWorkCenterIds = useMemo(
    () => new Set(filteredWorkCenters.map((wc) => wc.id)),
    [filteredWorkCenters]
  );

  // department filter keeps employees with at least one assignment in that
  // department this week; "all" shows everyone
  const rows = useMemo(() => {
    const sorted = [...employees].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    );
    if (departmentId === "all") return sorted;
    return sorted.filter((employee) => {
      const byDate = assignmentsByEmployeeDate.get(employee.id);
      if (!byDate) return false;
      return [...byDate.values()].some((list) =>
        list.some((a) => filteredWorkCenterIds.has(a.workCenterId))
      );
    });
  }, [
    employees,
    departmentId,
    assignmentsByEmployeeDate,
    filteredWorkCenterIds
  ]);

  const dayLabel = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });

  // assignment's shift → the person's own shift (employeeShift) →
  // most-common shift length at the location
  const assignmentHours = (assignment: MatrixAssignment) =>
    (assignment.shiftId ? shiftHoursById[assignment.shiftId] : undefined) ??
    employeeShiftHours[assignment.employeeId] ??
    defaultShiftHours;

  const assignedCount = (workCenterId: string, date: string) =>
    visibleAssignments.filter(
      (a) =>
        a.workCenterId === workCenterId &&
        a.date === date &&
        !absentSet.has(`${a.employeeId}:${a.date}`)
    ).length;

  const neededCount = (workCenterId: string, date: string) => {
    const demand = demandByWorkCenter[workCenterId]?.days[date] ?? 0;
    return Math.ceil(demand / defaultShiftHours);
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
      {dayLabel(date)}
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
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            <Trans>Department</Trans>
          </span>
          <div className="w-52">
            <Combobox
              asButton
              size="sm"
              value={departmentId}
              options={[
                { value: "all", label: t`All departments` },
                ...departments
              ]}
              onChange={(value) => setDepartmentId(value || "all")}
            />
          </div>
        </div>
      </div>

      {tab === "coverage" && (
        <p className="text-xs text-muted-foreground text-pretty">
          <Trans>
            Assigned / Needed people per station. Needed = job hours due that
            day ÷ {defaultShiftHours}h shift, rounded up. Red is short-staffed,
            green is covered, yellow is overstaffed.
          </Trans>
        </p>
      )}

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
                      assignedHours += assignmentHours(assignment);
                    }
                  }
                  return (
                    <Td
                      key={date}
                      className={cn(
                        "text-center",
                        date === today && "bg-muted/30"
                      )}
                    >
                      {absent ? (
                        <span
                          className={cn(
                            CHIP_BASE,
                            "bg-muted text-muted-foreground"
                          )}
                        >
                          <Trans>Absent</Trans>
                        </span>
                      ) : dayAssignments.length > 0 ? (
                        <span className="inline-flex flex-col items-center gap-1">
                          {dayAssignments.map((assignment) => {
                            const workCenter = workCenterById.get(
                              assignment.workCenterId
                            );
                            return (
                              <span
                                key={assignment.id}
                                className={cn(
                                  CHIP_BASE,
                                  chipClassByWorkCenter.get(
                                    assignment.workCenterId
                                  )
                                )}
                              >
                                {workCenter?.name ?? assignment.workCenterId}
                              </span>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
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
              {filteredWorkCenters.map((workCenter) => (
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
                        <span
                          className={cn(CHIP_BASE, "tabular-nums", className)}
                        >
                          {assigned} / {needed}
                        </span>
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
