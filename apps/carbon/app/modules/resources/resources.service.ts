import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  equipmentTypeValidator,
  equipmentValidator,
  locationValidator,
  partnerValidator,
  processValidator,
  workCellTypeValidator,
  workCellValidator,
} from "./resources.models";

export async function deleteAbility(
  client: SupabaseClient<Database>,
  abilityId: string,
  hardDelete = false
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

export async function deleteEquipment(
  client: SupabaseClient<Database>,
  equipmentId: string
) {
  return client
    .from("equipment")
    .update({ active: false })
    .eq("id", equipmentId);
}

export async function deleteEquipmentType(
  client: SupabaseClient<Database>,
  equipmentTypeId: string
) {
  return client
    .from("equipmentType")
    .update({ active: false })
    .eq("id", equipmentTypeId);
}

export async function deleteLocation(
  client: SupabaseClient<Database>,
  locationId: string
) {
  return client.from("location").delete().eq("id", locationId);
}

export async function deletePartner(
  client: SupabaseClient<Database>,
  partnerId: string
) {
  return client.from("partner").delete().eq("id", partnerId);
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

export async function deleteWorkCell(
  client: SupabaseClient<Database>,
  workCellId: string
) {
  return client.from("workCell").update({ active: false }).eq("id", workCellId);
}

export async function deleteWorkCellType(
  client: SupabaseClient<Database>,
  workCellTypeId: string
) {
  return client
    .from("workCellType")
    .update({ active: false })
    .eq("id", workCellTypeId);
}

export async function getAbilities(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("ability")
    .select(`*, employeeAbility(user(id, fullName, avatarUrl))`, {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("employeeAbility.active", true)
    .eq("employeeAbility.user.active", true);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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
      `*, employeeAbility(id, user(id, fullName, avatarUrl, active), lastTrainingDate, trainingDays, trainingCompleted)`,
      {
        count: "exact",
      }
    )
    .eq("id", abilityId)
    .eq("active", true)
    .eq("employeeAbility.active", true)
    .eq("employeeAbility.user.active", true)
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
      `firstName.ilike.%${args.search}%,lastName.ilike.%${args.search}%`
    );
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "lastName", ascending: true },
    ]);
  }

  return query;
}

export async function getEmployeeAbility(
  client: SupabaseClient<Database>,
  abilityId: string,
  employeeAbilityId: string
) {
  return client
    .from("employeeAbility")
    .select(`*, user(id, fullName, avatarUrl)`)
    .eq("abilityId", abilityId)
    .eq("id", employeeAbilityId)
    .eq("active", true)
    .single();
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

export async function getEquipment(
  client: SupabaseClient<Database>,
  equipmentId: string
) {
  return client
    .from("equipment")
    .select(
      "*, equipmentType(id, name), workCell(id, name), location(id, name)"
    )
    .eq("id", equipmentId)
    .eq("active", true)
    .single();
}

export async function getEquipmentType(
  client: SupabaseClient<Database>,
  equipmentTypeId: string
) {
  return client
    .from("equipmentType")
    .select(
      "*, equipment(id, name, equipmentId, description, location(id, name))"
    )
    .eq("active", true)
    .eq("id", equipmentTypeId)
    .single();
}

export async function getEquipmentTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("equipmentType")
    .select("*, equipment(id, name, equipmentId, description)", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("equipment.active", true);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
    ]);
  }

  return query;
}

export async function getEquipmentTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("equipmentType")
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
      { column: "name", ascending: true },
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
      { column: "supplierName", ascending: true },
    ]);
  }

  return query;
}

export async function getProcess(
  client: SupabaseClient<Database>,
  processId: string
) {
  return client.from("process").select("*").eq("id", processId).single();
}

export async function getProcesses(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("process")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
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
    .order("name");
}

export async function getWorkCell(
  client: SupabaseClient<Database>,
  workCellId: string
) {
  return client
    .from("workCell")
    .select(
      "*, workCellType(id, name), location(id, name), department(id, name)"
    )
    .eq("id", workCellId)
    .eq("active", true)
    .single();
}

export async function getWorkCellList(
  client: SupabaseClient<Database>,
  locationId: string | null,
  workCellTypeId: string | null
) {
  let query = client.from("workCell").select(`id, name`).eq("active", true);

  if (locationId) {
    query = query.eq("locationId", locationId);
  }

  if (workCellTypeId) {
    query = query.eq("workCellTypeId", workCellTypeId);
  }

  return query.order("name");
}

export async function getWorkCellType(
  client: SupabaseClient<Database>,
  workCellTypeId: string
) {
  return client
    .from("workCellType")
    .select("*, workCell(id, name, location(id, name), department(id, name))")
    .eq("active", true)
    .eq("id", workCellTypeId)
    .single();
}

export async function getWorkCellTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("workCellType")
    .select("*, workCell(id, name)", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("workCell.active", true);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
    ]);
  }

  return query;
}

export async function getWorkCellTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("workCellType")
    .select("id, name")
    .eq("companyId", companyId)
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
  employeeIds: string[]
) {
  const employeeAbilities = employeeIds.map((employeeId) => ({
    abilityId,
    employeeId,
    trainingCompleted: true,
  }));

  return client
    .from("employeeAbility")
    .insert(employeeAbilities)
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
        "createdBy" in contractor ? contractor.createdBy : contractor.updatedBy,
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

export async function upsertEquipment(
  client: SupabaseClient<Database>,
  equipment:
    | (Omit<z.infer<typeof equipmentValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof equipmentValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in equipment) {
    const { id, ...update } = equipment;
    return client.from("equipment").update(sanitize(update)).eq("id", id);
  }

  return client.from("equipment").insert([equipment]).select("*").single();
}

export async function upsertEquipmentType(
  client: SupabaseClient<Database>,
  equipmentType:
    | (Omit<z.infer<typeof equipmentTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof equipmentTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in equipmentType) {
    const { id, ...update } = equipmentType;
    return client.from("equipmentType").update(sanitize(update)).eq("id", id);
  }
  return client
    .from("equipmentType")
    .insert([equipmentType])
    .select("id")
    .single();
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
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in process) {
    return client
      .from("process")
      .update(sanitize(process))
      .eq("id", process.id);
  }
  return client.from("process").insert([process]).select("*").single();
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
      .eq("id", partner.id)
      .eq("abilityId", partner.abilityId);
  } else {
    return await client.from("partner").insert([partner]);
  }
}

export async function upsertWorkCell(
  client: SupabaseClient<Database>,
  workCell:
    | (Omit<z.infer<typeof workCellValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof workCellValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in workCell) {
    return client.from("workCell").insert([workCell]).select("*").single();
  }
  return client
    .from("workCell")
    .update(sanitize(workCell))
    .eq("id", workCell.id);
}

export async function upsertWorkCellType(
  client: SupabaseClient<Database>,
  workCellType:
    | (Omit<z.infer<typeof workCellTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof workCellTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in workCellType) {
    return client
      .from("workCellType")
      .insert([workCellType])
      .select("id")
      .single();
  }
  return client
    .from("workCellType")
    .update(sanitize(workCellType))
    .eq("id", workCellType.id);
}
