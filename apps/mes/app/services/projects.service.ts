// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { fetchAll } from "@carbon/database/fetch-all";
import { serverFns } from "@carbon/server-functions";
import { datetime } from "@carbon/utils";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { z } from "zod";
import type { timesheetCellValidator } from "./models";

// The MES copy of the ERP's timesheet services (`apps/erp/app/modules/
// projects`). The two apps share no module, so a change to the rules there
// must be made here too.

type Client = SupabaseClient<Database>;

type TimesheetEntryStatus = Database["public"]["Enums"]["timesheetEntryStatus"];

function refusal(message: string) {
  return {
    data: null,
    error: { message } as unknown as PostgrestError
  };
}

export type ChargeNumber = {
  /** `projectId|` for the project itself, `projectId|elementId` for an element. */
  value: string;
  projectId: string;
  projectElementId: string | null;
  readableId: string;
  name: string;
  projectName: string;
};

/**
 * Lists what a user can charge: each Released Standard project, and each
 * chargeable element of one whose state is Unstarted or Started. A Service
 * project is charged from its service order's visit page. When
 * the company requires an element, the project-only rows are left out.
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
        .eq("projectType", "Standard")
        .eq("status", "Released")
        .eq("active", true)
        .order("identifier", { ascending: true })
    ),
    fetchAll<{
      id: string;
      projectId: string;
      readableId: string;
      name: string;
      project: { name: string } | null;
    }>(() =>
      client
        .from("projectElement")
        .select(
          "id, projectId, readableId, name, project:project!projectElement_project_fkey!inner(name), state:projectState!projectElement_state_fkey!inner(group)"
        )
        .eq("companyId", companyId)
        .eq("isChargeable", true)
        .eq("project.projectType", "Standard")
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
        projectName: project.name
      }));

  const elementRows: ChargeNumber[] = (elements.data ?? []).map((element) => ({
    value: `${element.projectId}|${element.id}`,
    projectId: element.projectId,
    projectElementId: element.id,
    readableId: element.readableId,
    name: element.name,
    projectName: element.project?.name ?? ""
  }));

  return { data: [...projectRows, ...elementRows], error: null };
}

/** Whether the company requires approval before time posts. */
export async function getTimesheetApprovalRequired(
  client: Client,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("timesheetApprovalRequired")
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
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name", { ascending: true });
}

const TIMESHEET_ENTRY_COLUMNS =
  "id, entryDate, projectId, projectElementId, laborCategoryId, hours, status, project:project!timesheetEntry_project_fkey(id, identifier, name), element:projectElement!timesheetEntry_element_fkey(id, readableId, name), laborCategory:laborCategory!timesheetEntry_category_fkey(id, name)" as const;

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
};

export type TimesheetRow = {
  key: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  readableId: string;
  name: string;
  laborCategory: string;
  cells: Record<string, TimesheetCell>;
  total: number;
};

/** The grid key of a row: project, element and labor category. */
export function timesheetRowKey(row: {
  projectId: string;
  projectElementId?: string | null;
  laborCategoryId: string;
}) {
  return [row.projectId, row.projectElementId ?? "", row.laborCategoryId].join(
    "\u001f"
  );
}

/**
 * Groups entries into rows: one per project, element and labor category,
 * one cell per date. A correction and its reversal add up in one cell; the
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
        readableId:
          entry.element?.readableId ?? entry.project?.identifier ?? "",
        name: entry.element?.name ?? entry.project?.name ?? "",
        laborCategory: entry.laborCategory?.name ?? "",
        cells: {},
        total: 0
      };
      rows.set(key, row);
    }
    const hours = Number(entry.hours);
    const cell = row.cells[entry.entryDate];
    if (!cell) {
      row.cells[entry.entryDate] = { hours, status: entry.status };
    } else {
      cell.hours += hours;
      if (entry.status === "Draft") cell.status = entry.status;
    }
    row.total += hours;
  }
  return [...rows.values()];
}

/**
 * Saves one cell of the timesheet. A Draft entry is updated, or deleted at
 * 0 hours. A Rejected entry goes back to Draft. Submitted, Approved and
 * Posted entries are refused.
 */
export async function upsertTimesheetCell(
  client: Client,
  args: Omit<z.infer<typeof timesheetCellValidator>, "projectElementId"> & {
    projectElementId?: string | null;
    companyId: string;
    employeeId: string;
    userId: string;
  }
) {
  let existing = client
    .from("timesheetEntry")
    .select("id, status")
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .eq("entryDate", args.entryDate)
    .eq("projectId", args.projectId)
    .eq("laborCategoryId", args.laborCategoryId)
    .is("reversalOfId", null);
  existing = args.projectElementId
    ? existing.eq("projectElementId", args.projectElementId)
    : existing.is("projectElementId", null);
  const entries = await existing;
  if (entries.error) return { data: null, error: entries.error };

  const rows = entries.data ?? [];
  const editable =
    rows.find((row) => row.status === "Draft") ??
    rows.find((row) => row.status === "Rejected");

  if (!editable) {
    if (rows.some((row) => row.status === "Posted")) {
      return refusal(
        "This time is posted. A correction in the ERP changes posted hours."
      );
    }
    if (rows.length > 0) {
      return refusal(
        "This time is submitted. It can change only after it is rejected."
      );
    }
    if (args.hours === 0) return { data: null, error: null };
    return client
      .from("timesheetEntry")
      .insert([
        {
          companyId: args.companyId,
          employeeId: args.employeeId,
          entryDate: args.entryDate,
          projectId: args.projectId,
          projectElementId: args.projectElementId ?? null,
          laborCategoryId: args.laborCategoryId,
          hours: args.hours,
          status: "Draft",
          createdBy: args.userId
        }
      ])
      .select("id")
      .single();
  }

  if (args.hours === 0) {
    return client
      .from("timesheetEntry")
      .delete()
      .eq("id", editable.id)
      .eq("companyId", args.companyId)
      .in("status", ["Draft", "Rejected"])
      .select("id")
      .single();
  }

  return client
    .from("timesheetEntry")
    .update({
      hours: args.hours,
      status: "Draft",
      rejectionNote: null,
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", editable.id)
    .eq("companyId", args.companyId)
    .in("status", ["Draft", "Rejected"])
    .select("id")
    .single();
}

/**
 * Submits an employee's Draft entries between two dates (inclusive).
 * Returns the ids it submitted.
 */
export async function submitTimesheetEntries(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    employeeId: string;
    from: string;
    to: string;
    userId: string;
  }
) {
  const now = datetime.timestamp();
  const rows = await db
    .updateTable("timesheetEntry")
    .set({
      status: "Submitted",
      submittedAt: now,
      updatedBy: args.userId,
      updatedAt: now
    })
    .where("companyId", "=", args.companyId)
    .where("employeeId", "=", args.employeeId)
    .where("status", "=", "Draft")
    .where("entryDate", ">=", args.from)
    .where("entryDate", "<=", args.to)
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Posts the user's own just-submitted entries through `post-timesheet`, for
 * a company that does not require approval. System scope: the route has
 * already checked that the entries are the user's own Submitted time, and an
 * operator does not hold `projects_update`.
 */
export async function postTimesheetEntries(
  db: Kysely<KyselyDatabase>,
  args: { timesheetEntryIds: string[]; companyId: string; userId: string }
) {
  return serverFns
    .system({ db, companyId: args.companyId, userId: args.userId })
    .invoke("post-timesheet", { timesheetEntryIds: args.timesheetEntryIds });
}
