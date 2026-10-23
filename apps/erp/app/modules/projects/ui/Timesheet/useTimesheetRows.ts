// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ServiceTimeRow, ServiceTimeRowJob } from "@carbon/utils";
import { useMemo } from "react";
import { useChargeNumbers } from "~/components/Form";
import { useLocations } from "~/components/Form/Location";
import { path } from "~/utils/path";
import type { RdActivityRole, TimesheetCell } from "../../projects.models";
import { timesheetRowKey } from "../../projects.models";
import type { TimesheetControls } from "./TimesheetGrid";
import type { AddedRow } from "./TimesheetModals";

/** One row of a week: a charge number and labor category, and its days. */
export type GridRow = {
  key: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  /** R&D tax: where the work took place, and its research role. */
  workLocationId: string | null;
  workLocationName: string | null;
  rdActivityRole: RdActivityRole | null;
  /** Shop time (DCAA): the job and job operation, and their label. */
  jobId: string | null;
  jobOperationId: string | null;
  /** "J000022 · Machining"; null when the row has no job. */
  jobLabel: string | null;
  /** The project identifier, or the element's readable id. */
  readableId: string;
  name: string;
  /** Where the charge number opens. */
  to: string | null;
  /** A leave element (5a): DCAA mode takes time for a future date on it. */
  isLeave: boolean;
  laborCategory: string;
  cells: Record<string, TimesheetCell>;
  total: number;
};

export type TimesheetGridProps = {
  weekOffset: number;
  weekStart: string;
  weekEnd: string;
  days: string[];
  rows: {
    key: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    workLocationId: string | null;
    rdActivityRole: RdActivityRole | null;
    jobId?: string | null;
    jobOperationId?: string | null;
    cells: Record<string, TimesheetCell>;
    total: number;
    entry: {
      project: {
        identifier: string | null;
        name: string;
      } | null;
      element: { readableId: string; name: string; isLeave?: boolean } | null;
      laborCategory: { name: string } | null;
      workLocation?: { id: string; name: string } | null;
      job?: { jobId: string } | null;
      jobOperation?: { description: string | null } | null;
    };
  }[];
  timecardHours: Record<string, number>;
  laborCategories: {
    id: string;
    name: string;
    /** R&D tax: the default research role of the category's time. */
    rdActivityRole?: RdActivityRole | null;
  }[];
  /** R&D tax: the employee's job location, a new row's default. */
  jobLocationId?: string | null;
  /**
   * My Time: the week's service jobs, one row each (time or an assignment
   * that week), and the open jobs Add row offers. Never submitted.
   */
  serviceRows?: ServiceTimeRow[];
  serviceJobs?: ServiceTimeRowJob[];
  /** DCAA mode's controls (5a); null in Standard mode. */
  controls: TimesheetControls | null;
  /**
   * A manager's view of another employee's week (5a). Every change needs a
   * reason and waits for the employee's review; only the employee submits.
   * Standard mode shows the week read-only: only the owner changes time.
   */
  employee?: { id: string; name: string; absenceDays: string[] } | null;
};

/**
 * The week's rows: the saved ones from the loader, then the rows the user
 * added that have no hours yet (a row stops being "added" once it is saved).
 */
export function useTimesheetRows({
  rows,
  addedRows,
  laborCategories
}: {
  rows: TimesheetGridProps["rows"];
  addedRows: AddedRow[];
  laborCategories: TimesheetGridProps["laborCategories"];
}): GridRow[] {
  const locations = useLocations();
  const chargeNumbers = useChargeNumbers();
  return useMemo<GridRow[]>(() => {
    const serverRows: GridRow[] = rows.map((row) => {
      const project = row.entry.project;
      return {
        key: row.key,
        projectId: row.projectId,
        projectElementId: row.projectElementId,
        laborCategoryId: row.laborCategoryId,
        workLocationId: row.workLocationId,
        workLocationName: row.entry.workLocation?.name ?? null,
        rdActivityRole: row.rdActivityRole,
        jobId: row.jobId ?? null,
        jobOperationId: row.jobOperationId ?? null,
        jobLabel: row.entry.job
          ? [row.entry.job.jobId, row.entry.jobOperation?.description]
              .filter(Boolean)
              .join(" · ")
          : null,
        readableId: row.entry.element?.readableId ?? project?.identifier ?? "",
        name: row.entry.element?.name ?? project?.name ?? "",
        to: row.projectElementId
          ? path.to.projectElement(row.projectId, row.projectElementId)
          : path.to.project(row.projectId),
        isLeave: row.entry.element?.isLeave ?? false,
        laborCategory: row.entry.laborCategory?.name ?? "",
        cells: row.cells,
        total: row.total
      };
    });
    const keys = new Set(serverRows.map((row) => row.key));
    const localRows: GridRow[] = addedRows
      .map((row) => ({ ...row, key: timesheetRowKey(row) }))
      .filter((row) => !keys.has(row.key))
      .map((row) => {
        const chargeNumber = chargeNumbers.find(
          (option) =>
            option.projectId === row.projectId &&
            (option.projectElementId ?? null) === row.projectElementId
        );
        return {
          ...row,
          jobId: null,
          jobOperationId: null,
          jobLabel: null,
          workLocationName:
            locations.find((location) => location.value === row.workLocationId)
              ?.label ?? null,
          readableId: chargeNumber?.readableId ?? "",
          name: chargeNumber?.name ?? "",
          to: row.projectElementId
            ? path.to.projectElement(row.projectId, row.projectElementId)
            : path.to.project(row.projectId),
          isLeave: chargeNumber?.isLeave ?? false,
          laborCategory:
            laborCategories.find((c) => c.id === row.laborCategoryId)?.name ??
            "",
          cells: {},
          total: 0
        };
      });
    return [...serverRows, ...localRows];
  }, [rows, addedRows, chargeNumbers, laborCategories, locations]);
}

/** A service job's row on My Time: its job, its days and where it opens. */
export type ServiceGridRow = ServiceTimeRow & { key: string; to: string };

/** A service row's key: never a project row's (`timesheetRowKey`). */
export const serviceRowKey = (serviceJobId: string) =>
  `service:${serviceJobId}`;

/**
 * The week's service rows: the loader's, then the open jobs the user added
 * that have no row yet (an added job stops being "added" once it has one).
 */
export function useServiceRows({
  serviceRows = [],
  serviceJobs = [],
  addedServiceJobIds
}: {
  serviceRows?: ServiceTimeRow[];
  serviceJobs?: ServiceTimeRowJob[];
  addedServiceJobIds: string[];
}): ServiceGridRow[] {
  return useMemo<ServiceGridRow[]>(() => {
    const ids = new Set(serviceRows.map((row) => row.id));
    const added = addedServiceJobIds
      .filter((id) => !ids.has(id))
      .flatMap((id) => {
        const job = serviceJobs.find((option) => option.id === id);
        return job ? [{ ...job, isLocked: false, cells: {}, total: 0 }] : [];
      });
    return [...serviceRows, ...added].map((row) => ({
      ...row,
      key: serviceRowKey(row.id),
      to: path.to.serviceJob(row.id)
    }));
  }, [serviceRows, serviceJobs, addedServiceJobIds]);
}
