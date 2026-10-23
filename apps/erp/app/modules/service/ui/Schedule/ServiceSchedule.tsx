// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { serviceErrorMessage } from "@carbon/query";
import { cn, Table, Tbody, Td, Th, Thead, Tr, toast } from "@carbon/react";
import { formatDate, isServiceJobLocked } from "@carbon/utils";
import {
  today as calendarToday,
  getLocalTimeZone
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetchers, useSubmit } from "react-router";
import { DateTime, EmployeeAvatar } from "~/components";
import {
  MatrixCell,
  MatrixChip,
  type MatrixMove,
  type MatrixPlace,
  ScheduleMatrixDnd
} from "~/components/ScheduleMatrix";
import { usePermissions } from "~/hooks";
import { PeopleChip } from "~/modules/production/ui/Schedule/People/PeopleChip";
import {
  buildAbsentSet,
  formatHours,
  ladderShiftHours,
  STICKY_FIRST_COL,
  STICKY_HEADER
} from "~/modules/production/ui/Schedule/People/peopleShared";
import { path } from "~/utils/path";
import type {
  ServiceJobPriority,
  ServiceJobStatus
} from "../../service.models";
import { AssignmentBlock, AssignmentModal } from "./AssignmentBlock";
import {
  BACKLOG_CHIP_PREFIX,
  BacklogCard,
  ServiceBacklog
} from "./ServiceBacklog";

/** One technician on one job for one day, as the grid shows it. */
export type ScheduleAssignment = {
  id: string;
  /** the job's id */
  serviceJobId: string;
  /** the job's readable number */
  jobReadableId: string;
  customerName: string | null;
  status: ServiceJobStatus | null;
  employeeId: string;
  date: string;
  plannedHours: number | null;
  note: string | null;
};

/** An open job no technician is assigned to. */
export type ScheduleBacklogJob = {
  id: string;
  jobReadableId: string;
  customerName: string | null;
  status: ServiceJobStatus;
  priority: ServiceJobPriority;
  dueDate: string | null;
  problem: string | null;
};

type ServiceScheduleEmployee = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

type ServiceScheduleProps = {
  weekDates: string[];
  locationTimeZone?: string;
  employees: ServiceScheduleEmployee[];
  /** selected department filter — floats its people to the top, hides no one */
  departmentId: string | null;
  /** employeeId → their department, for the department-first ordering */
  employeeDepartments: Record<string, string | null>;
  assignments: ScheduleAssignment[];
  absences: { id: string; employeeId: string; date: string }[];
  backlog: ScheduleBacklogJob[];
  shiftHoursById: Record<string, number>;
  employeeShiftHours: Record<string, number>;
  defaultShiftHours: number;
};

/** A day's planned hours; a block with no planned hours adds none. */
function plannedTotal(assignments: ScheduleAssignment[]) {
  return assignments.reduce((sum, a) => sum + (a.plannedHours ?? 0), 0);
}

/**
 * Toasts a refusal from the grid's writes. They post through keyed fetchers
 * (one per chip, so a second drag never cancels the first); `useFetchers()`
 * lists in-flight fetchers only, so a result is read while the page
 * revalidates after it. Copied from the People board's feedback hook.
 */
function useScheduleFeedback() {
  const fetchers = useFetchers();
  const answered = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const fetcher of fetchers) {
      if (fetcher.formAction !== path.to.serviceScheduleUpdate) continue;
      if (fetcher.state === "submitting") {
        answered.current.delete(fetcher.key);
        continue;
      }
      if (!fetcher.data || answered.current.has(fetcher.key)) continue;
      answered.current.add(fetcher.key);
      const message = serviceErrorMessage(fetcher.data);
      if (message) toast.error(message);
    }
  }, [fetchers]);
}

/**
 * The dispatch grid: technicians as rows, the week's days as columns, service
 * job assignments as blocks, and the backlog of unassigned jobs beside it.
 * Copies the People matrix, through the same `ScheduleMatrix` drag and drop.
 */
export function ServiceSchedule({
  weekDates,
  locationTimeZone,
  employees,
  departmentId,
  employeeDepartments,
  assignments,
  absences,
  backlog,
  shiftHoursById,
  employeeShiftHours,
  defaultShiftHours
}: ServiceScheduleProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  useScheduleFeedback();
  const canEdit = permissions.can("update", "service");
  const canUnassign = permissions.can("delete", "service");
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);

  const today = calendarToday(
    locationTimeZone ?? getLocalTimeZone()
  ).toString();

  const assignmentsByEmployeeDate = useMemo(() => {
    const map = new Map<string, Map<string, ScheduleAssignment[]>>();
    for (const assignment of assignments) {
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
  }, [assignments]);

  const absentSet = useMemo(() => buildAbsentSet(absences), [absences]);
  const assignmentById = useMemo(
    () => new Map(assignments.map((a) => [a.id, a])),
    [assignments]
  );
  const backlogById = useMemo(
    () => new Map(backlog.map((job) => [job.id, job])),
    [backlog]
  );

  // The location's people, plus anyone from elsewhere already scheduled on
  // one of its jobs this week, so no assignment is hidden. The department
  // filter only reorders: its people float to the top, each group by name.
  const rows = useMemo(() => {
    const known = new Set(employees.map((employee) => employee.id));
    const others: ServiceScheduleEmployee[] = [];
    for (const assignment of assignments) {
      if (known.has(assignment.employeeId)) continue;
      known.add(assignment.employeeId);
      others.push({ id: assignment.employeeId, name: null, avatarUrl: null });
    }
    const sorted = [...employees].sort((a, b) => {
      if (departmentId) {
        const aInDept = employeeDepartments[a.id] === departmentId ? 0 : 1;
        const bInDept = employeeDepartments[b.id] === departmentId ? 0 : 1;
        if (aInDept !== bInDept) return aInDept - bInDept;
      }
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    return [...sorted, ...others];
  }, [employees, assignments, departmentId, employeeDepartments]);

  const employeeNameById = useMemo(
    () => new Map(rows.map((e) => [e.id, e.name])),
    [rows]
  );

  const hoursLadder = { shiftHoursById, employeeShiftHours, defaultShiftHours };
  const shiftHoursFor = (employeeId: string) =>
    ladderShiftHours(null, employeeId, hoursLadder);

  const submitIntent = (payload: Record<string, string>, chipId: string) =>
    submit(payload, {
      method: "post",
      action: path.to.serviceScheduleUpdate,
      navigate: false,
      fetcherKey: `service-schedule:${chipId}`
    });

  const onMove = ({ chipId, from, to }: MatrixMove) => {
    if (from === "outside") {
      // a backlog job onto a technician's day: the rest of their shift, at
      // least an hour
      if (to === "outside" || !chipId.startsWith(BACKLOG_CHIP_PREFIX)) return;
      if (!canEdit) return;
      const dayTotal = plannedTotal(
        assignmentsByEmployeeDate.get(to.rowId)?.get(to.date) ?? []
      );
      const plannedHours = Math.max(1, shiftHoursFor(to.rowId) - dayTotal);
      submitIntent(
        {
          intent: "assign",
          serviceJobId: chipId.slice(BACKLOG_CHIP_PREFIX.length),
          employeeId: to.rowId,
          scheduledDate: to.date,
          plannedHours: String(plannedHours)
        },
        chipId
      );
      return;
    }
    if (to === "outside") {
      if (!canUnassign) return;
      submitIntent({ intent: "unassign", id: chipId }, chipId);
      return;
    }
    if (!canEdit) return;
    submitIntent(
      {
        intent: "move",
        id: chipId,
        employeeId: to.rowId,
        scheduledDate: to.date
      },
      chipId
    );
  };

  const renderOverlay = (chipId: string) => {
    if (chipId.startsWith(BACKLOG_CHIP_PREFIX)) {
      const job = backlogById.get(chipId.slice(BACKLOG_CHIP_PREFIX.length));
      return job ? (
        <BacklogCard job={job} isOverlay locationTimeZone={locationTimeZone} />
      ) : null;
    }
    const assignment = assignmentById.get(chipId);
    if (!assignment) return null;
    return (
      <AssignmentBlock assignment={assignment} className="w-40 shadow-md" />
    );
  };

  const describeChip = (chipId: string) => {
    if (chipId.startsWith(BACKLOG_CHIP_PREFIX)) {
      const job = backlogById.get(chipId.slice(BACKLOG_CHIP_PREFIX.length));
      return job?.jobReadableId ?? t`Job`;
    }
    const assignment = assignmentById.get(chipId);
    if (!assignment) return t`Assignment`;
    const name = employeeNameById.get(assignment.employeeId) ?? "";
    return t`${assignment.jobReadableId} for ${name}`;
  };

  const describePlace = (place: MatrixPlace) => {
    if (place === "outside") return t`the backlog`;
    const name = employeeNameById.get(place.rowId) ?? "";
    const day = formatDate(place.date, {
      weekday: "long",
      month: "short",
      day: "numeric"
    });
    return t`${name} on ${day}`;
  };

  const openAssignment = openAssignmentId
    ? assignmentById.get(openAssignmentId)
    : undefined;

  return (
    <ScheduleMatrixDnd
      onMove={onMove}
      renderOverlay={renderOverlay}
      describeChip={describeChip}
      describePlace={describePlace}
    >
      <div className="flex flex-1 min-w-0 min-h-0 flex-col p-4">
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border bg-card shadow-sm">
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
                  <Trans>Technician</Trans>
                </Th>
                {weekDates.map((date) => (
                  <Th
                    key={date}
                    className={cn(
                      STICKY_HEADER,
                      "text-center min-w-[140px]",
                      date === today && "text-primary"
                    )}
                  >
                    <DateTime
                      value={date}
                      variant="date"
                      dateOptions={{
                        weekday: "short",
                        month: "short",
                        day: "numeric"
                      }}
                      locationTimeZone={locationTimeZone}
                    />
                  </Th>
                ))}
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
                    <Trans>No employees at this location</Trans>
                  </Td>
                </Tr>
              )}
              {rows.map((employee) => {
                const byDate = assignmentsByEmployeeDate.get(employee.id);
                const shiftHours = shiftHoursFor(employee.id);
                let weekHours = 0;
                const cells = weekDates.map((date) => {
                  const absent = absentSet.has(`${employee.id}:${date}`);
                  const dayAssignments = byDate?.get(date) ?? [];
                  const dayTotal = plannedTotal(dayAssignments);
                  weekHours += dayTotal;
                  return (
                    <Td
                      key={date}
                      className={cn(
                        "align-top",
                        date === today && "bg-muted/30"
                      )}
                    >
                      <MatrixCell
                        rowId={employee.id}
                        date={date}
                        disabled={absent || !canEdit}
                        className="flex min-h-14 flex-col items-stretch gap-1 p-1"
                      >
                        {absent && (
                          <PeopleChip className="self-center bg-muted text-muted-foreground">
                            <Trans>Absent</Trans>
                          </PeopleChip>
                        )}
                        {dayAssignments.map((assignment) => {
                          const locked = isServiceJobLocked(assignment.status);
                          return (
                            <MatrixChip
                              key={assignment.id}
                              chipId={assignment.id}
                              rowId={employee.id}
                              date={date}
                              disabled={!canEdit || locked}
                              className="flex w-full"
                            >
                              <AssignmentBlock
                                assignment={assignment}
                                isLocked={locked}
                                onOpen={() =>
                                  setOpenAssignmentId(assignment.id)
                                }
                              />
                            </MatrixChip>
                          );
                        })}
                        {dayAssignments.length > 0 ? (
                          <span
                            className={cn(
                              "text-center text-[11px] tabular-nums text-muted-foreground",
                              dayTotal > shiftHours &&
                                "font-medium text-amber-700 dark:text-amber-400"
                            )}
                          >
                            {`${formatHours(dayTotal)} / ${formatHours(shiftHours)}h`}
                          </span>
                        ) : (
                          !absent && (
                            <span className="text-center text-muted-foreground/50">
                              —
                            </span>
                          )
                        )}
                      </MatrixCell>
                    </Td>
                  );
                });
                return (
                  <Tr
                    key={employee.id}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/40"
                  >
                    <Td className={cn(STICKY_FIRST_COL, "align-top")}>
                      <EmployeeAvatar employeeId={employee.id} size="xs" />
                    </Td>
                    {cells}
                    <Td className="text-center text-xs text-muted-foreground tabular-nums">
                      {formatHours(weekHours)}h
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </div>
      <ServiceBacklog
        backlog={backlog}
        canAssign={canEdit}
        canUnassign={canUnassign}
        locationTimeZone={locationTimeZone}
      />
      {openAssignment && (
        <AssignmentModal
          key={openAssignment.id}
          assignment={openAssignment}
          employeeName={employeeNameById.get(openAssignment.employeeId) ?? null}
          isDisabled={!canEdit || isServiceJobLocked(openAssignment.status)}
          onClose={() => setOpenAssignmentId(null)}
        />
      )}
    </ScheduleMatrixDnd>
  );
}
