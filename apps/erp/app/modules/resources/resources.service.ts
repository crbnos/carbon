import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  failureModeValidator,
  locationValidator,
  maintenanceDispatchCommentValidator,
  maintenanceDispatchEventValidator,
  maintenanceDispatchItemValidator,
  maintenanceDispatchValidator,
  maintenanceDispatchWorkCenterValidator,
  maintenanceScheduleItemValidator,
  maintenanceScheduleValidator,
  partnerValidator,
  processValidator,
  trainingQuestionValidator,
  trainingValidator,
  workCenterValidator
} from "./resources.models";

export async function activateWorkCenter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("workCenter").update({ active: true }).eq("id", id);
}

export async function deleteAbility(
  client: SupabaseClient<Database>,
  abilityId: string,
  hardDelete = true
) {
  return hardDelete
    ? client.from("ability").delete().eq("id", abilityId)
    : client.from("ability").update({ active: false }).eq("id", abilityId);
}

export async function deleteContractor(
  client: SupabaseClient<Database>,
  contractorId: string
) {
  return client.from("contractor").delete().eq("id", contractorId);
}

export async function deleteEmployeeAbility(
  client: SupabaseClient<Database>,
  employeeAbilityId: string
) {
  return client
    .from("employeeAbility")
    .update({ active: false })
    .eq("id", employeeAbilityId);
}

export async function deleteFailureMode(
  client: SupabaseClient<Database>,
  failureModeId: string
) {
  return client.from("maintenanceFailureMode").delete().eq("id", failureModeId);
}

export async function deleteLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client.from("location").delete().eq("id", locationId);
}

export async function deleteMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client.from("maintenanceDispatch").delete().eq("id", dispatchId);
}

export async function deleteMaintenanceDispatchComment(
  client: SupabaseClient<Database>,
  commentId: string
) {
  return client.from("maintenanceDispatchComment").delete().eq("id", commentId);
}

export async function deleteMaintenanceDispatchEvent(
  client: SupabaseClient<Database>,
  eventId: string
) {
  return client.from("maintenanceDispatchEvent").delete().eq("id", eventId);
}

export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
}

export async function deleteMaintenanceDispatchWorkCenter(
  client: SupabaseClient<Database>,
  workCenterId: string
) {
  return client
    .from("maintenanceDispatchWorkCenter")
    .delete()
    .eq("id", workCenterId);
}

export async function deleteMaintenanceSchedule(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client.from("maintenanceSchedule").delete().eq("id", scheduleId);
}

export async function deleteMaintenanceScheduleItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client.from("maintenanceScheduleItem").delete().eq("id", itemId);
}

export async function deletePartner(
  client: SupabaseClient<Database>,
  partnerId: string
) {
  return client.from("partner").delete().eq("id", partnerId);
}

export async function activateProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client.from("process").update({ active: true }).eq("id", processId);
}

export async function processDeactivate(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client.from("process").update({ active: false }).eq("id", processId);
}

export async function deleteProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client.from("process").delete().eq("id", processId);
}

export async function deleteShift(
  client: SupabaseClient<Database>,
  shiftId: string
) {
  // TODO: Set all employeeShifts to null
  return client.from("shift").update({ active: false }).eq("id", shiftId);
}

export async function deleteSuggestion(
  client: SupabaseClient<Database>,
  suggestionId: string
) {
  return client.from("suggestion").delete().eq("id", suggestionId);
}

export async function deleteTraining(
  client: SupabaseClient<Database>,
  trainingId: string
) {
  return client.from("training").delete().eq("id", trainingId);
}

export async function deleteTrainingAssignment(
  client: SupabaseClient<Database>,
  assignmentId: string
) {
  return client.from("trainingAssignment").delete().eq("id", assignmentId);
}

export async function deleteTrainingQuestion(
  client: SupabaseClient<Database>,
  trainingQuestionId: string,
  companyId: string
) {
  return client
    .from("trainingQuestion")
    .delete()
    .eq("id", trainingQuestionId)
    .eq("companyId", companyId);
}

export async function deleteWorkCenter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("workCenter").update({ active: false }).eq("id", id);
}

export async function getAbilities(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("ability")
    .select(`*, employeeAbility(employeeId)`, {
      count: "exact"
    })
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("employeeAbility.active", true);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getAbilitiesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("ability")
    .select(`id, name`)
    .eq("companyId", companyId)
    .order("name");
}

export async function getAbility(
  client: SupabaseClient<Database>,
  abilityId: string
) {
  return client
    .from("ability")
    .select(
      `*, employeeAbility(id, employeeId, lastTrainingDate, trainingDays, trainingCompleted)`,
      {
        count: "exact"
      }
    )
    .eq("id", abilityId)
    .eq("active", true)
    .eq("employeeAbility.active", true)
    .single();
}

export async function getContractor(
  client: SupabaseClient<Database>,
  contractorId: string
) {
  return client
    .from("contractors")
    .select("*")
    .eq("supplierContactId", contractorId)
    .single();
}

export async function getContractors(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("contractors")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  if (args?.search) {
    query = query.or(
      `fullName.ilike.%${args.search}%,email.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "lastName", ascending: true }
    ]);
  }

  return query;
}

export async function getEmployeeAbilities(
  client: SupabaseClient<Database>,
  employeeId: string
) {
  return client
    .from("employeeAbility")
    .select(`*, ability(id, name, curve, shadowWeeks)`)
    .eq("employeeId", employeeId)
    .eq("active", true);
}

export async function getFailureMode(
  client: SupabaseClient<Database>,
  failureModeId: string
) {
  return client
    .from("maintenanceFailureMode")
    .select("*")
    .eq("id", failureModeId)
    .single();
}

export async function getFailureModes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("maintenanceFailureMode")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getFailureModesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("maintenanceFailureMode")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client.from("location").select("*").eq("id", locationId).single();
}

export async function getLocations(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("location")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getLocationsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("location")
    .select(`id, name`)
    .eq("companyId", companyId)
    .order("name");
}

export async function getMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatch")
    .select(
      `*,
      assignee:user!maintenanceDispatch_assignee_fkey(id, fullName, avatarUrl),
      suspectedFailureMode:maintenanceFailureMode!maintenanceDispatch_suspectedFailureModeId_fkey(id, name),
      actualFailureMode:maintenanceFailureMode!maintenanceDispatch_actualFailureModeId_fkey(id, name),
      schedule:maintenanceSchedule(id, name)`
    )
    .eq("id", dispatchId)
    .single();
}

export async function getMaintenanceDispatchComments(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchComment")
    .select(
      `id, comment, createdAt,
       createdBy:user!maintenanceDispatchComment_createdBy_fkey(id, fullName, avatarUrl)`
    )
    .eq("maintenanceDispatchId", dispatchId)
    .order("createdAt", { ascending: false });
}

export async function getMaintenanceDispatchEvents(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchEvent")
    .select(
      `id, startTime, endTime, duration, notes,
       employee:user!maintenanceDispatchEvent_employeeId_fkey(id, fullName, avatarUrl),
       workCenter:workCenter!maintenanceDispatchEvent_workCenterId_fkey(id, name)`
    )
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
      `id, itemId, quantity, unitOfMeasureCode, unitCost, totalCost,
       item:item!maintenanceDispatchItem_itemId_fkey(id, name, itemTrackingType)`
    )
    .eq("maintenanceDispatchId", dispatchId);
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

export async function getMaintenanceDispatches(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; status?: string }
) {
  let query = client
    .from("maintenanceDispatch")
    .select(`*`, { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("maintenanceDispatchId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getMaintenanceDispatchesByLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  args?: GenericQueryFilters & { search: string | null; status?: string }
) {
  let query = client.rpc(
    "get_maintenance_dispatches_by_location",
    {
      p_company_id: companyId,
      p_location_id: locationId
    },
    { count: "exact" }
  );

  if (args?.search) {
    query = query.ilike("maintenanceDispatchId", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getMaintenanceDispatchWorkCenters(
  client: SupabaseClient<Database>,
  dispatchId: string
) {
  return client
    .from("maintenanceDispatchWorkCenter")
    .select(
      `id, workCenterId,
       workCenter:workCenter!maintenanceDispatchWorkCenter_workCenterId_fkey(id, name)`
    )
    .eq("maintenanceDispatchId", dispatchId);
}

export async function getMaintenanceSchedule(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client
    .from("maintenanceSchedule")
    .select(
      `*,
       workCenter:workCenter!maintenanceSchedule_workCenterId_fkey(id, name)`
    )
    .eq("id", scheduleId)
    .single();
}

export async function getMaintenanceScheduleItems(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client
    .from("maintenanceScheduleItem")
    .select(
      `id, quantity, unitOfMeasureCode,
       item:item!maintenanceScheduleItem_itemId_fkey(id, name)`
    )
    .eq("maintenanceScheduleId", scheduleId);
}

export async function getMaintenanceSchedules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null; active?: boolean }
) {
  let query = client
    .from("maintenanceSchedules")
    .select(`*`, { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args?.active !== undefined) {
    query = query.eq("active", args.active);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getMaintenanceSchedulesByLocation(
  client: SupabaseClient<Database>,
  companyId: string,
  locationId: string,
  args?: GenericQueryFilters & { search: string | null; active?: boolean }
) {
  let query = client.rpc(
    "get_maintenance_schedules_by_location",
    {
      p_company_id: companyId,
      p_location_id: locationId
    },
    { count: "exact" }
  );

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args?.active !== undefined) {
    query = query.eq("active", args.active);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getOutstandingTrainingsForUser(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeId: string
) {
  const { data, error } = await client.rpc("get_training_assignment_status", {
    p_company_id: companyId
  });

  if (error) return { data: null, error };

  // Filter to this employee's pending/overdue trainings
  const filteredData = (data ?? [])
    .filter(
      (d) =>
        d.employeeId === employeeId &&
        (d.status === "Pending" || d.status === "Overdue")
    )
    .sort((a, b) => {
      // Overdue first
      if (a.status === "Overdue" && b.status !== "Overdue") return -1;
      if (a.status !== "Overdue" && b.status === "Overdue") return 1;
      return 0;
    });

  return { data: filteredData, error: null };
}

export async function getPartner(
  client: SupabaseClient<Database>,
  partnerId: string,
  abilityId: string
) {
  return client
    .from("partners")
    .select("*")
    .eq("supplierLocationId", partnerId)
    .eq("abilityId", abilityId)
    .single();
}

export async function getPartnerBySupplierId(
  client: SupabaseClient<Database>,
  partnerId: string
) {
  return client
    .from("partners")
    .select("*")
    .eq("supplierLocationId", partnerId)
    .single();
}

export async function getPartners(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("partners")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true);

  if (args?.search) {
    query = query.ilike("supplierName", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "supplierName", ascending: true }
    ]);
  }

  return query;
}

export async function getProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client.from("processes").select("*").eq("id", processId).single();
}

export async function getProcesses(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("processes")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getProcessesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("process")
    .select(`id, name`)
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getSuggestion(
  client: SupabaseClient<Database>,
  suggestionId: string
) {
  return client.from("suggestions").select("*").eq("id", suggestionId).single();
}

export async function getSuggestions(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("suggestions")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("suggestion", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false }
    ]);
  }

  return query;
}

export async function getTraining(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("training")
    .select("*, trainingQuestion(*)")
    .eq("id", id)
    .single();
}

export async function getTrainingAssignment(
  client: SupabaseClient<Database>,
  assignmentId: string
) {
  return client
    .from("trainingAssignment")
    .select("*, training(id, name, frequency, type, status)")
    .eq("id", assignmentId)
    .single();
}

export async function getTrainingAssignmentForCompletion(
  client: SupabaseClient<Database>,
  assignmentId: string
) {
  return client
    .from("trainingAssignment")
    .select(
      `*,
      training(
        id,
        name,
        description,
        content,
        frequency,
        type,
        status,
        estimatedDuration,
        trainingQuestion(*)
      )`
    )
    .eq("id", assignmentId)
    .single();
}

export async function getTrainingAssignments(
  client: SupabaseClient<Database>,
  companyId: string,
  trainingId?: string
) {
  let query = client
    .from("trainingAssignment")
    .select("*, training(id, name, frequency)")
    .eq("companyId", companyId);

  if (trainingId) {
    query = query.eq("trainingId", trainingId);
  }

  return query;
}

export async function getTrainingAssignmentStatus(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: {
    trainingId?: string;
    status?: "Completed" | "Pending" | "Overdue" | "Not Required";
    search?: string;
  } & GenericQueryFilters
) {
  const { data, error } = await client.rpc("get_training_assignment_status", {
    p_company_id: companyId
  });

  if (error) return { data: null, error, count: null };

  let filteredData = data ?? [];

  // Apply filters in memory since we're using an RPC function
  if (args?.trainingId) {
    filteredData = filteredData.filter((d) => d.trainingId === args.trainingId);
  }
  if (args?.status) {
    filteredData = filteredData.filter((d) => d.status === args.status);
  }
  if (args?.search) {
    const searchLower = args.search.toLowerCase();
    filteredData = filteredData.filter(
      (d) =>
        d.trainingName?.toLowerCase().includes(searchLower) ||
        d.employeeName?.toLowerCase().includes(searchLower)
    );
  }

  // Apply sorting
  const sortColumn = args?.sorts?.[0]?.sortBy ?? "employeeName";
  const sortAsc = args?.sorts?.[0]?.sortAsc ?? true;
  filteredData.sort((a, b) => {
    const aVal = a[sortColumn as keyof typeof a] ?? "";
    const bVal = b[sortColumn as keyof typeof b] ?? "";
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  // Apply pagination
  const count = filteredData.length;
  if (args?.limit) {
    const offset = args.offset ?? 0;
    filteredData = filteredData.slice(offset, offset + args.limit);
  }

  return { data: filteredData, error: null, count };
}

export async function getTrainingAssignmentSummary(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.rpc("get_training_assignment_summary", {
    p_company_id: companyId
  });
}

export async function getTrainingQuestions(
  client: SupabaseClient<Database>,
  trainingId: string
) {
  return client
    .from("trainingQuestion")
    .select("*")
    .eq("trainingId", trainingId)
    .order("sortOrder", { ascending: true });
}

export async function getTrainings(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("trainings")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getTrainingsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("training")
    .select("id, name, status")
    .eq("companyId", companyId)
    .eq("status", "Active")
    .order("name", { ascending: true });
}

export async function getWorkCenter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("workCenters")
    .select("*")
    .eq("active", true)
    .eq("id", id)
    .single();
}

export async function getWorkCenters(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("workCenters")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true }
    ]);
  }

  return query;
}

export async function getWorkCentersByLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  // Query both views and merge - workCenters has processes, workCentersWithBlockingStatus has blocking info
  const [workCentersResult, blockingStatusResult] = await Promise.all([
    client
      .from("workCenters")
      .select("*")
      .eq("locationId", locationId)
      .eq("active", true),
    client
      .from("workCentersWithBlockingStatus")
      .select("id, isBlocked, blockingDispatchId, blockingDispatchReadableId")
      .eq("locationId", locationId)
      .eq("active", true)
  ]);

  if (workCentersResult.error) {
    return workCentersResult;
  }

  // Create a map of blocking status by work center id
  const blockingStatusMap = new Map(
    blockingStatusResult.data?.map((wc) => [wc.id, wc]) ?? []
  );

  // Merge the data
  const mergedData = workCentersResult.data?.map((wc) => {
    const blockingStatus = blockingStatusMap.get(wc.id);
    return {
      ...wc,
      isBlocked: blockingStatus?.isBlocked ?? false,
      blockingDispatchId: blockingStatus?.blockingDispatchId ?? null,
      blockingDispatchReadableId:
        blockingStatus?.blockingDispatchReadableId ?? null
    };
  });

  return { data: mergedData, error: null };
}

export async function getWorkCentersList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("workCenters")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getWorkCentersListWithBlockingStatus(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("workCentersWithBlockingStatus")
    .select("*")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function insertAbility(
  client: SupabaseClient<Database>,
  ability: {
    name: string;
    curve: {
      data: {
        week: number;
        value: number;
      }[];
    };
    shadowWeeks: number;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("ability").insert([ability]).select("*").single();
}

export async function insertEmployeeAbilities(
  client: SupabaseClient<Database>,
  abilityId: string,
  employeeIds: string[],
  companyId: string
) {
  const employeeAbilities = employeeIds.map((employeeId) => ({
    abilityId,
    employeeId,
    companyId,
    trainingCompleted: true
  }));

  return client
    .from("employeeAbility")
    .insert(employeeAbilities)
    .select("id")
    .single();
}

export async function insertTrainingCompletion(
  client: SupabaseClient<Database>,
  completion: {
    trainingAssignmentId: string;
    employeeId: string;
    period: string | null;
    companyId: string;
    completedBy: string;
    createdBy: string;
  }
) {
  return client
    .from("trainingCompletion")
    .insert({
      ...completion,
      completedAt: new Date().toISOString()
    })
    .select("id")
    .single();
}

export async function updateAbility(
  client: SupabaseClient<Database>,
  id: string,
  ability: Partial<{
    name: string;
    curve: {
      data: {
        week: number;
        value: number;
      }[];
    };
    shadowWeeks: number;
  }>
) {
  return client.from("ability").update(sanitize(ability)).eq("id", id);
}

export async function updateSuggestionEmoji(
  client: SupabaseClient<Database>,
  suggestionId: string,
  emoji: string
) {
  return client.from("suggestion").update({ emoji }).eq("id", suggestionId);
}

export async function updateSuggestionTags(
  client: SupabaseClient<Database>,
  suggestionId: string,
  tags: string[]
) {
  return client.from("suggestion").update({ tags }).eq("id", suggestionId);
}

export async function updateTrainingQuestionOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client
      .from("trainingQuestion")
      .update({ sortOrder, updatedBy })
      .eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function upsertContractor(
  client: SupabaseClient<Database>,
  contractorWithAbilities:
    | {
        id: string;
        hoursPerWeek?: number;
        abilities: string[];
        companyId: string;
        createdBy: string;
        customFields?: Json;
      }
    | {
        id: string;
        hoursPerWeek?: number;
        abilities: string[];
        updatedBy: string;
        customFields?: Json;
      }
) {
  const { abilities, ...contractor } = contractorWithAbilities;
  if ("updatedBy" in contractor) {
    const updateContractor = await client
      .from("contractor")
      .update(sanitize(contractor))
      .eq("id", contractor.id);
    if (updateContractor.error) {
      return updateContractor;
    }
    const deleteContractorAbilities = await client
      .from("contractorAbility")
      .delete()
      .eq("contractorId", contractor.id);
    if (deleteContractorAbilities.error) {
      return deleteContractorAbilities;
    }
  } else {
    const createContractor = await client
      .from("contractor")
      .insert([contractor]);
    if (createContractor.error) {
      return createContractor;
    }
  }

  const contractorAbilities = abilities.map((ability) => {
    return {
      contractorId: contractor.id,
      abilityId: ability,
      createdBy:
        "createdBy" in contractor ? contractor.createdBy : contractor.updatedBy
    };
  });

  return client.from("contractorAbility").insert(contractorAbilities);
}

export async function upsertEmployeeAbility(
  client: SupabaseClient<Database>,
  employeeAbility: {
    id?: string;
    abilityId: string;
    employeeId: string;
    trainingCompleted: boolean;
    trainingDays?: number;
    companyId: string;
  }
) {
  const { id, ...update } = employeeAbility;
  if (id) {
    return client.from("employeeAbility").update(sanitize(update)).eq("id", id);
  }

  const deactivatedId = await client
    .from("employeeAbility")
    .select("id")
    .eq("employeeId", employeeAbility.employeeId)
    .eq("abilityId", employeeAbility.abilityId)
    .eq("active", false)
    .single();

  if (deactivatedId.data?.id) {
    return client
      .from("employeeAbility")
      .update(sanitize({ ...update, active: true }))
      .eq("id", deactivatedId.data.id);
  }

  return client
    .from("employeeAbility")
    .insert([{ ...update }])
    .select("id")
    .single();
}

export async function upsertFailureMode(
  client: SupabaseClient<Database>,
  failureMode:
    | (Omit<z.infer<typeof failureModeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof failureModeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in failureMode) {
    return client
      .from("maintenanceFailureMode")
      .insert([failureMode])
      .select("id");
  } else {
    return client
      .from("maintenanceFailureMode")
      .update(sanitize(failureMode))
      .eq("id", failureMode.id);
  }
}

export async function upsertLocation(
  client: SupabaseClient<Database>,
  location:
    | (Omit<z.infer<typeof locationValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof locationValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in location) {
    return client
      .from("location")
      .update(sanitize(location))
      .eq("id", location.id);
  }
  return client.from("location").insert([location]).select("*").single();
}

export async function upsertMaintenanceDispatch(
  client: SupabaseClient<Database>,
  dispatch:
    | (Omit<z.infer<typeof maintenanceDispatchValidator>, "id"> & {
        maintenanceDispatchId: string;
        companyId: string;
        createdBy: string;
        content?: Json;
      })
    | (Omit<z.infer<typeof maintenanceDispatchValidator>, "id" | "assignee"> & {
        id: string;
        assignee: string | null;
        updatedBy: string;
        content?: Json;
      })
) {
  if ("createdBy" in dispatch) {
    return client
      .from("maintenanceDispatch")
      .insert([dispatch])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatch")
      .update(sanitize(dispatch))
      .eq("id", dispatch.id);
  }
}

export async function upsertMaintenanceDispatchComment(
  client: SupabaseClient<Database>,
  comment:
    | (Omit<z.infer<typeof maintenanceDispatchCommentValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchCommentValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in comment) {
    return client
      .from("maintenanceDispatchComment")
      .insert([comment])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchComment")
      .update(sanitize(comment))
      .eq("id", comment.id);
  }
}

export async function upsertMaintenanceDispatchEvent(
  client: SupabaseClient<Database>,
  event:
    | (Omit<z.infer<typeof maintenanceDispatchEventValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchEventValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in event) {
    return client
      .from("maintenanceDispatchEvent")
      .insert([event])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchEvent")
      .update(sanitize(event))
      .eq("id", event.id);
  }
}

export async function upsertMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  item:
    | (Omit<z.infer<typeof maintenanceDispatchItemValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchItemValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in item) {
    return client
      .from("maintenanceDispatchItem")
      .insert([item])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchItem")
      .update(sanitize(item))
      .eq("id", item.id);
  }
}

export async function upsertMaintenanceDispatchWorkCenter(
  client: SupabaseClient<Database>,
  workCenter:
    | (Omit<z.infer<typeof maintenanceDispatchWorkCenterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceDispatchWorkCenterValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in workCenter) {
    return client
      .from("maintenanceDispatchWorkCenter")
      .insert([workCenter])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceDispatchWorkCenter")
      .update(sanitize(workCenter))
      .eq("id", workCenter.id);
  }
}

export async function upsertMaintenanceSchedule(
  client: SupabaseClient<Database>,
  schedule:
    | (Omit<z.infer<typeof maintenanceScheduleValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceScheduleValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in schedule) {
    return client
      .from("maintenanceSchedule")
      .insert([schedule])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceSchedule")
      .update(sanitize(schedule))
      .eq("id", schedule.id);
  }
}

export async function upsertMaintenanceScheduleItem(
  client: SupabaseClient<Database>,
  item:
    | (Omit<z.infer<typeof maintenanceScheduleItemValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof maintenanceScheduleItemValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in item) {
    return client
      .from("maintenanceScheduleItem")
      .insert([item])
      .select("id")
      .single();
  } else {
    return client
      .from("maintenanceScheduleItem")
      .update(sanitize(item))
      .eq("id", item.id);
  }
}

export async function upsertPartner(
  client: SupabaseClient<Database>,
  partner:
    | (Omit<z.infer<typeof partnerValidator>, "supplierId"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof partnerValidator>, "supplierId"> & {
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("updatedBy" in partner) {
    return client
      .from("partner")
      .update(sanitize(partner))
      .eq("id", partner.id);
  } else {
    return await client.from("partner").insert([partner]);
  }
}

export async function upsertProcess(
  client: SupabaseClient<Database>,
  process:
    | (Omit<z.infer<typeof processValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof processValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in process) {
    const { workCenters, ...insert } = process;
    const processInsert = await client
      .from("process")
      .insert([
        {
          ...insert,
          defaultStandardFactor: insert.defaultStandardFactor ?? "Minutes/Piece"
        }
      ])
      .select("id")
      .single();
    if (processInsert.error) {
      return processInsert;
    }
    const processId = processInsert.data.id;
    const processProcesses = workCenters?.map((workCenterId) => ({
      workCenterId,
      processId,
      companyId: insert.companyId,
      createdBy: insert.createdBy
    }));

    if (processProcesses) {
      const processProcessInsert = await client
        .from("workCenterProcess")
        .insert(processProcesses);

      if (processProcessInsert.error) {
        return processProcessInsert;
      }
    }

    return processInsert;
  }
  const { workCenters, ...update } = process;
  const processUpdate = await client
    .from("process")
    .update(sanitize(update))
    .eq("id", process.id);
  if (processUpdate.error) {
    return processUpdate;
  }

  const deleteWorkCenters = await client
    .from("workCenterProcess")
    .delete()
    .eq("processId", process.id);

  if (deleteWorkCenters.error) {
    return deleteWorkCenters;
  }

  const processProcesses = workCenters?.map((workCenterId) => ({
    processId: process.id,
    workCenterId,
    companyId: update.companyId,
    createdBy: update.updatedBy
  }));

  if (processProcesses) {
    const processProcessUpdate = await client
      .from("workCenterProcess")
      .insert(processProcesses);
    if (processProcessUpdate.error) {
      return processProcessUpdate;
    }
  }

  return processUpdate;
}

export async function upsertTraining(
  client: SupabaseClient<Database>,
  training:
    | (Omit<z.infer<typeof trainingValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof trainingValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in training) {
    return client
      .from("training")
      .update(sanitize(training))
      .eq("id", training.id)
      .select("id")
      .single();
  }

  return client.from("training").insert([training]).select("id").single();
}

export async function upsertTrainingAssignment(
  client: SupabaseClient<Database>,
  assignment: {
    id?: string;
    trainingId: string;
    groupIds: string[];
    companyId: string;
    createdBy?: string;
    updatedBy?: string;
  }
) {
  if (assignment.id) {
    return client
      .from("trainingAssignment")
      .update({
        groupIds: assignment.groupIds,
        updatedBy: assignment.updatedBy
      })
      .eq("id", assignment.id)
      .select("id")
      .single();
  }
  return client
    .from("trainingAssignment")
    .insert({
      trainingId: assignment.trainingId,
      groupIds: assignment.groupIds,
      companyId: assignment.companyId,
      createdBy: assignment.createdBy!
    })
    .select("id")
    .single();
}

export async function upsertTrainingQuestion(
  client: SupabaseClient<Database>,
  trainingQuestion:
    | (Omit<z.infer<typeof trainingQuestionValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof trainingQuestionValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("id" in trainingQuestion) {
    return client
      .from("trainingQuestion")
      .update(sanitize(trainingQuestion))
      .eq("id", trainingQuestion.id)
      .select("id")
      .single();
  }
  return client
    .from("trainingQuestion")
    .insert([trainingQuestion])
    .select("id")
    .single();
}

export async function upsertWorkCenter(
  client: SupabaseClient<Database>,
  workCenter:
    | (Omit<z.infer<typeof workCenterValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof workCenterValidator>, "id"> & {
        id: string;
        companyId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in workCenter) {
    const { processes, ...insert } = workCenter;
    const workCenterInsert = await client
      .from("workCenter")
      .insert([insert])
      .select("id")
      .single();
    if (workCenterInsert.error) {
      return workCenterInsert;
    }
    const workCenterId = workCenterInsert.data.id;
    const workCenterProcesses = processes?.map((process) => ({
      workCenterId,
      processId: process,
      companyId: insert.companyId,
      createdBy: insert.createdBy
    }));

    if (workCenterProcesses) {
      const workCenterProcessInsert = await client
        .from("workCenterProcess")
        .insert(workCenterProcesses);

      if (workCenterProcessInsert.error) {
        return workCenterProcessInsert;
      }
    }

    return workCenterInsert;
  }
  const { processes, ...update } = workCenter;
  const workCenterUpdate = await client
    .from("workCenter")
    .update(sanitize(update))
    .eq("id", workCenter.id);
  if (workCenterUpdate.error) {
    return workCenterUpdate;
  }

  const deleteProcesses = await client
    .from("workCenterProcess")
    .delete()
    .eq("workCenterId", workCenter.id);

  if (deleteProcesses.error) {
    return deleteProcesses;
  }

  const workCenterProcesses = processes?.map((process) => ({
    workCenterId: workCenter.id,
    processId: process,
    companyId: update.companyId,
    createdBy: update.updatedBy
  }));

  if (workCenterProcesses) {
    const workCenterProcessUpdate = await client
      .from("workCenterProcess")
      .insert(workCenterProcesses);
    if (workCenterProcessUpdate.error) {
      return workCenterProcessUpdate;
    }
  }

  return workCenterUpdate;
}
