// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAll } from "@carbon/database/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { erpPosting } from "./erp";
import type { timesheetCellValidator } from "./models";

// The MES copy of the ERP's timesheet reads (`apps/erp/app/modules/
// projects`). The two apps share no module, so a change to the rules there
// must be made here too. Saving, submitting and posting are the ERP's
// postings (`save-timesheet-entry`, `submit-timesheet-week`, `post-timesheet`),
// reached through `erpPosting`.

type Client = SupabaseClient<Database>;

type TimesheetEntryStatus = Database["public"]["Enums"]["timesheetEntryStatus"];
export type RdActivityRole = Database["public"]["Enums"]["rdActivityRole"];

export type ChargeNumber = {
  /** `projectId|` for the project itself, `projectId|elementId` for an element. */
  value: string;
  projectId: string;
  projectElementId: string | null;
  readableId: string;
  name: string;
  projectName: string;
  /** A leave element (5a): DCAA mode takes time for a future date on it. */
  isLeave: boolean;
};

/**
 * Lists what a user can charge: each Released project, and each chargeable
 * element of one whose state is Unstarted or Started. When the company
 * requires an element, the project-only rows are left out.
 */
export async function getChargeNumbers(client: Client, companyId: string) {
  const [settings, projects, elements] = await Promise.all([
    client
      .from("companySettings")
      .select("requireProjectElement")
      .eq("id", companyId)
      .maybeSingle(),
    fetchAll<{ id: string; identifier: string; name: string }>(() =>
      client
        .from("project")
        .select("id, identifier, name")
        .eq("companyId", companyId)
        .eq("status", "Released")
        .eq("active", true)
        .order("identifier", { ascending: true })
    ),
    fetchAll<{
      id: string;
      projectId: string;
      readableId: string;
      name: string;
      isLeave: boolean;
      project: { name: string } | null;
    }>(() =>
      client
        .from("projectElement")
        .select(
          "id, projectId, readableId, name, isLeave, project:project!projectElement_project_fkey!inner(name), state:projectState!projectElement_state_fkey!inner(group)"
        )
        .eq("companyId", companyId)
        .eq("isChargeable", true)
        .eq("project.status", "Released")
        .eq("project.active", true)
        .in("state.group", ["Unstarted", "Started"])
        .order("projectId", { ascending: true })
        .order("sequence", { ascending: true })
    )
  ]);

  if (settings.error) return { data: null, error: settings.error };
  if (projects.error) return { data: null, error: projects.error };
  if (elements.error) return { data: null, error: elements.error };

  const requireElement = settings.data?.requireProjectElement ?? false;

  const projectRows: ChargeNumber[] = requireElement
    ? []
    : (projects.data ?? []).map((project) => ({
        value: `${project.id}|`,
        projectId: project.id,
        projectElementId: null,
        readableId: project.identifier,
        name: project.name,
        projectName: project.name,
        isLeave: false
      }));

  const elementRows: ChargeNumber[] = (elements.data ?? []).map((element) => ({
    value: `${element.projectId}|${element.id}`,
    projectId: element.projectId,
    projectElementId: element.id,
    readableId: element.readableId,
    name: element.name,
    projectName: element.project?.name ?? "",
    isLeave: element.isLeave ?? false
  }));

  return { data: [...projectRows, ...elementRows], error: null };
}

/**
 * The company's timesheet settings: whether time needs approval before it
 * posts, and the timekeeping controls. DCAA mode keeps a future date
 * read-only, asks for a reason before a late or changed entry saves (the
 * entry window) and certifies the week (the certification texts).
 */
export async function getTimesheetSettings(client: Client, companyId: string) {
  return client
    .from("companySettings")
    .select(
      "timesheetApprovalRequired, timekeepingControls, timesheetEntryWindowDays, certificationTextExempt, certificationTextNonExempt"
    )
    .eq("id", companyId)
    .maybeSingle();
}

/** Lists the active labor categories of the company. */
export async function getLaborCategoriesList(
  client: Client,
  companyId: string
) {
  return client
    .from("laborCategory")
    .select("id, name, rdActivityRole")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

const TIMESHEET_ENTRY_COLUMNS =
  "id, entryDate, projectId, projectElementId, laborCategoryId, workLocationId, rdActivityRole, hours, status, createdAt, workLocation:location!timesheetEntry_workLocationId_fkey(id, name), project:project!timesheetEntry_project_fkey(id, identifier, name), element:projectElement!timesheetEntry_element_fkey(id, readableId, name, isLeave), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name), jobId, jobOperationId, job:job!timesheetEntry_job_fkey(id, jobId), jobOperation:jobOperation!timesheetEntry_jobOperation_fkey(id, description)" as const;

function timesheetWeekQuery(client: Client) {
  return client.from("timesheetEntry").select(TIMESHEET_ENTRY_COLUMNS);
}

export type TimesheetWeekEntry = NonNullable<
  Awaited<ReturnType<typeof timesheetWeekQuery>>["data"]
>[number];

/** Gets an employee's timesheet entries between two dates (inclusive). */
export async function getTimesheetWeek(
  client: Client,
  args: { companyId: string; employeeId: string; from: string; to: string }
) {
  return timesheetWeekQuery(client)
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .gte("entryDate", args.from)
    .lte("entryDate", args.to)
    .order("entryDate", { ascending: true })
    .order("createdAt", { ascending: true });
}

export type TimesheetCell = {
  hours: number;
  status: TimesheetEntryStatus;
  /** When the cell's first entry was made: My Time stacks a day's bars by it. */
  createdAt?: string | null;
};

export type TimesheetRow = {
  key: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  /** R&D tax: part of the row's key, sent with every save of the row. */
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
  /** Shop time (DCAA): part of the row's key, sent with every save. */
  jobId: string | null;
  jobOperationId: string | null;
  /** "J000022 · Machining"; empty when the row has no job. */
  job: string;
  readableId: string;
  name: string;
  laborCategory: string;
  workLocation: string;
  /** A leave element (5a): DCAA mode takes time for a future date on it. */
  isLeave: boolean;
  cells: Record<string, TimesheetCell>;
  total: number;
};

/**
 * The grid key of a row: project, element, labor category, work location,
 * research role, job and job operation, as the cell key of
 * `save-timesheet-entry`.
 */
export function timesheetRowKey(row: {
  projectId: string;
  projectElementId?: string | null;
  laborCategoryId: string;
  workLocationId?: string | null;
  rdActivityRole?: RdActivityRole | null;
  jobId?: string | null;
  jobOperationId?: string | null;
}) {
  return [
    row.projectId,
    row.projectElementId ?? "",
    row.laborCategoryId,
    row.workLocationId ?? "",
    row.rdActivityRole ?? "",
    row.jobId ?? "",
    row.jobOperationId ?? ""
  ].join("\u001f");
}

/**
 * Groups entries into rows: one per project, element, labor category, work
 * location, research role, job and job operation, one cell per date. A correction and its reversal add up in one cell; the
 * cell takes the Draft status when there is one, because that is the entry a
 * user can edit.
 */
export function groupTimesheetRows(
  entries: TimesheetWeekEntry[]
): TimesheetRow[] {
  const rows = new Map<string, TimesheetRow>();
  for (const entry of entries) {
    const key = timesheetRowKey(entry);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        projectId: entry.projectId,
        projectElementId: entry.projectElementId,
        laborCategoryId: entry.laborCategoryId,
        workLocationId: entry.workLocationId ?? null,
        rdActivityRole: entry.rdActivityRole ?? null,
        jobId: entry.jobId ?? null,
        jobOperationId: entry.jobOperationId ?? null,
        job: entry.job
          ? [entry.job.jobId, entry.jobOperation?.description]
              .filter(Boolean)
              .join(" · ")
          : "",
        readableId:
          entry.element?.readableId ?? entry.project?.identifier ?? "",
        name: entry.element?.name ?? entry.project?.name ?? "",
        laborCategory: entry.laborCategory?.name ?? "",
        workLocation: entry.workLocation?.name ?? "",
        isLeave: entry.element?.isLeave ?? false,
        cells: {},
        total: 0
      };
      rows.set(key, row);
    }
    const hours = Number(entry.hours);
    const cell = row.cells[entry.entryDate];
    if (!cell) {
      row.cells[entry.entryDate] = {
        hours,
        status: entry.status,
        ...(entry.createdAt ? { createdAt: entry.createdAt } : {})
      };
    } else {
      cell.hours += hours;
      if (entry.status === "Draft") cell.status = entry.status;
      if (
        entry.createdAt &&
        (!cell.createdAt || entry.createdAt < cell.createdAt)
      ) {
        cell.createdAt = entry.createdAt;
      }
    }
    row.total += hours;
  }
  return [...rows.values()];
}

/**
 * Saves one cell of the user's own timesheet through the ERP's
 * `save-timesheet-entry` posting, the one place the DCAA rules live. System
 * scope, as `postTimesheetEntries`: the route saves only the user's own
 * time, and an operator does not hold `projects_update`.
 */
export async function saveTimesheetEntry(
  args: Omit<z.infer<typeof timesheetCellValidator>, "projectElementId"> & {
    projectElementId?: string | null;
    companyId: string;
    employeeId: string;
    userId: string;
  }
) {
  const { companyId, userId, ...input } = args;
  return erpPosting(
    "save-timesheet-entry",
    { companyId, userId },
    {
      employeeId: input.employeeId,
      entryDate: input.entryDate,
      projectId: input.projectId,
      projectElementId: input.projectElementId || null,
      laborCategoryId: input.laborCategoryId,
      hours: input.hours,
      // DCAA mode: the reasons the server requires; empty is none.
      lateReason: input.lateReason || undefined,
      reason: input.reason || undefined,
      // Left out takes the default (job location, category role); "" is none.
      workLocationId:
        input.workLocationId === undefined
          ? undefined
          : input.workLocationId || null,
      rdActivityRole:
        input.rdActivityRole === undefined
          ? undefined
          : input.rdActivityRole || null,
      jobId: input.jobId === undefined ? undefined : input.jobId || null,
      jobOperationId:
        input.jobOperationId === undefined
          ? undefined
          : input.jobOperationId || null
    }
  );
}

/**
 * Submits a week of the user's own timesheet through the ERP's
 * `submit-timesheet-week` posting. System scope, as `saveTimesheetEntry`.
 */
export async function submitTimesheetWeek(args: {
  companyId: string;
  employeeId: string;
  weekStart: string;
  /** DCAA mode: the certification text the employee confirmed. */
  certificationText?: string;
  userId: string;
}) {
  return erpPosting(
    "submit-timesheet-week",
    { companyId: args.companyId, userId: args.userId },
    {
      employeeId: args.employeeId,
      weekStart: args.weekStart,
      certificationText: args.certificationText
    }
  );
}

/**
 * Posts the user's own just-submitted entries through the ERP's
 * `post-timesheet` posting, for a company that does not require approval.
 * System scope: the route has already checked that the entries are the
 * user's own Submitted time, and an operator does not hold `projects_update`.
 */
export async function postTimesheetEntries(args: {
  timesheetEntryIds: string[];
  companyId: string;
  userId: string;
}) {
  return erpPosting(
    "post-timesheet",
    { companyId: args.companyId, userId: args.userId },
    { timesheetEntryIds: args.timesheetEntryIds }
  );
}
