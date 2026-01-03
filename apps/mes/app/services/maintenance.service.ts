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
      maintenanceSchedule:maintenanceScheduleId (id, name)
    `
    )
    .eq("id", dispatchId)
    .single();
}

export async function getActiveMaintenanceEventByEmployee(
  client: SupabaseClient<Database>,
  employeeId: string
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
    .eq("employeeId", employeeId)
    .is("endTime", null)
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

export async function endMaintenanceEvent(
  client: SupabaseClient<Database>,
  args: {
    eventId: string;
    endTime: string;
    updatedBy: string;
  }
) {
  return client
    .from("maintenanceDispatchEvent")
    .update({
      endTime: args.endTime,
      updatedBy: args.updatedBy
    })
    .eq("id", args.eventId)
    .select("id")
    .single();
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
    .select("id")
    .single();
}

export async function assignMaintenanceDispatch(
  client: SupabaseClient<Database>,
  args: {
    dispatchId: string;
    assignee: string;
    updatedBy: string;
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
  itemId: string
) {
  return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
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
