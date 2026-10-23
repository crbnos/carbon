// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The MES side of a service job: the Service queue, the job page, the clock.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md` (MES, phase 2).

import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { storage } from "@carbon/files";
import {
  datetime,
  groupServiceTimeRows,
  isServiceJobLocked,
  manualHoursForDay,
  round,
  type ServiceTimeRow,
  type ServiceTimeRowJob,
  textToRichTextDoc
} from "@carbon/utils";
import { parseAbsolute } from "@internationalized/date";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { erpPosting } from "~/services/erp";

type Client = SupabaseClient<Database>;

/** A job that is not Completed, Invoiced or Cancelled is open. */
const CLOSED_STATUSES = '("Completed","Invoiced","Cancelled")';

const SERVICE_JOB_CARD_COLUMNS =
  "id, serviceJobId, status, coverage, workSite, priority, problem, dueDate, assignee, locationId, createdAt, customer:customer!serviceJob_customerId_fkey(id, name), item:item!serviceJob_itemId_fkey(id, name), trackedEntity:trackedEntity!serviceJob_trackedEntityId_fkey(id, readableId)" as const;

/** The location's open service jobs, newest first. */
export async function getOpenServiceJobsByLocation(
  client: Client,
  companyId: string,
  locationId: string
) {
  return client
    .from("serviceJob")
    .select(SERVICE_JOB_CARD_COLUMNS)
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .not("status", "in", CLOSED_STATUSES)
    .order("createdAt", { ascending: false });
}

/**
 * The open jobs the user works on `date` (`YYYY-MM-DD`): an assignment for the
 * user on that day, or the user is the job's lead technician.
 */
export async function getServiceJobsAssignedTo(
  client: Client,
  companyId: string,
  userId: string,
  date: string
) {
  const assignments = await client
    .from("serviceJobAssignment")
    .select("serviceJobId")
    .eq("companyId", companyId)
    .eq("employeeId", userId)
    .eq("scheduledDate", date);
  if (assignments.error) return { data: null, error: assignments.error };

  const jobIds = [
    ...new Set((assignments.data ?? []).map((row) => row.serviceJobId))
  ];
  const assignedTo = `assignee.eq.${userId}`;
  return client
    .from("serviceJob")
    .select(SERVICE_JOB_CARD_COLUMNS)
    .eq("companyId", companyId)
    .or(
      jobIds.length > 0
        ? `${assignedTo},id.in.(${jobIds.join(",")})`
        : assignedTo
    )
    .not("status", "in", CLOSED_STATUSES)
    .order("createdAt", { ascending: false });
}

/** How many service jobs are open at the location: the queue's count. */
export async function getOpenServiceJobsCount(
  client: Client,
  companyId: string,
  locationId: string
) {
  return client
    .from("serviceJob")
    .select("id", { count: "exact", head: true })
    .eq("companyId", companyId)
    .eq("locationId", locationId)
    .not("status", "in", CLOSED_STATUSES);
}

/** One job, with its customer, asset (and warranty dates), item and serial. */
export async function getServiceJob(
  client: Client,
  companyId: string,
  id: string
) {
  return client
    .from("serviceJob")
    .select(
      "*, customer:customer!serviceJob_customerId_fkey(id, name), customerAsset:customerAsset!serviceJob_customerAssetId_fkey(id, laborWarrantyEndDate, partsWarrantyEndDate), item:item!serviceJob_itemId_fkey(id, readableIdWithRevision, name), trackedEntity:trackedEntity!serviceJob_trackedEntityId_fkey(id, readableId)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

/** A job's time entries, newest first. */
export async function getServiceJobTime(
  client: Client,
  companyId: string,
  serviceJobId: string
) {
  return client
    .from("serviceJobTime")
    .select(
      "id, employeeId, entryDate, startTime, endTime, hours, laborItem:item!serviceJobTime_laborItemId_fkey(id, name)"
    )
    .eq("serviceJobId", serviceJobId)
    .eq("companyId", companyId)
    .order("entryDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

/** A job's parts and charges, in the order they were added. */
export async function getServiceJobItems(
  client: Client,
  companyId: string,
  serviceJobId: string
) {
  return client
    .from("serviceJobItem")
    .select(
      "id, lineType, quantity, unitOfMeasureCode, item:item!serviceJobItem_itemId_fkey(id, name, readableIdWithRevision)"
    )
    .eq("serviceJobId", serviceJobId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}

/**
 * Inserts a job a technician opened on the floor: the next `serviceJob`
 * number, In Progress, with the technician as its lead. The caller checks
 * that every id is the company's.
 */
export async function insertServiceJob(
  client: Client,
  args: {
    customerId: string;
    customerAssetId: string | null;
    itemId: string | null;
    trackedEntityId: string | null;
    locationId: string;
    workSite: Database["public"]["Enums"]["serviceWorkSite"];
    coverage: Database["public"]["Enums"]["serviceCoverage"];
    problem: string;
    assignee: string;
    companyId: string;
    createdBy: string;
  }
): Promise<{
  data: { id: string; serviceJobId: string } | null;
  error: PostgrestError | null;
}> {
  const sequence = await client.rpc("get_next_sequence", {
    sequence_name: "serviceJob",
    company_id: args.companyId
  });
  if (sequence.error || !sequence.data) {
    return {
      data: null,
      error:
        sequence.error ??
        ({
          message: "Failed to generate the service job number"
        } as PostgrestError)
    };
  }

  return client
    .from("serviceJob")
    .insert({
      serviceJobId: sequence.data,
      status: "In Progress",
      customerId: args.customerId,
      customerAssetId: args.customerAssetId,
      itemId: args.itemId,
      trackedEntityId: args.trackedEntityId,
      locationId: args.locationId,
      workSite: args.workSite,
      coverage: args.coverage,
      billingMethod: "Time and Materials",
      priority: "Medium",
      // Typed on the floor as plain text; the job holds rich text.
      problem: textToRichTextDoc(args.problem) as Json | null,
      assignee: args.assignee,
      companyId: args.companyId,
      createdBy: args.createdBy,
      updatedBy: args.createdBy
    })
    .select("id, serviceJobId")
    .single();
}

/** The company's default labor item: the rate a new clock entry is costed at. */
export async function getDefaultLaborItemId(client: Client, companyId: string) {
  const settings = await client
    .from("companySettings")
    .select("serviceLaborItemId")
    .eq("id", companyId)
    .maybeSingle();
  return {
    data: settings.data?.serviceLaborItemId ?? null,
    error: settings.error
  };
}

/** The photos and other files of a job, from the company's private bucket. */
export async function getServiceJobFiles(
  client: Client,
  companyId: string,
  serviceJobId: string
) {
  return storage(client)
    .company(companyId)
    .list(`${companyId}/service-job/${serviceJobId}`);
}

/**
 * The employee's running clock, on any job: one at most, by the unique index
 * `serviceJobTime_open_clock_key`.
 */
export async function getRunningServiceClock(
  client: Client,
  args: { employeeId: string; companyId: string }
) {
  return client
    .from("serviceJobTime")
    .select(
      "id, serviceJobId, startTime, serviceJob:serviceJob!serviceJobTime_serviceJobId_fkey(id, serviceJobId)"
    )
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId)
    .not("startTime", "is", null)
    .is("endTime", null)
    .order("startTime", { ascending: false })
    .limit(1)
    .maybeSingle();
}

/** The message for a second Start: the unique index refused the row. */
export const CLOCK_ALREADY_RUNNING =
  "Your clock is already running on another job. Stop it first.";

/** True when an insert hit the one-running-clock-per-employee index. */
export function isRunningClockConflict(error: PostgrestError | null) {
  return (
    error?.code === "23505" &&
    (error.message ?? "").includes("serviceJobTime_open_clock_key")
  );
}

/**
 * Starts the employee's clock on a job: a time entry with a start time and no
 * hours yet, dated the company's today.
 */
export async function startServiceClock(
  client: Client,
  args: {
    serviceJobId: string;
    employeeId: string;
    laborItemId: string;
    billable: boolean;
    companyId: string;
    createdBy: string;
  }
) {
  const timeZone = await getCompanyTimeZone(client, args.companyId);
  return client
    .from("serviceJobTime")
    .insert({
      serviceJobId: args.serviceJobId,
      employeeId: args.employeeId,
      laborItemId: args.laborItemId,
      billable: args.billable,
      entryDate: datetime.today(timeZone).toString(),
      startTime: datetime.timestamp(),
      hours: 0,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("id")
    .single();
}

/**
 * The hours between two instants, rounded to the internal scale. Never
 * negative: a clock stopped before it started (a skewed device) is 0.
 */
export function clockHours(startTime: string, endTime: string): number {
  const elapsed = parseAbsolute(endTime, "UTC").compare(
    parseAbsolute(startTime, "UTC")
  );
  return Math.max(0, round(elapsed / 3_600_000));
}

/**
 * Stops the employee's running clock: its end time, its hours, and the
 * company's day it started on. Returns the stopped entry, or null when no
 * clock was running.
 */
export async function stopServiceClock(
  client: Client,
  args: { employeeId: string; companyId: string; updatedBy: string }
): Promise<{
  data: { id: string; serviceJobId: string; hours: number } | null;
  error: PostgrestError | null;
}> {
  const running = await getRunningServiceClock(client, args);
  if (running.error) return { data: null, error: running.error };
  if (!running.data?.startTime) return { data: null, error: null };

  const timeZone = await getCompanyTimeZone(client, args.companyId);
  const endTime = datetime.timestamp();
  const hours = clockHours(running.data.startTime, endTime);
  const stopped = await client
    .from("serviceJobTime")
    .update({
      endTime,
      hours,
      entryDate: datetime
        .businessDay(running.data.startTime, timeZone)
        .toString(),
      updatedBy: args.updatedBy,
      updatedAt: endTime
    })
    .eq("id", running.data.id)
    .eq("companyId", args.companyId)
    .is("endTime", null)
    .select("id, serviceJobId, hours")
    .single();
  return stopped;
}

/** Sets a job's status, for the Start of the first clock on an Open job. */
export async function updateServiceJobStatus(
  client: Client,
  args: {
    serviceJobId: string;
    status: Database["public"]["Enums"]["serviceJobStatus"];
    companyId: string;
    updatedBy: string;
  }
) {
  return client
    .from("serviceJob")
    .update({
      status: args.status,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.serviceJobId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/** The job fields a technician sets from the MES. */
export type ServiceJobTechnicianUpdate = {
  findings?: Json;
  resolution?: Json;
  repairable?: boolean | null;
  signaturePath?: string;
  signedByName?: string;
};

/**
 * Writes the technician's findings, resolution or repairable flag, or the
 * customer's signature.
 */
export async function updateServiceJobFields(
  client: Client,
  args: {
    serviceJobId: string;
    companyId: string;
    updatedBy: string;
    values: ServiceJobTechnicianUpdate;
  }
) {
  return client
    .from("serviceJob")
    .update({
      ...args.values,
      updatedBy: args.updatedBy,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.serviceJobId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

/**
 * Completes the job in the ERP (`post-service-job`): posts its time to the
 * coverage account and stores the customer's signature, when there is one.
 */
export async function completeServiceJob(
  client: Client,
  args: {
    serviceJobId: string;
    signedByName?: string;
    signaturePath?: string;
    companyId: string;
    userId: string;
  }
) {
  return erpPosting(
    "post-service-job",
    { client, companyId: args.companyId, userId: args.userId },
    {
      action: "complete",
      serviceJobId: args.serviceJobId,
      signedByName: args.signedByName,
      signaturePath: args.signaturePath
    }
  );
}

// --- My Time ----------------------------------------------------------------

type ServiceJobOfRow = {
  id: string;
  serviceJobId: string;
  status: Database["public"]["Enums"]["serviceJobStatus"];
  customer: { name: string } | null;
};

const serviceJobOf = (serviceJob: ServiceJobOfRow): ServiceTimeRowJob => ({
  id: serviceJob.id,
  serviceJobId: serviceJob.serviceJobId,
  status: serviceJob.status,
  customerName: serviceJob.customer?.name ?? null
});

/**
 * The employee's service week on My Time, as the ERP's: one row per job with
 * time or an assignment in the week (`rows`), and the open jobs the employee
 * is assigned to that week or leads, which **Add** offers (`jobs`). Three
 * reads, whatever the number of jobs.
 */
export async function getServiceTimeWeek(
  client: Client,
  args: { companyId: string; employeeId: string; from: string; to: string }
): Promise<{
  rows: ServiceTimeRow[];
  jobs: ServiceTimeRowJob[];
  error: PostgrestError | null;
}> {
  const [time, assignments, ledJobs] = await Promise.all([
    client
      .from("serviceJobTime")
      .select(
        "entryDate, hours, startTime, createdAt, serviceJob:serviceJob!serviceJobTime_serviceJobId_fkey!inner(id, serviceJobId, status, customer:customer!serviceJob_customerId_fkey(name))"
      )
      .eq("employeeId", args.employeeId)
      .eq("companyId", args.companyId)
      .gte("entryDate", args.from)
      .lte("entryDate", args.to),
    client
      .from("serviceJobAssignment")
      .select(
        "serviceJob:serviceJob!serviceJobAssignment_serviceJobId_fkey!inner(id, serviceJobId, status, customer:customer!serviceJob_customerId_fkey(name))"
      )
      .eq("employeeId", args.employeeId)
      .eq("companyId", args.companyId)
      .gte("scheduledDate", args.from)
      .lte("scheduledDate", args.to),
    client
      .from("serviceJob")
      .select(
        "id, serviceJobId, status, customer:customer!serviceJob_customerId_fkey(name)"
      )
      .eq("assignee", args.employeeId)
      .eq("companyId", args.companyId)
      .not("status", "in", CLOSED_STATUSES)
  ]);

  const rows = groupServiceTimeRows(
    (time.data ?? []).map((entry) => ({
      entryDate: entry.entryDate,
      hours: entry.hours,
      startTime: entry.startTime,
      createdAt: entry.createdAt,
      job: serviceJobOf(entry.serviceJob)
    })),
    (assignments.data ?? []).map((assignment) => ({
      job: serviceJobOf(assignment.serviceJob)
    }))
  );

  const jobs = new Map<string, ServiceTimeRowJob>();
  for (const serviceJob of [
    ...(assignments.data ?? []).map((row) => row.serviceJob),
    ...(ledJobs.data ?? [])
  ]) {
    if (!isServiceJobLocked(serviceJob.status)) {
      jobs.set(serviceJob.id, serviceJobOf(serviceJob));
    }
  }

  return {
    rows,
    jobs: [...jobs.values()].sort((a, b) =>
      a.serviceJobId.localeCompare(b.serviceJobId)
    ),
    error: time.error ?? assignments.error ?? ledJobs.error ?? null
  };
}

/** The ERP's refusal of a closed job, word for word. */
export const SERVICE_JOB_CLOSED =
  "This job is closed. A Completed, Invoiced or Cancelled job cannot change.";

/** The ERP's warning for a total below the day's clock time, word for word. */
export const SERVICE_DAY_HAS_CLOCK_TIME =
  "This day has clock time on the job. Edit it on the job.";

/**
 * My Time: sets an employee's total hours on a job for one day, by the ERP's
 * rules (`setServiceJobDayHours`). The difference from the day's clock
 * entries goes to the day's one manual entry (no clock): saved, added at the
 * company's service labor item (billable when the job is Billable), or
 * removed at 0. A total below the clock entries writes nothing
 * (`saved: false`) and comes back as `warning`. Refuses a Completed, Invoiced
 * or Cancelled job, a day with two manual entries and, with
 * `mustBeAssigned`, a job the employee neither leads nor is assigned to.
 *
 * `client` is the service role: every read and write is scoped to
 * `companyId` here, which is the ownership check.
 */
export async function saveServiceDayHours(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    employeeId: string;
    serviceJobId: string;
    entryDate: string;
    hours: number;
    mustBeAssigned: boolean;
  }
): Promise<{
  data: { saved: boolean; warning: string | null } | null;
  error: { message: string; cause?: PostgrestError } | null;
}> {
  const refused = (message: string, cause?: PostgrestError) => ({
    data: null,
    error: { message, cause }
  });

  const job = await client
    .from("serviceJob")
    .select("id, status, coverage, assignee")
    .eq("id", args.serviceJobId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (job.error) {
    return refused("Failed to load the service job", job.error);
  }
  if (!job.data) return refused("Service job not found");
  if (isServiceJobLocked(job.data.status)) return refused(SERVICE_JOB_CLOSED);

  if (args.mustBeAssigned && job.data.assignee !== args.employeeId) {
    const assignment = await client
      .from("serviceJobAssignment")
      .select("id")
      .eq("serviceJobId", job.data.id)
      .eq("companyId", args.companyId)
      .eq("employeeId", args.employeeId)
      .limit(1);
    if (assignment.error) {
      return refused("Failed to load the job's assignments", assignment.error);
    }
    if ((assignment.data ?? []).length === 0) {
      return refused("You can log time only on a job you are assigned to");
    }
  }

  const day = await client
    .from("serviceJobTime")
    .select("id, hours, startTime")
    .eq("serviceJobId", job.data.id)
    .eq("companyId", args.companyId)
    .eq("employeeId", args.employeeId)
    .eq("entryDate", args.entryDate)
    .order("createdAt")
    .order("id");
  if (day.error) return refused("Failed to load the day's time", day.error);
  const entries = (day.data ?? []).map((entry) => ({
    id: entry.id,
    hours: Number(entry.hours),
    startTime: entry.startTime
  }));

  const manual = manualHoursForDay(entries, args.hours);
  if (manual === null) {
    return {
      data: { saved: false, warning: SERVICE_DAY_HAS_CLOCK_TIME },
      error: null
    };
  }
  const manualEntries = entries.filter((entry) => !entry.startTime);
  if (manualEntries.length > 1) {
    return refused(
      "This day has more than one entry on the job. Edit it on the job."
    );
  }
  const existing = manualEntries[0];
  const saved = { data: { saved: true, warning: null }, error: null };

  if (manual === 0) {
    if (existing) {
      const deleted = await client
        .from("serviceJobTime")
        .delete()
        .eq("id", existing.id)
        .eq("companyId", args.companyId);
      if (deleted.error) {
        return refused("Failed to save the hours", deleted.error);
      }
    }
    return saved;
  }

  if (existing) {
    const updated = await client
      .from("serviceJobTime")
      .update({
        hours: manual,
        updatedBy: args.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", existing.id)
      .eq("companyId", args.companyId);
    if (updated.error) {
      return refused("Failed to save the hours", updated.error);
    }
    return saved;
  }

  const laborItemId = await getDefaultLaborItemId(client, args.companyId);
  if (laborItemId.error) {
    return refused("Failed to load the service labor item", laborItemId.error);
  }
  if (!laborItemId.data) {
    return refused("Set the service labor item in Settings → Invoicing first");
  }
  const inserted = await client.from("serviceJobTime").insert({
    companyId: args.companyId,
    serviceJobId: job.data.id,
    employeeId: args.employeeId,
    laborItemId: laborItemId.data,
    entryDate: args.entryDate,
    hours: manual,
    billable: job.data.coverage === "Billable",
    createdBy: args.userId
  });
  if (inserted.error) {
    return refused("Failed to save the hours", inserted.error);
  }
  return saved;
}
