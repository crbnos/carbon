// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getActiveMaintenanceDispatchesByLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("activeMaintenanceDispatchesByLocation")
    .select("*")
    .eq("locationId", locationId)
    .order("createdAt", { ascending: false });
}

export async function getMaintenanceDispatchesAssignedTo(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("activeMaintenanceDispatchesByLocation")
    .select("*")
    .eq("assignee", userId)
    .order("createdAt", { ascending: false });
}

export async function getBlockedWorkCenters(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("workCentersWithBlockingStatus")
    .select(
      "id, name, isBlocked, blockingDispatchId, blockingDispatchReadableId"
    )
    .eq("locationId", locationId)
    .eq("isBlocked", true);
}

export async function getWorkCenterWithBlockingStatus(
  client: SupabaseClient<Database>,
  workCenterId: string
) {
  return client
    .from("workCentersWithBlockingStatus")
    .select(
      "id, name, isBlocked, blockingDispatchId, blockingDispatchReadableId"
    )
    .eq("id", workCenterId)
    .single();
}

export async function getMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatch")
    .select(
      `
      *,
      workCenter:workCenterId (id, name, locationId),
      assigneeUser:assignee (id, fullName, avatarUrl),
      suspectedFailureMode:suspectedFailureModeId (id, name),
      actualFailureMode:actualFailureModeId (id, name),
      maintenanceSchedule:maintenanceScheduleId (id, name),
      procedure:procedureId (id, name, content)
    `
    )
    .eq("id", dispatchId)
    .single();
}

// The employee's open event on ONE dispatch. Scoped to the dispatch (an open
// event elsewhere must not hide this one) and tolerant of duplicates: a bare
// `.maybeSingle()` errored on a second open row, the page read "not working",
// and every Play click stacked another open event.
export async function getActiveMaintenanceEventByEmployee(
  client: SupabaseClient<Database>,
  args: { dispatchId: string; employeeId: string; companyId: string }
) {
  return client
    .from("maintenanceDispatchEvent")
    .select(
      `
      *,
      maintenanceDispatch:maintenanceDispatchId (
        id,
        maintenanceDispatchId,
        status,
        priority,
        severity,
        oeeImpact,
        workCenterId
      )
    `
    )
    .eq("maintenanceDispatchId", args.dispatchId)
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId)
    .is("endTime", null)
    .order("startTime", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function getActiveMaintenanceEventsCount(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client
    .from("activeMaintenanceDispatchesByLocation")
    .select("id", { count: "exact", head: true })
    .eq("locationId", locationId);
}

export async function startMaintenanceEvent(
  client: SupabaseClient<Database>,
  args: {
    maintenanceDispatchId: string;
    employeeId: string;
    workCenterId: string;
    startTime: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("maintenanceDispatchEvent")
    .insert([
      {
        maintenanceDispatchId: args.maintenanceDispatchId,
        employeeId: args.employeeId,
        workCenterId: args.workCenterId,
        startTime: args.startTime,
        companyId: args.companyId,
        createdBy: args.createdBy
      }
    ])
    .select("id")
    .single();
}

// Ends every open event the employee has on the dispatch, not just one id, so
// a pause also closes any duplicate an earlier double-start left open.
export async function endMaintenanceEvent(
  client: SupabaseClient<Database>,
  args: {
    dispatchId: string;
    employeeId: string;
    endTime: string;
    updatedBy: string;
    companyId: string;
  }
) {
  return client
    .from("maintenanceDispatchEvent")
    .update({
      endTime: args.endTime,
      updatedBy: args.updatedBy
    })
    .eq("maintenanceDispatchId", args.dispatchId)
    .eq("employeeId", args.employeeId)
    .eq("companyId", args.companyId)
    .is("endTime", null)
    .select("id");
}

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event edge function — idempotent, so call it after any
// entry ends or the dispatch completes).
export async function postMaintenanceLabor(
  client: SupabaseClient<Database>,
  args: { maintenanceDispatchIds: string[]; companyId: string; userId: string }
) {
  return client.functions.invoke<{ success: boolean; error?: string }>(
    "post-maintenance-event",
    { body: args }
  );
}

export async function updateMaintenanceDispatchStatus(
  client: SupabaseClient<Database>,
  args: {
    dispatchId: string;
    status: "Open" | "Assigned" | "In Progress" | "Completed" | "Cancelled";
    updatedBy: string;
    actualStartTime?: string;
    actualEndTime?: string;
    completedAt?: string;
    companyId: string;
  }
) {
  return client
    .from("maintenanceDispatch")
    .update({
      status: args.status,
      actualStartTime: args.actualStartTime,
      actualEndTime: args.actualEndTime,
      completedAt: args.completedAt,
      updatedBy: args.updatedBy
    })
    .eq("id", args.dispatchId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function assignMaintenanceDispatch(
  client: SupabaseClient<Database>,
  args: {
    dispatchId: string;
    assignee: string;
    updatedBy: string;
    companyId: string;
  }
) {
  return client
    .from("maintenanceDispatch")
    .update({
      assignee: args.assignee,
      status: "Assigned",
      updatedBy: args.updatedBy
    })
    .eq("id", args.dispatchId)
    .eq("companyId", args.companyId)
    .select("id")
    .single();
}

export async function getMaintenanceDispatchEvents(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchEvent")
    .select("*")
    .eq("maintenanceDispatchId", dispatchId)
    .order("startTime", { ascending: false });
}

export async function getMaintenanceDispatchItems(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchItem")
    .select(
      `
      *,
      item:itemId (id, name, description, itemTrackingType)
    `
    )
    .eq("maintenanceDispatchId", dispatchId);
}

export async function getWorkCenterReplacementParts(
  client: SupabaseClient<Database>,
  workCenterId: string
) {
  return client
    .from("workCenterReplacementPart")
    .select(
      `
      *,
      item:itemId (id, name, description)
    `
    )
    .eq("workCenterId", workCenterId);
}

export async function addMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  args: {
    maintenanceDispatchId: string;
    itemId: string;
    quantity: number;
    unitOfMeasureCode: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client
    .from("maintenanceDispatchItem")
    .insert([
      {
        maintenanceDispatchId: args.maintenanceDispatchId,
        itemId: args.itemId,
        quantity: args.quantity,
        unitOfMeasureCode: args.unitOfMeasureCode,
        companyId: args.companyId,
        createdBy: args.createdBy
      }
    ])
    .select("id")
    .single();
}

export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  itemId: string,
  companyId: string
) {
  return client
    .from("maintenanceDispatchItem")
    .delete()
    .eq("id", itemId)
    .eq("companyId", companyId);
}

export async function getMaintenanceDispatchItemTrackedEntities(
  client: SupabaseClient<Database>,
  maintenanceDispatchItemId: string
) {
  return client
    .from("maintenanceDispatchItemTrackedEntity")
    .select(
      `
      *,
      trackedEntity:trackedEntityId (id, quantity, status, readableId:sourceDocumentReadableId)
    `
    )
    .eq("maintenanceDispatchItemId", maintenanceDispatchItemId);
}
