// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { InvalidInputError, NotFoundError } from "@carbon/api/errors";
import type { PermissionRule } from "@carbon/api/permissions";
import { postMaintenanceEventInput } from "@carbon/api/postings";
import type { ServiceContext } from "@carbon/api/service-fn.server";
import type { Database, Json } from "@carbon/database";
import { getCompanyTimeZone, journalReference } from "@carbon/database";
import { DOCUMENT_JOURNAL_STATUSES } from "@carbon/database/accounting-posting";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import {
  type BatchRules,
  compactBatchRules,
  credit,
  datetime,
  debit,
  EPSILON,
  indexBy,
  resolveBatchRules,
  round
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import { notifyScheduleInputsChanged } from "~/modules/production/production.service";
import {
  createAdjustmentJournal,
  isActiveCompanyEmployee,
  refuseUnlessOwned,
  resolveAccountingPeriod,
  TIME_ENTRY_BEFORE_CUTOVER_ERROR
} from "~/modules/shared/shared.service";
import type { GenericQueryFilters } from "~/utils/query";
import { LIST_COUNT, setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { invokePosting } from "../shared/shared.service";
import type {
  failureModeValidator,
  locationValidator,
  maintenanceDispatchCommentValidator,
  maintenanceDispatchEventValidator,
  maintenanceDispatchItemValidator,
  maintenanceDispatchPriority,
  maintenanceDispatchStatus,
  maintenanceScheduleValidator,
  partnerValidator,
  processValidator,
  trainingQuestionValidator,
  trainingValidator,
  workCenterValidator
} from "./resources.models";
import {
  type employeeAbilityCellValidator,
  isMaintenanceDispatchLocked,
  trainingCertificateKeyPrefix,
  validateTrainingCertificate
} from "./resources.models";

/** The bare write under `reactivateWorkCenter`, which also tells the scheduler. */
export async function activateWorkCenter(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("workCenter").update({ active: true }).eq("id", id);
}

/** The bare write under `deactivateAbility`, which also tells the scheduler. */
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

export async function deleteMaintenanceDispatchItem(
  client: SupabaseClient<Database>,
  itemId: string
) {
  return client.from("maintenanceDispatchItem").delete().eq("id", itemId);
}

export async function deleteMaintenanceSchedule(
  client: SupabaseClient<Database>,
  scheduleId: string
) {
  return client.from("maintenanceSchedule").delete().eq("id", scheduleId);
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

/** The bare write under `deactivateWorkCenter`, which also tells the scheduler. */
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
  // The "employees" filter narrows abilities to those a selected employee is
  // assigned to. It targets employeeAbility (a related table), not a column on
  // ability, so resolve it to a set of abilityIds first and drop it from the
  // generic column filters.
  const employeeFilter = args.filters?.find((f) => f.column === "employees");
  const filters = args.filters?.filter((f) => f.column !== "employees");

  // Name/search/sort resolve against the `abilities` view (name comes from the
  // linked process). employeeAbility is stitched in one .in() query afterward
  // rather than embedded, so the read never depends on a view→table embed.
  let query = client
    .from("abilities")
    .select(`*`, { count: LIST_COUNT })
    .eq("companyId", companyId)
    .eq("active", true);

  if (employeeFilter?.value) {
    const employeeIds = employeeFilter.value.split(",");
    const assigned = await client
      .from("employeeAbility")
      .select("abilityId")
      .eq("companyId", companyId)
      .in("employeeId", employeeIds);
    const abilityIds = [
      ...new Set((assigned.data ?? []).map((row) => row.abilityId))
    ];
    // No matching abilities → force an empty result rather than no filter
    query = query.in("id", abilityIds.length > 0 ? abilityIds : [""]);
  }

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, { ...args, filters }, [
    { column: "name", ascending: true }
  ]);

  const result = await query;
  if (result.error || !result.data) return result;

  const abilityIds = result.data.map((a) => a.id).filter(Boolean) as string[];
  const employeeAbilities = await client
    .from("employeeAbility")
    .select("abilityId, employeeId, expiresAt")
    .eq("companyId", companyId)
    .in("abilityId", abilityIds.length > 0 ? abilityIds : [""]);

  const byAbility = new Map<
    string,
    { employeeId: string; expiresAt: string | null }[]
  >();
  for (const ea of employeeAbilities.data ?? []) {
    if (!ea.abilityId) continue;
    const list = byAbility.get(ea.abilityId) ?? [];
    list.push({ employeeId: ea.employeeId, expiresAt: ea.expiresAt });
    byAbility.set(ea.abilityId, list);
  }

  return {
    ...result,
    data: result.data.map((a) => ({
      ...a,
      employeeAbility: a.id ? (byAbility.get(a.id) ?? []) : []
    }))
  };
}

export async function getAbilitiesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("abilities")
    .select(`id, name`)
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
}

export async function getAbility(
  client: SupabaseClient<Database>,
  abilityId: string
) {
  // Name resolves through the `abilities` view (from the linked process);
  // employeeAbility is stitched afterward so this never relies on a view embed.
  const ability = await client
    .from("abilities")
    .select(`*`)
    .eq("id", abilityId)
    .eq("active", true)
    .single();

  if (ability.error || !ability.data) return ability;

  const employeeAbility = await client
    .from("employeeAbility")
    .select("id, employeeId, lastTrainingDate, expiresAt")
    .eq("abilityId", abilityId);

  return {
    ...ability,
    // The view types id/name as nullable, but the INNER JOIN to a NOT-NULL
    // process guarantees both — coerce so consumers keep non-null id/name.
    data: {
      ...ability.data,
      id: ability.data.id ?? "",
      name: ability.data.name ?? "",
      employeeAbility: employeeAbility.data ?? []
    }
  };
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
  employeeId: string,
  companyId: string
) {
  return client
    .from("employeeAbility")
    .select(`*, ability(id, curve, shadowWeeks, process(name))`)
    .eq("employeeId", employeeId)
    .eq("companyId", companyId);
}

export async function getEmployeeAbility(
  client: SupabaseClient<Database>,
  employeeAbilityId: string
) {
  return client
    .from("employeeAbility")
    .select("*")
    .eq("id", employeeAbilityId)
    .single();
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
    .select("*", { count: LIST_COUNT })
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
    .select("*", { count: LIST_COUNT })
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
    .select(`id, name, timezone`)
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
      schedule:maintenanceSchedule(id, name),
      procedure:procedureId(id, name)`
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
    .select(`*`, { count: LIST_COUNT })
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
    { count: LIST_COUNT }
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
    .select(`*`, { count: LIST_COUNT })
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
    { count: LIST_COUNT }
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

  // External assignments are completed by an admin, never by the employee.
  const filteredData = (data ?? [])
    .filter(
      (d) =>
        d.employeeId === employeeId &&
        !d.isExternal &&
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

export async function getTrainingAssignmentStatusForEmployee(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeId: string
) {
  const { data, error } = await client.rpc("get_training_assignment_status", {
    p_company_id: companyId,
    p_employee_id: employeeId
  });

  if (error) return { data: null, error };

  // Surface the trainings that need attention first: Overdue, then Pending,
  // then Not Required, then Completed.
  const statusOrder: Record<string, number> = {
    Overdue: 0,
    Pending: 1,
    "Not Required": 2,
    Completed: 3
  };

  const sorted = (data ?? []).sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 4;
    const bOrder = statusOrder[b.status] ?? 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.trainingName ?? "").localeCompare(b.trainingName ?? "");
  });

  return { data: sorted, error: null };
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
    .select("*", { count: LIST_COUNT })
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
    .select("*", { count: LIST_COUNT })
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
        guidePath,
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
    trainingAssignmentId?: string;
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
  if (args?.trainingAssignmentId) {
    filteredData = filteredData.filter(
      (d) => d.trainingAssignmentId === args.trainingAssignmentId
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
      count: LIST_COUNT
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
  const workCenter = await client
    .from("workCenters")
    .select("*")
    .eq("active", true)
    .eq("id", id)
    .single();

  if (workCenter.error) {
    return workCenter;
  }

  // The "workCenters" view now exposes "alwaysOn" (recreated in the
  // capacity-planning migration), but read it explicitly here alongside the
  // "workCenterShift" operating-shift assignments the view does not carry.
  const [alwaysOn, shifts] = await Promise.all([
    client.from("workCenter").select("alwaysOn").eq("id", id).single(),
    client.from("workCenterShift").select("shiftId").eq("workCenterId", id)
  ]);

  return {
    ...workCenter,
    data: {
      ...workCenter.data,
      alwaysOn: alwaysOn.data?.alwaysOn ?? false,
      shifts: shifts.data?.map((shift) => shift.shiftId) ?? []
    }
  };
}

export async function getWorkCenters(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("workCenters")
    .select("*", {
      count: LIST_COUNT
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

/**
 * Processes that do not yet have an ability. Feeds the New Ability picker so a
 * planner can only mint an ability for a process that lacks one — an ability is
 * a process's qualification, and a process may have at most one.
 */
export async function getProcessesWithoutAbility(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const abilities = await client
    .from("ability")
    .select("processId")
    .eq("companyId", companyId);
  if (abilities.error) return abilities;

  const taken = new Set(
    (abilities.data ?? [])
      .map((a) => a.processId)
      .filter((id): id is string => Boolean(id))
  );

  const processes = await client
    .from("process")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("active", true)
    .order("name");
  if (processes.error) return processes;

  return {
    ...processes,
    data: (processes.data ?? []).filter((p) => !taken.has(p.id))
  };
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
    certificatePath?: string | null;
  }
) {
  return client
    .from("trainingCompletion")
    .insert({
      ...completion,
      completedAt: datetime.timestamp()
    })
    .select("id")
    .single();
}

/** The bare delete under `resources.trainingAssignment.uncomplete`, which also removes the certificate file. */
export async function deleteTrainingCompletion(
  client: SupabaseClient<Database>,
  id: number,
  companyId: string
) {
  return client
    .from("trainingCompletion")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .select("certificatePath");
}

/**
 * The ability a training assignment's training grants on completion, or null.
 * Completing training upserts an `employeeAbility` via the
 * `grant_ability_on_training_completion` trigger, so the caller can restamp the
 * scheduler (`notifyScheduleInputsChanged`) for that ability's operator pool.
 */
export async function getTrainingGrantedAbilityId(
  client: SupabaseClient<Database>,
  trainingAssignmentId: string,
  companyId: string
): Promise<string | null> {
  const assignment = await client
    .from("trainingAssignment")
    .select("trainingId")
    .eq("id", trainingAssignmentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!assignment.data?.trainingId) return null;

  const training = await client
    .from("training")
    .select("grantsAbilityId")
    .eq("id", assignment.data.trainingId)
    .eq("companyId", companyId)
    .maybeSingle();
  return training.data?.grantsAbilityId ?? null;
}

export async function updateAbility(
  client: SupabaseClient<Database>,
  id: string,
  ability: {
    // Name is not stored — it derives from the linked process; it appears in
    // the MCP schema for caller context only. The recertification cadence is
    // the one editable field. Both are optional in the published schema.
    name?: string;
    recertifyEveryDays?: number | null;
  }
) {
  return client
    .from("ability")
    .update({ recertifyEveryDays: ability.recertifyEveryDays })
    .eq("id", id);
}

/**
 * Resolves the qualification expiry for an employee ability. An explicit
 * expiresAt wins; otherwise it is computed from lastTrainingDate + the
 * ability's recertifyEveryDays (null when the ability never expires).
 */
export async function resolveEmployeeAbilityExpiresAt(
  client: SupabaseClient<Database>,
  abilityId: string,
  lastTrainingDate: string | null,
  expiresAt: string | null
): Promise<string | null> {
  if (expiresAt || !lastTrainingDate) return expiresAt;

  const ability = await client
    .from("ability")
    .select("recertifyEveryDays")
    .eq("id", abilityId)
    .single();

  if (!ability.data?.recertifyEveryDays) return null;

  const [y, m, d] = lastTrainingDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + ability.data.recertifyEveryDays))
    .toISOString()
    .slice(0, 10);
}

/** The bare write under `resources.employeeAbility.add` / `.update`, which also tell the scheduler. */
export async function upsertEmployeeAbilityCell(
  client: SupabaseClient<Database>,
  cell: {
    employeeId: string;
    abilityId: string;
    companyId: string;
    lastTrainingDate: string | null;
    expiresAt: string | null;
  }
) {
  return client
    .from("employeeAbility")
    .upsert(cell, { onConflict: "employeeId,abilityId" })
    .select("id")
    .single();
}

/**
 * Find-or-create the ability linked 1:1 to a process. Called when a process
 * has "Requires Ability" toggled on — the ability (named after the process)
 * is what employees get qualified against. `createAbility`, `createProcess`
 * and `updateProcess` call it.
 */
export async function ensureProcessAbility(
  client: SupabaseClient<Database>,
  args: {
    processId: string;
    companyId: string;
    userId: string;
    recertifyEveryDays?: number | null;
  }
) {
  const existing = await client
    .from("ability")
    .select("id")
    .eq("processId", args.processId)
    .eq("companyId", args.companyId)
    .maybeSingle();

  if (existing.error || existing.data) {
    return existing;
  }

  // Name is not stored — it is the process's name, read live through the
  // `abilities` view.
  return client
    .from("ability")
    .insert([
      {
        processId: args.processId,
        companyId: args.companyId,
        curve: {
          data: [{ week: 0, value: 100 }]
        },
        shadowWeeks: 0,
        recertifyEveryDays: args.recertifyEveryDays ?? null,
        createdBy: args.userId
      }
    ])
    .select("id")
    .single();
}

export async function updateSuggestionEmoji(
  client: SupabaseClient<Database>,
  suggestionId: string,
  emoji: string
) {
  return client.from("suggestion").update({ emoji }).eq("id", suggestionId);
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
        companyId: string;
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
      companyId: contractor.companyId,
      createdBy:
        "createdBy" in contractor ? contractor.createdBy : contractor.updatedBy
    };
  });

  return client.from("contractorAbility").insert(contractorAbilities);
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
  // maintenanceFailureMode has no customFields column.
  const { customFields: _customFields, ...mode } = failureMode;
  if ("createdBy" in mode) {
    return client.from("maintenanceFailureMode").insert([mode]).select("id");
  }
  return client
    .from("maintenanceFailureMode")
    .update(sanitize(mode))
    .eq("id", mode.id);
}

/** The bare write under `createLocation` / `updateLocation`; the update also drops the cached timezone. */
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

/** The bare insert under `resources.maintenanceDispatch.create`, which also tells the scheduler. */
export async function insertMaintenanceDispatch(
  client: SupabaseClient<Database>,
  input: {
    companyId: string;
    createdBy: string;
    maintenanceDispatchId?: string;
    status?: (typeof maintenanceDispatchStatus)[number];
    priority?: (typeof maintenanceDispatchPriority)[number];
    severity?:
      | "Preventive"
      | "Operator Performed"
      | "Support Required"
      | "OEM Required";
    source?: "Scheduled" | "Reactive" | "Non-Conformance";
    oeeImpact?: "Down" | "Planned" | "Impact" | "No Impact";
    workCenterId?: string;
    locationId: string;
    assignee?: string;
    suspectedFailureModeId?: string;
    plannedStartTime?: string;
    plannedEndTime?: string;
    takesWorkCenterOffline?: boolean;
    content?: Json;
  }
): Promise<{
  data: { id: string; maintenanceDispatchId: string } | null;
  error: import("@supabase/supabase-js").PostgrestError | null;
}> {
  let maintenanceDispatchId: string;
  if (input.maintenanceDispatchId) {
    maintenanceDispatchId = input.maintenanceDispatchId;
  } else {
    const seq = await client.rpc("get_next_sequence", {
      sequence_name: "maintenanceDispatch",
      company_id: input.companyId
    });
    if (seq.error || !seq.data) {
      return {
        data: null,
        error:
          seq.error ??
          ({
            message: "Failed to generate maintenanceDispatch sequence"
          } as import("@supabase/supabase-js").PostgrestError)
      };
    }
    maintenanceDispatchId = seq.data;
  }

  const dispatch = await client
    .from("maintenanceDispatch")
    .insert({
      maintenanceDispatchId,
      status: input.status ?? "Open",
      priority: input.priority ?? "Medium",
      severity: input.severity ?? "Support Required",
      source: input.source ?? "Reactive",
      oeeImpact: input.oeeImpact ?? "No Impact",
      workCenterId: input.workCenterId ?? null,
      locationId: input.locationId,
      assignee: input.assignee ?? null,
      suspectedFailureModeId: input.suspectedFailureModeId ?? null,
      plannedStartTime: input.plannedStartTime ?? null,
      plannedEndTime: input.plannedEndTime ?? null,
      takesWorkCenterOffline: input.takesWorkCenterOffline ?? false,
      content: input.content,
      companyId: input.companyId,
      createdBy: input.createdBy,
      updatedBy: input.createdBy
    })
    .select("id, maintenanceDispatchId")
    .single();

  if (dispatch.error) return { data: null, error: dispatch.error };

  return {
    data: {
      id: dispatch.data.id,
      maintenanceDispatchId: dispatch.data.maintenanceDispatchId
    },
    error: null
  };
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

/** The bare insert under `resources.maintenanceEvent.create`, which also posts the labor. */
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

/** The bare write under `resources.maintenanceSchedule.create` / `.update`, which also generate its dispatches. */
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
    // @ts-expect-error TS2769 - TODO: fix type
    return await client.from("partner").insert([partner]);
  }
}

// Fold the six per-dimension form fields into the sparse `batchRules` JSONB the
// process row stores. All-default (or empty) → null, which reads back as today's
// behavior via resolveBatchRules. Returns { batchRules } plus the six fields to
// strip from the process write (they are not columns).
function extractBatchRules<
  T extends {
    batchRuleItem?: BatchRules["item"];
    batchRuleSubstance?: BatchRules["substance"];
    batchRuleGrade?: BatchRules["grade"];
    batchRuleDimension?: BatchRules["dimension"];
    batchRuleForm?: BatchRules["form"];
    batchRuleFinish?: BatchRules["finish"];
    batchRuleProducedItem?: BatchRules["producedItem"];
  }
>(source: T) {
  const {
    batchRuleItem,
    batchRuleSubstance,
    batchRuleGrade,
    batchRuleDimension,
    batchRuleForm,
    batchRuleFinish,
    batchRuleProducedItem,
    ...rest
  } = source;
  const batchRules = compactBatchRules(
    resolveBatchRules({
      item: batchRuleItem,
      substance: batchRuleSubstance,
      grade: batchRuleGrade,
      dimension: batchRuleDimension,
      form: batchRuleForm,
      finish: batchRuleFinish,
      producedItem: batchRuleProducedItem
    })
  ) as Json;
  return { batchRules, rest };
}

/** The bare write under `resources.createProcess`, which also keeps its ability in step. */
export async function insertProcess(
  client: SupabaseClient<Database>,
  process: Omit<z.infer<typeof processValidator>, "id"> & {
    companyId: string;
    createdBy: string;
    customFields?: Json;
  }
) {
  const { batchRules, rest: withoutRules } = extractBatchRules(process);
  const { workCenters, ...insert } = withoutRules;
  const processInsert = await client
    .from("process")
    .insert([
      {
        ...insert,
        batchRules,
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

/**
 * The bare write under `resources.updateProcess`: the process and the work
 * centers it replaces, in one transaction. Kysely bypasses RLS, so every
 * statement is scoped to the company and only its own work centers are linked.
 */
export async function updateProcess(
  db: Kysely<KyselyDatabase>,
  process: Omit<z.infer<typeof processValidator>, "id"> & {
    id: string;
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
): Promise<{ error: string | null }> {
  const { batchRules, rest: withoutRules } = extractBatchRules(process);
  const { workCenters, id, companyId, ...update } = withoutRules;
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("process")
        // batchRules isn't in `update` — extractBatchRules destructured the six
        // batchRule* form fields out and folded them into this value — so it must
        // be added explicitly (null = all-default, and null must be written).
        .set({ ...sanitize(update), batchRules })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .deleteFrom("workCenterProcess")
        .where("processId", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      if (!workCenters?.length) return;
      const linked = await trx
        .insertInto("workCenterProcess")
        .columns(["workCenterId", "processId", "companyId", "createdBy"])
        .expression((eb) =>
          eb
            .selectFrom("workCenter")
            .select((eb) => [
              "id as workCenterId",
              eb.val(id).as("processId"),
              "companyId",
              eb.val(update.updatedBy).as("createdBy")
            ])
            .where("id", "in", workCenters)
            .where("companyId", "=", companyId)
        )
        .returning("workCenterId")
        .execute();
      if (linked.length !== new Set(workCenters).size) {
        throw new Error("Work center not found");
      }
    });
    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to update process"
    };
  }
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

/** The bare write under `resources.trainingAssignment.create` / `.update`, which also refuse a second assignment and notify. */
export async function upsertTrainingAssignment(
  client: SupabaseClient<Database>,
  assignment: {
    id?: string;
    trainingId?: string | null;
    name?: string | null;
    groupIds: string[];
    companyId: string;
    createdBy?: string;
    updatedBy?: string;
  }
) {
  if (assignment.id) {
    // Whether an assignment is internal or external is fixed at creation; only
    // an external one's name can change.
    return client
      .from("trainingAssignment")
      .update({
        groupIds: assignment.groupIds,
        ...(assignment.name ? { name: assignment.name } : {}),
        updatedBy: assignment.updatedBy
      })
      .eq("id", assignment.id)
      .eq("companyId", assignment.companyId)
      .select("id")
      .single();
  }
  return client
    .from("trainingAssignment")
    .insert({
      trainingId: assignment.trainingId ?? null,
      name: assignment.trainingId ? null : (assignment.name ?? null),
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

/** The bare write under `createWorkCenter` / `updateWorkCenter`, which also tell the scheduler. */
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
    const { processes, shifts, ...insert } = workCenter;
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

    const workCenterShifts = shifts?.map((shift) => ({
      workCenterId,
      shiftId: shift,
      companyId: insert.companyId,
      createdBy: insert.createdBy
    }));

    if (workCenterShifts) {
      const workCenterShiftInsert = await client
        .from("workCenterShift")
        .insert(workCenterShifts);

      if (workCenterShiftInsert.error) {
        return workCenterShiftInsert;
      }
    }

    return workCenterInsert;
  }
  const { processes, shifts, ...update } = workCenter;
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

  const deleteShifts = await client
    .from("workCenterShift")
    .delete()
    .eq("workCenterId", workCenter.id);

  if (deleteShifts.error) {
    return deleteShifts;
  }

  const workCenterShifts = shifts?.map((shift) => ({
    workCenterId: workCenter.id,
    shiftId: shift,
    companyId: update.companyId,
    createdBy: update.updatedBy
  }));

  if (workCenterShifts) {
    const workCenterShiftUpdate = await client
      .from("workCenterShift")
      .insert(workCenterShifts);
    if (workCenterShiftUpdate.error) {
      return workCenterShiftUpdate;
    }
  }

  return workCenterUpdate;
}
export const logger = getLogger("erp", "resources");

// Reconcile the dispatches' labor postings with their time entries (the
// post-maintenance-event server function — idempotent, so call it after ANY
// change to a dispatch's entries or its completion). Returns the failure's
// message, or null. System: the operation has already authorized the change,
// and a delete-only user must still reverse its cost.
export async function postMaintenanceLabor(
  ctx: ServiceContext,
  maintenanceDispatchIds: string[]
): Promise<string | null> {
  if (maintenanceDispatchIds.length === 0) return null;

  const posting = await invokePosting(
    {
      db: ctx.asSystem.pg,
      companyId: ctx.company.id,
      userId: ctx.auditUserId
    },
    "post-maintenance-event",
    { maintenanceDispatchIds },
    postMaintenanceEvent
  );

  if (posting.error) {
    logger.error("Failed to post maintenance labor", {
      companyId: ctx.company.id,
      maintenanceDispatchIds,
      error: posting.error
    });
    return posting.error.message || "Failed to post maintenance labor";
  }
  return null;
}

const trainingLogger = getLogger("erp", "training-completion");

// An external assignment (no training) is always open and one-time.
type AssignmentForCompletion = {
  trainingId: string | null;
  training: {
    status: string;
    frequency: Database["public"]["Enums"]["trainingFrequency"];
  } | null;
};

// The only completion path (quiz, manager Mark Complete). An external
// assignment may carry a certificate; the server builds its key, so a caller
// cannot point a completion at another person's file.
export async function recordTrainingCompletion(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    trainingAssignmentId: string;
    employeeId: string;
    completedBy: string;
    assignment: AssignmentForCompletion;
    certificate?: FormDataEntryValue | null;
  }
): Promise<{ error: null } | { error: string; status: 400 | 500 }> {
  const { companyId, trainingAssignmentId, employeeId, completedBy } = args;
  const isExternal = args.assignment.trainingId === null;
  const training = args.assignment.training;

  if (!isExternal && training?.status !== "Active") {
    return { error: "This training is not currently active", status: 400 };
  }

  let certificatePath: string | null = null;
  const hasCertificate =
    args.certificate instanceof File && args.certificate.size > 0;
  if (isExternal && hasCertificate) {
    const certificate = await validateTrainingCertificate(
      args.certificate ?? null
    );
    if (certificate.error !== null) {
      return { error: certificate.error, status: 400 };
    }
    const key = `${trainingCertificateKeyPrefix(
      companyId,
      trainingAssignmentId,
      employeeId
    )}${nanoid()}.${certificate.extension}`;
    const upload = await storage(client)
      .company(companyId)
      .upload(key, certificate.file);
    if (upload.error) {
      trainingLogger.error("Failed to upload training certificate", {
        companyId,
        trainingAssignmentId,
        error: upload.error
      });
      return { error: "Failed to upload the certificate", status: 500 };
    }
    certificatePath = key;
  }

  const period = await client.rpc("get_current_training_period", {
    frequency: training?.frequency ?? "Once"
  });

  const completion = await insertTrainingCompletion(client, {
    trainingAssignmentId,
    employeeId,
    period: period.data ?? null,
    companyId,
    completedBy,
    createdBy: completedBy,
    certificatePath
  });
  if (completion.error) {
    // The unique indexes allow one completion per employee and period: a
    // second submit means it is already recorded, which is what was asked.
    const alreadyRecorded = completion.error.code === "23505";
    if (!alreadyRecorded) {
      trainingLogger.error("Failed to record training completion", {
        companyId,
        trainingAssignmentId,
        error: completion.error
      });
    }
    // Nothing points at the new file now.
    if (certificatePath) {
      const removed = await storage(client)
        .company(companyId)
        .remove([certificatePath]);
      if (removed.error) {
        trainingLogger.error("Failed to remove orphaned certificate", {
          companyId,
          certificatePath,
          error: removed.error
        });
      }
    }
    return alreadyRecorded
      ? { error: null }
      : { error: "Failed to record the training as complete", status: 500 };
  }

  // Completing a training that grants an ability adds a qualification (via the
  // grant trigger) — restamp the scheduler for that ability's operator pool.
  const grantedAbilityId = await getTrainingGrantedAbilityId(
    client,
    trainingAssignmentId,
    companyId
  );
  if (grantedAbilityId) {
    await notifyScheduleInputsChanged(
      companyId,
      "ability",
      "Operator qualified via training",
      grantedAbilityId
    );
  }

  return { error: null };
}

/** Qualify an employee for an ability, then tell the scheduler. */
export async function saveEmployeeAbility(
  ctx: ServiceContext,
  input: z.output<typeof employeeAbilityCellValidator>,
  { failure, reason }: { failure: string; reason: string }
) {
  const { employeeId, abilityId } = input;
  const client = ctx.asCaller.supabase;
  const refused = await refuseUnlessOwned(ctx, "ability", { id: abilityId });
  if (refused) return refused;

  const lastTrainingDate = input.lastTrainingDate ?? null;
  const expiresAt = await resolveEmployeeAbilityExpiresAt(
    client,
    abilityId,
    lastTrainingDate,
    input.expiresAt ?? null
  );

  const upsert = await upsertEmployeeAbilityCell(client, {
    employeeId,
    abilityId,
    companyId: ctx.company.id,
    lastTrainingDate,
    expiresAt
  });
  if (upsert.error) return ctx.error("internal", failure, upsert.error);

  await notifyScheduleInputsChanged(
    ctx.company.id,
    "ability",
    reason,
    abilityId
  );
  return { id: upsert.data.id };
}

// ---------------------------------------------------------------------------
// Maintenance dispatches
// ---------------------------------------------------------------------------

export const DISPATCH_LOCKED =
  "Cannot modify a locked dispatch. Reopen it first.";

/** The dispatch, when it is this company's and not Completed or Cancelled. */
export async function editableDispatch(
  ctx: ServiceContext,
  dispatchId: string
) {
  const dispatch = await ctx.asCaller.supabase
    .from("maintenanceDispatch")
    .select("id, status, workCenterId")
    .eq("id", dispatchId)
    .eq("companyId", ctx.company.id)
    .maybeSingle();
  if (dispatch.error) {
    return ctx.error("internal", "Failed to load the dispatch", dispatch.error);
  }
  if (!dispatch.data) return ctx.error("notFound", "Dispatch not found");
  if (isMaintenanceDispatchLocked(dispatch.data.status)) {
    return ctx.error("rule", DISPATCH_LOCKED);
  }
  return dispatch.data;
}

/** Tell an internal assignment's groups they have a training to take. */
export async function notifyTrainingAssignment(
  ctx: ServiceContext,
  assignmentId: string,
  groupIds: string[]
) {
  try {
    await trigger("notify", {
      companyId: ctx.company.id,
      documentId: assignmentId,
      event: NotificationEvent.TrainingAssignment,
      recipient: { type: "group", groupIds },
      from: ctx.auditUserId
    });
  } catch (err) {
    logger.error("Failed to send training assignment notifications", {
      companyId: ctx.company.id,
      assignmentId,
      error: err
    });
  }
}
export interface LaborDimension {
  dimensionId: string;
  valueId: string;
}

export interface LaborGroup {
  reference: string; // journalLine.documentLineReference
  accountId: string;
  dimensions: LaborDimension[];
  amount: number; // signed, journalLine convention
}

export function maintenanceLaborCost(
  durationSeconds: number | null | undefined,
  laborRate: number | null | undefined
): number {
  const hours = Number(durationSeconds ?? 0) / 3600;
  const cost = round(hours * Number(laborRate ?? 0));
  return cost > 0 ? cost : 0;
}

export function laborGroupKey(
  group: Pick<LaborGroup, "reference" | "accountId" | "dimensions">
): string {
  const dims = group.dimensions
    .map((d) => `${d.dimensionId}=${d.valueId}`)
    .sort()
    .join(",");
  return `${group.reference}|${group.accountId}|${dims}`;
}

// Sum signed amounts per group key (several postings of one entry collapse to
// their net).
export function netLaborGroups(groups: LaborGroup[]): Map<string, LaborGroup> {
  const net = new Map<string, LaborGroup>();
  for (const group of groups) {
    const key = laborGroupKey(group);
    const existing = net.get(key);
    if (existing) {
      existing.amount += group.amount;
    } else {
      net.set(key, { ...group, dimensions: [...group.dimensions] });
    }
  }
  return net;
}

// desired − prior, per group. Both sides balance, so the result does too.
export function diffLaborGroups(
  desired: LaborGroup[],
  prior: LaborGroup[]
): LaborGroup[] {
  const want = netLaborGroups(desired);
  const have = netLaborGroups(prior);
  const keys = new Set([...want.keys(), ...have.keys()]);

  const delta: LaborGroup[] = [];
  for (const key of keys) {
    const target = want.get(key);
    const current = have.get(key);
    const amount = round((target?.amount ?? 0) - (current?.amount ?? 0));
    if (Math.abs(amount) < EPSILON) continue;
    const base = (target ?? current)!;
    delta.push({ ...base, amount });
  }
  return delta;
}

/** A line of a journal the enable superseded (posted before the cutover). */
export interface SupersededLaborLine {
  reference: string;
  accountId: string;
  amount: number;
}

/**
 * The enable superseded the labor journals posted before the cutover and
 * opened their expense in retained earnings, so the reconcile no longer sees
 * them as posted. An entry they cover is dropped from `desired` while its
 * expense is unchanged; an entry whose expense changed (edited or deleted) is
 * returned in `changed`, and the caller refuses: its correction is a journal
 * entry, not a re-post dated today.
 */
export function withoutSupersededEntries(
  desired: LaborGroup[],
  superseded: SupersededLaborLine[],
  maintenanceAccountId: string
): { desired: LaborGroup[]; changed: string[] } {
  if (superseded.length === 0) return { desired, changed: [] };
  const expense = (
    lines: Array<Pick<LaborGroup, "reference" | "accountId" | "amount">>
  ) => {
    const byReference = new Map<string, number>();
    for (const line of lines) {
      if (line.accountId !== maintenanceAccountId) continue;
      byReference.set(
        line.reference,
        (byReference.get(line.reference) ?? 0) + line.amount
      );
    }
    return byReference;
  };
  const opened = new Map<string, number>();
  for (const line of superseded) {
    opened.set(line.reference, opened.get(line.reference) ?? 0);
  }
  for (const [reference, amount] of expense(superseded)) {
    opened.set(reference, amount);
  }
  const wanted = expense(desired);
  const changed = [...opened]
    .filter(
      ([reference, amount]) =>
        Math.abs(round((wanted.get(reference) ?? 0) - amount)) >= EPSILON
    )
    .map(([reference]) => reference);
  return {
    desired: desired.filter((group) => !opened.has(group.reference)),
    changed
  };
}

export const postMaintenanceEventPermission = {
  update: "resources"
} satisfies PermissionRule<z.output<typeof postMaintenanceEventInput>>;

/**
 * Reconciles maintenance dispatches' labor postings with their time entries —
 * call it after an entry is ended, added, edited or deleted, or a dispatch is
 * completed. Time is expensed at the work center's labor rate (no overhead):
 * Dr maintenanceAccount / Cr laborAbsorptionAccount, one journal per dispatch
 * that changed. Idempotent: see ./plan.ts.
 */
export async function postMaintenanceEvent(
  ctx: ServiceContext,
  raw: z.input<typeof postMaintenanceEventInput>
) {
  const { maintenanceDispatchIds } = postMaintenanceEventInput.parse(raw);

  const db = ctx.asSystem.pg;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const dispatchIds = [...new Set(maintenanceDispatchIds)];

  const postingDate = datetime
    .today(await getCompanyTimeZone(db, companyId))
    .toString();

  const journalIds = await db.transaction().execute(async (trx) => {
    // Provisional before the company's accounting cutover, Posted after it.
    const postingStatus = await journalPostingStatus(trx, companyId);

    // Row locks: two reconciles of one dispatch must not both post the same
    // difference.
    const dispatches = await trx
      .selectFrom("maintenanceDispatch")
      .select(["id", "maintenanceDispatchId"])
      .where("id", "in", dispatchIds)
      .where("companyId", "=", companyId)
      .forUpdate()
      .execute();
    if (dispatches.length !== dispatchIds.length) {
      throw new NotFoundError("Maintenance dispatch not found");
    }

    const [events, priorLines, supersededLines, accountDefaults, dimensions] =
      await Promise.all([
        trx
          .selectFrom("maintenanceDispatchEvent")
          .select([
            "id",
            "maintenanceDispatchId",
            "endTime",
            "duration",
            "workCenterId",
            "employeeId"
          ])
          .where("maintenanceDispatchId", "in", dispatchIds)
          .where("companyId", "=", companyId)
          .execute(),
        trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .select([
            "journalLine.id",
            "journalLine.documentId",
            "journalLine.documentLineReference",
            "journalLine.accountId",
            "journalLine.amount"
          ])
          .where("journalLine.documentType", "=", "Maintenance Event")
          .where("journalLine.documentId", "in", dispatchIds)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "in", [...DOCUMENT_JOURNAL_STATUSES])
          .execute(),
        // Lines the enable superseded: posted before the cutover.
        trx
          .selectFrom("journalLine")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "journalLine.journalId")
              .onRef("journal.companyId", "=", "journalLine.companyId")
          )
          .select([
            "journalLine.documentId",
            "journalLine.documentLineReference",
            "journalLine.accountId",
            "journalLine.amount"
          ])
          .where("journalLine.documentType", "=", "Maintenance Event")
          .where("journalLine.documentId", "in", dispatchIds)
          .where("journalLine.companyId", "=", companyId)
          .where("journal.status", "=", "Superseded")
          .execute(),
        trx
          .selectFrom("accountDefault")
          .select([
            "maintenanceAccount",
            "laborAbsorptionAccount",
            "retainedEarningsAccount"
          ])
          .where("companyId", "=", companyId)
          .executeTakeFirst(),
        trx
          .selectFrom("dimension")
          .innerJoin(
            "company",
            "company.companyGroupId",
            "dimension.companyGroupId"
          )
          .select(["dimension.id", "dimension.entityType"])
          .where("company.id", "=", companyId)
          .where("dimension.active", "=", true)
          .where("dimension.entityType", "in", [
            "Employee",
            "WorkCenter",
            "Location"
          ])
          .execute()
      ]);
    if (!accountDefaults) throw new Error("Error getting account defaults");
    // Resolved on the first event that carries cost: before the cutover an
    // empty laborAbsorptionAccount becomes a stand-in line, after it the
    // posting is refused.
    let laborAbsorption: ReturnType<typeof resolveDefaultAccount> | null = null;

    const ended = events.filter((e) => e.endTime && Number(e.duration) > 0);
    const workCenterIds = [...new Set(ended.map((e) => e.workCenterId))];
    const [workCenters, priorDimensions] = await Promise.all([
      workCenterIds.length
        ? trx
            .selectFrom("workCenter")
            .select(["id", "laborRate", "locationId"])
            .where("id", "in", workCenterIds)
            .where("companyId", "=", companyId)
            .execute()
        : Promise.resolve([]),
      priorLines.length
        ? trx
            .selectFrom("journalLineDimension")
            .select(["journalLineId", "dimensionId", "valueId"])
            .where(
              "journalLineId",
              "in",
              priorLines.map((l) => l.id)
            )
            .where("companyId", "=", companyId)
            .execute()
        : Promise.resolve([])
    ]);
    const workCenterById = indexBy(workCenters, (wc) => wc.id);

    const dimensionIdByType = new Map(
      dimensions
        .filter((d) => d.entityType)
        .map((d) => [d.entityType as string, d.id])
    );
    const tag = (entityType: string, valueId: string | null | undefined) =>
      valueId && dimensionIdByType.has(entityType)
        ? [{ dimensionId: dimensionIdByType.get(entityType)!, valueId }]
        : [];

    // What each dispatch's entries should have posted.
    const desiredByDispatch = new Map<string, LaborGroup[]>();
    for (const event of ended) {
      const workCenter = workCenterById.get(event.workCenterId);
      const cost = maintenanceLaborCost(event.duration, workCenter?.laborRate);
      if (cost <= 0) continue;
      laborAbsorption ??= resolveDefaultAccount(
        accountDefaults,
        "laborAbsorptionAccount",
        postingStatus
      );
      const reference = journalReference.to.maintenanceEvent(event.id);
      const eventDimensions: LaborDimension[] = [
        ...tag("Employee", event.employeeId),
        ...tag("WorkCenter", event.workCenterId),
        ...tag("Location", workCenter?.locationId)
      ];
      const list = desiredByDispatch.get(event.maintenanceDispatchId) ?? [];
      list.push(
        {
          reference,
          accountId: accountDefaults.maintenanceAccount,
          dimensions: eventDimensions,
          amount: debit("expense", cost)
        },
        {
          reference,
          accountId: laborAbsorption.accountId,
          dimensions: eventDimensions,
          amount: credit("expense", cost)
        }
      );
      desiredByDispatch.set(event.maintenanceDispatchId, list);
    }

    // What the journal already holds, with each line's own tags.
    const dimensionsByLine = new Map<string, LaborDimension[]>();
    for (const d of priorDimensions) {
      const list = dimensionsByLine.get(d.journalLineId) ?? [];
      list.push({ dimensionId: d.dimensionId, valueId: d.valueId });
      dimensionsByLine.set(d.journalLineId, list);
    }
    const priorByDispatch = new Map<string, LaborGroup[]>();
    for (const line of priorLines) {
      const dispatchId = line.documentId ?? "";
      const list = priorByDispatch.get(dispatchId) ?? [];
      list.push({
        reference: line.documentLineReference ?? "",
        accountId: line.accountId ?? "",
        dimensions: dimensionsByLine.get(line.id) ?? [],
        amount: Number(line.amount)
      });
      priorByDispatch.set(dispatchId, list);
    }

    let accountingPeriodId: string | null = null;
    const posted: string[] = [];

    for (const dispatch of dispatches) {
      const prior = priorByDispatch.get(dispatch.id) ?? [];
      const desired = withoutSupersededEntries(
        desiredByDispatch.get(dispatch.id) ?? [],
        supersededLines
          .filter((line) => line.documentId === dispatch.id)
          .map((line) => ({
            reference: line.documentLineReference ?? "",
            accountId: line.accountId ?? "",
            amount: Number(line.amount)
          })),
        accountDefaults.maintenanceAccount
      );
      if (desired.changed.length > 0) {
        throw new InvalidInputError(TIME_ENTRY_BEFORE_CUTOVER_ERROR);
      }
      const delta = diffLaborGroups(desired.desired, prior);
      if (delta.length === 0) continue;

      // A Provisional journal has no accounting period.
      if (postingStatus === "Posted") {
        accountingPeriodId ??= (
          await resolveAccountingPeriod(trx, companyId, postingDate, "current")
        ).id;
      }
      const journalId = await createAdjustmentJournal(trx, {
        companyId,
        accountingPeriodId,
        status: postingStatus,
        description: `Maintenance Labor ${dispatch.maintenanceDispatchId}${
          prior.length > 0 ? " (Adjustment)" : ""
        }`,
        postingDate,
        userId,
        sourceType: "Maintenance Event"
      });

      // One line per insert: each carries its own tags, and a multi-row
      // RETURNING does not promise insert order.
      const journalLineReference = nanoid();
      for (const group of delta) {
        const isMaintenanceLine =
          group.accountId === accountDefaults.maintenanceAccount;
        const line = await trx
          .insertInto("journalLine")
          .values({
            journalId,
            accountId: group.accountId,
            description: isMaintenanceLine
              ? "Maintenance Labor"
              : "Labor Absorption",
            // A Provisional absorption line on Retained Earnings is a
            // stand-in, the new one or the reversal of a prior one; the
            // enable re-points it.
            accountDefaultRole:
              postingStatus === "Provisional" &&
              !isMaintenanceLine &&
              group.accountId === accountDefaults.retainedEarningsAccount
                ? "laborAbsorptionAccount"
                : null,
            amount: group.amount,
            quantity: 1,
            documentType: "Maintenance Event",
            documentId: dispatch.id,
            documentLineReference: group.reference,
            journalLineReference,
            companyId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        if (group.dimensions.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(
              group.dimensions.map((d) => ({
                journalLineId: line.id,
                dimensionId: d.dimensionId,
                valueId: d.valueId,
                companyId
              }))
            )
            .execute();
        }
      }
      posted.push(journalId);
    }

    return posted;
  });

  return { success: true, journalIds };
}

/**
 * A timecard's employee and work center are tagged on the dispatch's labor
 * journal, and their columns take any company's id.
 */
export async function refuseForeignTimecard(
  ctx: ServiceContext,
  timecard: { employeeId: string; workCenterId: string }
) {
  if (
    !(await isActiveCompanyEmployee(
      ctx.asSystem.supabase,
      ctx.company.id,
      timecard.employeeId
    ))
  ) {
    return ctx.error("rule", "Choose an employee of this company");
  }
  return refuseUnlessOwned(ctx, "workCenter", { id: timecard.workCenterId });
}
