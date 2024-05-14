import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { DataType } from "~/modules/shared";
import type { Employee } from "~/modules/users";
import { getEmployees } from "~/modules/users";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  departmentValidator,
  employeeJobValidator,
  equipmentTypeValidator,
  equipmentValidator,
  holidayValidator,
  locationValidator,
  partnerValidator,
  shiftValidator,
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

export async function deleteAttribute(
  client: SupabaseClient<Database>,
  attributeId: string
) {
  return client
    .from("userAttribute")
    .update({ active: false })
    .eq("id", attributeId);
}

export async function deleteAttributeCategory(
  client: SupabaseClient<Database>,
  attributeCategoryId: string
) {
  return client
    .from("userAttributeCategory")
    .update({ active: false })
    .eq("id", attributeCategoryId);
}

export async function deleteContractor(
  client: SupabaseClient<Database>,
  contractorId: string
) {
  return client.from("contractor").delete().eq("id", contractorId);
}

export async function deleteDepartment(
  client: SupabaseClient<Database>,
  departmentId: string
) {
  return client.from("department").delete().eq("id", departmentId);
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

export async function deleteHoliday(
  client: SupabaseClient<Database>,
  holidayId: string
) {
  return client.from("holiday").delete().eq("id", holidayId);
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

export async function getAttribute(
  client: SupabaseClient<Database>,
  attributeId: string
) {
  return client
    .from("userAttribute")
    .select("*, userAttributeCategory(name)")
    .eq("id", attributeId)
    .eq("active", true)
    .single();
}

async function getAttributes(
  client: SupabaseClient<Database>,
  companyId: string,
  userIds: string[]
) {
  return client
    .from("userAttributeCategory")
    .select(
      `*,
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser),
        userAttributeValue(
          id, userId, valueBoolean, valueDate, valueNumeric, valueText, valueUser, user!userAttributeValue_userId_fkey(id, fullName, avatarUrl)
        )
      )`
    )
    .eq("companyId", companyId)
    .eq("userAttribute.active", true)
    .in("userAttribute.userAttributeValue.userId", [userIds])
    .order("sortOrder", { foreignTable: "userAttribute", ascending: true });
}

export async function getAttributeCategories(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: { search: string | null } & GenericQueryFilters
) {
  let query = client
    .from("userAttributeCategory")
    .select("*, userAttribute(id, name, attributeDataType(id))", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true)
    .eq("userAttribute.active", true);

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

export async function getAttributeCategory(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("userAttributeCategory")
    .select(
      `*, 
      userAttribute(
        id, name, sortOrder, 
        attributeDataType(id, label,  isBoolean, isDate, isList, isNumeric, isText, isUser ))
      `,
      {
        count: "exact",
      }
    )
    .eq("id", id)
    .eq("active", true)
    .eq("userAttribute.active", true)
    .single();
}

export async function getAttributeDataTypes(client: SupabaseClient<Database>) {
  return client.from("attributeDataType").select("*");
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

export async function getDepartment(
  client: SupabaseClient<Database>,
  departmentId: string
) {
  return client.from("department").select("*").eq("id", departmentId).single();
}

export async function getDepartments(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("department")
    .select(`*, department(id, name)`, {
      count: "exact",
    })
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

export async function getDepartmentsList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("department")
    .select(`id, name`)
    .eq("companyId", companyId)
    .order("name");
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

export async function getEmployeeJob(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("employeeJob")
    .select("*")
    .eq("id", employeeId)
    .eq("companyId", companyId)
    .single();
}

export async function getEmployeeSummary(
  client: SupabaseClient<Database>,
  employeeId: string,
  companyId: string
) {
  return client
    .from("employeeSummary")
    .select("*")
    .eq("id", employeeId)
    .eq("companyId", companyId)
    .single();
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
    .select("*, equipment(id, name, location(id, name))")
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
    .select("*, equipment(id, name)", {
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

export async function getHoliday(
  client: SupabaseClient<Database>,
  holidayId: string
) {
  return client.from("holiday").select("*").eq("id", holidayId).single();
}

export async function getHolidays(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("holiday")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "date", ascending: true },
    ]);
  }

  return query;
}

export function getHolidayYears(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("holidayYears").select("year").eq("companyId", companyId);
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

type UserAttributeId = string;

export type PersonAttributeValue = {
  userAttributeValueId: string;
  value: boolean | string | number;
  dataType?: DataType;
  user?: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
};

type PersonAttributes = Record<UserAttributeId, PersonAttributeValue>;

type Person = Employee & {
  attributes: PersonAttributes;
};

export async function getPeople(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  const employees = await getEmployees(client, companyId, args);
  if (employees.error) return employees;

  if (!employees.data) throw new Error("Failed to get employee data");

  const userIds = employees.data.reduce<string[]>((acc, employee) => {
    if (employee.id) acc.push(employee.id);
    return acc;
  }, []);

  const attributeCategories = await getAttributes(client, companyId, userIds);
  if (attributeCategories.error) return attributeCategories;

  const people: Person[] = employees.data.map((employee) => {
    const userId = employee.id;

    const employeeAttributes =
      attributeCategories.data.reduce<PersonAttributes>((acc, category) => {
        if (!category.userAttribute || !Array.isArray(category.userAttribute))
          return acc;
        category.userAttribute.forEach(
          // @ts-ignore
          (attribute) => {
            if (
              attribute.userAttributeValue &&
              Array.isArray(attribute.userAttributeValue) &&
              !Array.isArray(attribute.attributeDataType)
            ) {
              const userAttributeId = attribute.id;
              const userAttributeValue = attribute.userAttributeValue.find(
                // @ts-ignore
                (attributeValue) => attributeValue.userId === userId
              );
              const value =
                typeof userAttributeValue?.valueBoolean === "boolean"
                  ? userAttributeValue.valueBoolean
                  : userAttributeValue?.valueDate ||
                    userAttributeValue?.valueNumeric ||
                    userAttributeValue?.valueText ||
                    userAttributeValue?.valueUser;

              if (value && userAttributeValue?.id) {
                acc[userAttributeId] = {
                  userAttributeValueId: userAttributeValue.id,
                  // @ts-ignore
                  dataType: attribute.attributeDataType?.id as DataType,
                  value,
                  user: !Array.isArray(userAttributeValue.user)
                    ? userAttributeValue.user
                    : undefined,
                };
              }
            }
          }
        );
        return acc;
      }, {});

    return {
      ...employee,
      attributes: employeeAttributes,
    };
  });

  return {
    count: employees.count,
    data: people,
    error: null,
  };
}

export async function getShift(
  client: SupabaseClient<Database>,
  shiftId: string
) {
  return client
    .from("shifts")
    .select("*")
    .eq("id", shiftId)
    .eq("active", true)
    .single();
}

export async function getShifts(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("shifts")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", true);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "locationId", ascending: true },
  ]);
  return query;
}

export async function getShiftsList(
  client: SupabaseClient<Database>,
  locationId: string | null
) {
  let query = client.from("shift").select(`id, name`).eq("active", true);

  if (locationId) {
    query = query.eq("locationId", locationId);
  }

  return query.order("name");
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

export async function insertAttribute(
  client: SupabaseClient<Database>,
  attribute: {
    name: string;
    attributeDataTypeId: number;
    userAttributeCategoryId: string;
    listOptions?: string[];
    canSelfManage: boolean;
    createdBy: string;
  }
) {
  // TODO: there's got to be a better way to get the max
  const sortOrders = await client
    .from("userAttribute")
    .select("sortOrder")
    .eq("userAttributeCategoryId", attribute.userAttributeCategoryId);

  if (sortOrders.error) return sortOrders;
  const maxSortOrder = sortOrders.data.reduce((max, item) => {
    return Math.max(max, item.sortOrder);
  }, 0);

  return client
    .from("userAttribute")
    .upsert([{ ...attribute, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function insertAttributeCategory(
  client: SupabaseClient<Database>,
  attributeCategory: {
    name: string;
    public: boolean;
    createdBy: string;
  }
) {
  return client
    .from("userAttributeCategory")
    .upsert([attributeCategory])
    .select("id")
    .single();
}

export async function insertEmployeeJob(
  client: SupabaseClient<Database>,
  job: {
    id: string;
    companyId: string;
    locationId?: string;
  }
) {
  return client.from("employeeJob").insert(job).select("*").single();
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

export async function updateAttribute(
  client: SupabaseClient<Database>,
  attribute: {
    id?: string;
    name: string;
    listOptions?: string[];
    canSelfManage: boolean;
    updatedBy: string;
  }
) {
  if (!attribute.id) throw new Error("id is required");
  return client
    .from("userAttribute")
    .update(
      sanitize({
        name: attribute.name,
        listOptions: attribute.listOptions,
        canSelfManage: attribute.canSelfManage,
        updatedBy: attribute.updatedBy,
      })
    )
    .eq("id", attribute.id);
}

export async function updateAttributeCategory(
  client: SupabaseClient<Database>,
  attributeCategory: {
    id: string;
    name: string;
    public: boolean;
    updatedBy: string;
  }
) {
  const { id, ...update } = attributeCategory;
  return client
    .from("userAttributeCategory")
    .update(sanitize(update))
    .eq("id", id);
}

export async function updateAttributeSortOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("userAttribute").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}

export async function updateEmployeeJob(
  client: SupabaseClient<Database>,
  employeeId: string,
  employeeJob: z.infer<typeof employeeJobValidator> & {
    companyId: string;
    updatedBy: string;
    customFields?: Json;
  }
) {
  return client
    .from("employeeJob")
    .update(sanitize(employeeJob))
    .eq("id", employeeId)
    .eq("companyId", employeeJob.companyId);
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

export async function upsertDepartment(
  client: SupabaseClient<Database>,
  department:
    | (Omit<z.infer<typeof departmentValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof departmentValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in department) {
    return client
      .from("department")
      .update(sanitize(department))
      .eq("id", department.id);
  }
  return client.from("department").insert(department).select("*").single();
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

export async function upsertHoliday(
  client: SupabaseClient<Database>,
  holiday:
    | (Omit<z.infer<typeof holidayValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof holidayValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in holiday) {
    return client.from("holiday").insert(holiday).select("*").single();
  }
  return client.from("holiday").update(sanitize(holiday)).eq("id", holiday.id);
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

export async function upsertShift(
  client: SupabaseClient<Database>,
  shift:
    | (Omit<z.infer<typeof shiftValidator>, "id"> & {
        createdBy: string;
        companyId: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof shiftValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in shift) {
    return client.from("shift").insert([shift]).select("*").single();
  }
  return client.from("shift").update(sanitize(shift)).eq("id", shift.id);
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
