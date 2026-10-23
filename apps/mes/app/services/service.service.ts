// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The MES side of a service job: the Service queue, the job page, the clock.
// Spec: `.ai/specs/2026-10-22-service-jobs-and-returns.md` (MES, phase 2).

import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import { storage } from "@carbon/files";
import { datetime, round } from "@carbon/utils";
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
  locationId: string
) {
  return client
    .from("serviceJob")
    .select(SERVICE_JOB_CARD_COLUMNS)
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
  userId: string,
  date: string
) {
  const assignments = await client
    .from("serviceJobAssignment")
    .select("serviceJobId")
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
  locationId: string
) {
  return client
    .from("serviceJob")
    .select("id", { count: "exact", head: true })
    .eq("locationId", locationId)
    .not("status", "in", CLOSED_STATUSES);
}

/** One job, with its customer, asset (and warranty dates), item and serial. */
export async function getServiceJob(client: Client, id: string) {
  return client
    .from("serviceJob")
    .select(
      "*, customer:customer!serviceJob_customerId_fkey(id, name), customerAsset:customerAsset!serviceJob_customerAssetId_fkey(id, laborWarrantyEndDate, partsWarrantyEndDate), item:item!serviceJob_itemId_fkey(id, readableIdWithRevision, name), trackedEntity:trackedEntity!serviceJob_trackedEntityId_fkey(id, readableId)"
    )
    .eq("id", id)
    .maybeSingle();
}

/** A job's time entries, newest first. */
export async function getServiceJobTime(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobTime")
    .select(
      "id, employeeId, entryDate, startTime, endTime, hours, laborItem:item!serviceJobTime_laborItemId_fkey(id, name)"
    )
    .eq("serviceJobId", serviceJobId)
    .order("entryDate", { ascending: false })
    .order("createdAt", { ascending: false });
}

/** A job's parts and charges, in the order they were added. */
export async function getServiceJobItems(client: Client, serviceJobId: string) {
  return client
    .from("serviceJobItem")
    .select(
      "id, lineType, quantity, unitOfMeasureCode, item:item!serviceJobItem_itemId_fkey(id, name, readableIdWithRevision)"
    )
    .eq("serviceJobId", serviceJobId)
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
      problem: args.problem,
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
