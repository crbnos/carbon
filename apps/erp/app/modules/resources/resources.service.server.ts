import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
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
export const activateWorkCenter = mcpTool(
  {
    classification: "WRITE"
  },
  async function activateWorkCenter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("workCenter").update({ active: true }).eq("id", id);
  }
);

export const deleteAbility = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteAbility(abilityId: string, hardDelete = true) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return hardDelete
      ? client.from("ability").delete().eq("id", abilityId)
      : client.from("ability").update({ active: false }).eq("id", abilityId);
  }
);

export const deleteContractor = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteContractor(contractorId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("contractor").delete().eq("id", contractorId);
  }
);

export const deleteEmployeeAbility = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteEmployeeAbility(employeeAbilityId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeAbility")
      .update({ active: false })
      .eq("id", employeeAbilityId);
  }
);

export const deleteFailureMode = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteFailureMode(failureModeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceFailureMode")
      .delete()
      .eq("id", failureModeId);
  }
);

export const deleteLocation = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteLocation(locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("location").delete().eq("id", locationId);
  }
);

export const deleteMaintenanceDispatch = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatch(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatch").delete().eq("id", dispatchId);
  }
);

export const deleteMaintenanceDispatchComment = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchComment(commentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchComment")
      .delete()
      .eq("id", commentId);
  }
);

export const deleteMaintenanceDispatchEvent = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchEvent(eventId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatchEvent").delete().eq("id", eventId);
  }
);

export const deleteMaintenanceDispatchItem = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchItem(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
  }
);

export const deleteMaintenanceDispatchWorkCenter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceDispatchWorkCenter(workCenterId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchWorkCenter")
      .delete()
      .eq("id", workCenterId);
  }
);

export const deleteMaintenanceSchedule = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceSchedule(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceSchedule").delete().eq("id", scheduleId);
  }
);

export const deleteMaintenanceScheduleItem = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteMaintenanceScheduleItem(itemId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("maintenanceScheduleItem").delete().eq("id", itemId);
  }
);

export const deletePartner = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deletePartner(partnerId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("partner").delete().eq("id", partnerId);
  }
);

export const activateProcess = mcpTool(
  {
    classification: "WRITE"
  },
  async function activateProcess(processId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("process").update({ active: true }).eq("id", processId);
  }
);

export const processDeactivate = mcpTool(
  {
    classification: "WRITE"
  },
  async function processDeactivate(processId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("process").update({ active: false }).eq("id", processId);
  }
);

export const deleteProcess = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteProcess(processId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("process").delete().eq("id", processId);
  }
);

export const deleteShift = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteShift(shiftId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // TODO: Set all employeeShifts to null
    return client.from("shift").update({ active: false }).eq("id", shiftId);
  }
);

export const deleteSuggestion = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSuggestion(suggestionId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("suggestion").delete().eq("id", suggestionId);
  }
);

export const deleteTraining = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteTraining(trainingId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("training").delete().eq("id", trainingId);
  }
);

export const deleteTrainingAssignment = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteTrainingAssignment(assignmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("trainingAssignment").delete().eq("id", assignmentId);
  }
);

export const deleteTrainingQuestion = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteTrainingQuestion(trainingQuestionId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("trainingQuestion")
      .delete()
      .eq("id", trainingQuestionId)
      .eq("companyId", companyId);
  }
);

export const deleteWorkCenter = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteWorkCenter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("workCenter").update({ active: false }).eq("id", id);
  }
);

export const getAbilities = mcpTool(
  {
    classification: "READ"
  },
  async function getAbilities(
    args: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getAbilitiesList = mcpTool(
  {
    classification: "READ"
  },
  async function getAbilitiesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("ability")
      .select(`id, name`)
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getAbility = mcpTool(
  {
    classification: "READ"
  },
  async function getAbility(abilityId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getContractor = mcpTool(
  {
    classification: "READ"
  },
  async function getContractor(contractorId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("contractors")
      .select("*")
      .eq("supplierContactId", contractorId)
      .single();
  }
);

export const getContractors = mcpTool(
  {
    classification: "READ"
  },
  async function getContractors(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getEmployeeAbilities = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployeeAbilities(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeAbility")
      .select(`*, ability(id, name, curve, shadowWeeks)`)
      .eq("employeeId", employeeId)
      .eq("active", true);
  }
);

export const getFailureMode = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureMode(failureModeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceFailureMode")
      .select("*")
      .eq("id", failureModeId)
      .single();
  }
);

export const getFailureModes = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureModes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getFailureModesList = mcpTool(
  {
    classification: "READ"
  },
  async function getFailureModesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("maintenanceFailureMode")
      .select("id, name")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getLocation(locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("location").select("*").eq("id", locationId).single();
  }
);

export const getLocations = mcpTool(
  {
    classification: "READ"
  },
  async function getLocations(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getLocationsList = mcpTool(
  {
    classification: "READ"
  },
  async function getLocationsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("location")
      .select(`id, name`)
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getMaintenanceDispatch = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatch(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatch")
      .select(
        `*,
      assignee:user!maintenanceDispatch_assignee_fkey(id, fullName, avatarUrl),
      suspectedFailureMode:maintenanceFailureMode!maintenanceDispatch_suspectedFailureModeId_fkey(id, name),
      actualFailureMode:maintenanceFailureMode!maintenanceDispatch_actualFailureModeId_fkey(id, name),
      schedule:maintenanceSchedule(id, name),
      procedure:procedureId(id, name)`
      )
      .eq("id", dispatchId)
      .single();
  }
);

export const getMaintenanceDispatchComments = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchComments(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchComment")
      .select(
        `id, comment, createdAt,
       createdBy:user!maintenanceDispatchComment_createdBy_fkey(id, fullName, avatarUrl)`
      )
      .eq("maintenanceDispatchId", dispatchId)
      .order("createdAt", { ascending: false });
  }
);

export const getMaintenanceDispatchEvents = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchEvents(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getMaintenanceDispatchItems = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchItems(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchItem")
      .select(
        `id, itemId, quantity, unitOfMeasureCode, unitCost, totalCost,
       item:item!maintenanceDispatchItem_itemId_fkey(id, name, itemTrackingType)`
      )
      .eq("maintenanceDispatchId", dispatchId);
  }
);

export const getMaintenanceDispatchItemTrackedEntities = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchItemTrackedEntities(
    maintenanceDispatchItemId: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getMaintenanceDispatches = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatches(
    args?: GenericQueryFilters & { search: string | null; status?: string }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaintenanceDispatchesByLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchesByLocation(
    locationId: string,
    args?: GenericQueryFilters & { search: string | null; status?: string }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaintenanceDispatchWorkCenters = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceDispatchWorkCenters(dispatchId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceDispatchWorkCenter")
      .select(
        `id, workCenterId,
       workCenter:workCenter!maintenanceDispatchWorkCenter_workCenterId_fkey(id, name)`
      )
      .eq("maintenanceDispatchId", dispatchId);
  }
);

export const getMaintenanceSchedule = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceSchedule(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceSchedule")
      .select(
        `*,
       workCenter:workCenter!maintenanceSchedule_workCenterId_fkey(id, name)`
      )
      .eq("id", scheduleId)
      .single();
  }
);

export const getMaintenanceScheduleItems = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceScheduleItems(scheduleId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("maintenanceScheduleItem")
      .select(
        `id, quantity, unitOfMeasureCode,
       item:item!maintenanceScheduleItem_itemId_fkey(id, name)`
      )
      .eq("maintenanceScheduleId", scheduleId);
  }
);

export const getMaintenanceSchedules = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceSchedules(
    args?: GenericQueryFilters & { search: string | null; active?: boolean }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getMaintenanceSchedulesByLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getMaintenanceSchedulesByLocation(
    locationId: string,
    args?: GenericQueryFilters & { search: string | null; active?: boolean }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getOutstandingTrainingsForUser = mcpTool(
  {
    classification: "READ"
  },
  async function getOutstandingTrainingsForUser(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getPartner = mcpTool(
  {
    classification: "READ"
  },
  async function getPartner(partnerId: string, abilityId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("partners")
      .select("*")
      .eq("supplierLocationId", partnerId)
      .eq("abilityId", abilityId)
      .single();
  }
);

export const getPartnerBySupplierId = mcpTool(
  {
    classification: "READ"
  },
  async function getPartnerBySupplierId(partnerId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("partners")
      .select("*")
      .eq("supplierLocationId", partnerId)
      .single();
  }
);

export const getPartners = mcpTool(
  {
    classification: "READ"
  },
  async function getPartners(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProcess = mcpTool(
  {
    classification: "READ"
  },
  async function getProcess(processId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("processes").select("*").eq("id", processId).single();
  }
);

export const getProcesses = mcpTool(
  {
    classification: "READ"
  },
  async function getProcesses(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getProcessesList = mcpTool(
  {
    classification: "READ"
  },
  async function getProcessesList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("process")
      .select(`id, name`)
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name");
  }
);

export const getSuggestion = mcpTool(
  {
    classification: "READ"
  },
  async function getSuggestion(suggestionId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("suggestions")
      .select("*")
      .eq("id", suggestionId)
      .single();
  }
);

export const getSuggestions = mcpTool(
  {
    classification: "READ"
  },
  async function getSuggestions(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getTraining = mcpTool(
  {
    classification: "READ"
  },
  async function getTraining(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("training")
      .select("*, trainingQuestion(*)")
      .eq("id", id)
      .single();
  }
);

export const getTrainingAssignment = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingAssignment(assignmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trainingAssignment")
      .select("*, training(id, name, frequency, type, status)")
      .eq("id", assignmentId)
      .single();
  }
);

export const getTrainingAssignmentForCompletion = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingAssignmentForCompletion(assignmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getTrainingAssignments = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingAssignments(trainingId?: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("trainingAssignment")
      .select("*, training(id, name, frequency)")
      .eq("companyId", companyId);

    if (trainingId) {
      query = query.eq("trainingId", trainingId);
    }

    return query;
  }
);

export const getTrainingAssignmentStatus = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingAssignmentStatus(
    args?: {
      trainingId?: string;
      status?: "Completed" | "Pending" | "Overdue" | "Not Required";
      search?: string;
    } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const { data, error } = await client.rpc("get_training_assignment_status", {
      p_company_id: companyId
    });

    if (error) return { data: null, error, count: null };

    let filteredData = data ?? [];

    // Apply filters in memory since we're using an RPC function
    if (args?.trainingId) {
      filteredData = filteredData.filter(
        (d) => d.trainingId === args.trainingId
      );
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
);

export const getTrainingAssignmentSummary = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingAssignmentSummary() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.rpc("get_training_assignment_summary", {
      p_company_id: companyId
    });
  }
);

export const getTrainingQuestions = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingQuestions(trainingId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("trainingQuestion")
      .select("*")
      .eq("trainingId", trainingId)
      .order("sortOrder", { ascending: true });
  }
);

export const getTrainings = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainings(
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getTrainingsList = mcpTool(
  {
    classification: "READ"
  },
  async function getTrainingsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("training")
      .select("id, name, status")
      .eq("companyId", companyId)
      .eq("status", "Active")
      .order("name", { ascending: true });
  }
);

export const getWorkCenter = mcpTool(
  {
    classification: "READ"
  },
  async function getWorkCenter(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("workCenters")
      .select("*")
      .eq("active", true)
      .eq("id", id)
      .single();
  }
);

export const getWorkCenters = mcpTool(
  {
    classification: "READ"
  },
  async function getWorkCenters(
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getWorkCentersByLocation = mcpTool(
  {
    classification: "READ"
  },
  async function getWorkCentersByLocation(locationId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const getWorkCentersList = mcpTool(
  {
    classification: "READ"
  },
  async function getWorkCentersList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("workCenters")
      .select("*")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name");
  }
);

export const getWorkCentersListWithBlockingStatus = mcpTool(
  {
    classification: "READ"
  },
  async function getWorkCentersListWithBlockingStatus() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("workCentersWithBlockingStatus")
      .select("*")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name");
  }
);

export const insertAbility = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertAbility(ability: {
    name: string;
    curve: {
      data: {
        week: number;
        value: number;
      }[];
    };
    shadowWeeks: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    return client
      .from("ability")
      .insert([{ ...ability, companyId, createdBy }])
      .select("*")
      .single();
  }
);

export const insertEmployeeAbilities = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertEmployeeAbilities(
    abilityId: string,
    employeeIds: string[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const insertTrainingCompletion = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertTrainingCompletion(completion: {
    trainingAssignmentId: string;
    employeeId: string;
    period: string | null;
    completedBy: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId: createdBy } = AuthContextHolder.get();
    return client
      .from("trainingCompletion")
      .insert({
        ...completion,
        companyId,
        createdBy,
        completedAt: new Date().toISOString()
      })
      .select("id")
      .single();
  }
);

export const updateAbility = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAbility(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("ability").update(sanitize(ability)).eq("id", id);
  }
);

export const updateSuggestionEmoji = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSuggestionEmoji(suggestionId: string, emoji: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("suggestion").update({ emoji }).eq("id", suggestionId);
  }
);

export const updateSuggestionTags = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSuggestionTags(suggestionId: string, tags: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("suggestion").update({ tags }).eq("id", suggestionId);
  }
);

export const updateTrainingQuestionOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateTrainingQuestionOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client
        .from("trainingQuestion")
        .update({ sortOrder, updatedBy })
        .eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const upsertContractor = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertContractor(
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
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
        createdBy: "createdBy" in contractor ? userId : userId
      };
    });

    return client.from("contractorAbility").insert(contractorAbilities);
  }
);

export const upsertEmployeeAbility = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertEmployeeAbility(employeeAbility: {
    id?: string;
    abilityId: string;
    employeeId: string;
    trainingCompleted: boolean;
    trainingDays?: number;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const { id, ...update } = employeeAbility;
    if (id) {
      return client
        .from("employeeAbility")
        .update(sanitize(update))
        .eq("id", id);
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
      .insert([{ ...update, companyId }])
      .select("id")
      .single();
  }
);

export const upsertFailureMode = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertFailureMode(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertLocation = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertLocation(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in location) {
      return client
        .from("location")
        .update(sanitize(location))
        .eq("id", location.id);
    }
    return client.from("location").insert([location]).select("*").single();
  }
);

export const upsertMaintenanceDispatch = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatch(
    dispatch:
      | (Omit<z.infer<typeof maintenanceDispatchValidator>, "id"> & {
          maintenanceDispatchId: string;
          companyId: string;
          createdBy: string;
          content?: Json;
        })
      | (Omit<
          z.infer<typeof maintenanceDispatchValidator>,
          "id" | "assignee"
        > & {
          id: string;
          assignee: string | null;
          updatedBy: string;
          content?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in dispatch) {
      return (
        client
          .from("maintenanceDispatch")
          // @ts-expect-error TS2769 - TODO: fix type
          .insert([dispatch])
          .select("id")
          .single()
      );
    } else {
      return client
        .from("maintenanceDispatch")
        .update(sanitize(dispatch))
        .eq("id", dispatch.id);
    }
  }
);

export const upsertMaintenanceDispatchComment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchComment(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchEvent = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchEvent(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchItem = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchItem(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceDispatchWorkCenter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceDispatchWorkCenter(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceSchedule = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceSchedule(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertMaintenanceScheduleItem = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertMaintenanceScheduleItem(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertPartner = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertPartner(
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
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("updatedBy" in partner) {
      return client
        .from("partner")
        .update(sanitize(partner))
        .eq("id", partner.id);
    } else {
      // @ts-expect-error TS2769 - TODO: fix type
      return await client.from("partner").insert([partner]);
    }
  }
);

export const upsertProcess = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertProcess(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in process) {
      const { workCenters, ...insert } = process;
      const processInsert = await client
        .from("process")
        .insert([
          {
            ...insert,
            defaultStandardFactor:
              insert.defaultStandardFactor ?? "Minutes/Piece"
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
        companyId: companyId,
        createdBy: userId
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
      companyId: companyId,
      createdBy: userId
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
);

export const upsertTraining = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertTraining(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertTrainingAssignment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertTrainingAssignment(assignment: {
    id?: string;
    trainingId: string;
    groupIds: string[];
  }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if (assignment.id) {
      return client
        .from("trainingAssignment")
        .update({
          groupIds: assignment.groupIds,
          updatedBy: userId
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
        companyId: companyId,
        createdBy: userId!
      })
      .select("id")
      .single();
  }
);

export const upsertTrainingQuestion = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertTrainingQuestion(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertWorkCenter = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertWorkCenter(
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
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
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
        companyId: companyId,
        createdBy: userId
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
      companyId: companyId,
      createdBy: userId
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
);
