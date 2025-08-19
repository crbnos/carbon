import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { capitalize } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import type { CompanyPermission } from "./types";

export async function deleteEmployeeType(
  client: SupabaseClient<Database>,
  employeeTypeId: string
) {
  return client.from("employeeType").delete().eq("id", employeeTypeId);
}

export async function deleteGroup(
  client: SupabaseClient<Database>,
  groupId: string
) {
  return client.from("group").delete().eq("id", groupId);
}

export async function getCompaniesForUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  const { data, error } = await client
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);

  if (error) {
    console.log(`Failed to get companies for user ${userId}`, error);
    return [];
  }

  return data?.map((row) => row.companyId) ?? [];
}

export async function getCustomers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  // TODO: this breaks on customerType filters -- convert to view
  let query = client
    .from("customerAccount")
    .select(
      `active, user!inner(id, fullName, firstName, lastName, email, avatarUrl), 
      customer!inner(name, customerType!left(name))`,
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("user.fullName", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "user(lastName)", ascending: true },
  ]);
  return query;
}

export async function getEmployee(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("employees")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function getEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("employees")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "lastName", ascending: true },
  ]);
  return query;
}

export async function getEmployeeType(
  client: SupabaseClient<Database>,
  employeeTypeId: string
) {
  return client
    .from("employeeType")
    .select("*")
    .eq("id", employeeTypeId)
    .single();
}

export async function getEmployeeTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("employeeType")
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

export async function getInvitable(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("employeesAcrossCompanies")
    .select("*")
    .eq("active", true)
    .not("companyId", "cs", `{"${companyId}"}`)
    .order("lastName");
}

export async function getModules(client: SupabaseClient<Database>) {
  return client.from("modules").select("name").order("name");
}

export async function getGroup(
  client: SupabaseClient<Database>,
  groupId: string
) {
  return client.from("group").select("id, name").eq("id", groupId).single();
}

export async function getGroupMembers(
  client: SupabaseClient<Database>,
  groupId: string
) {
  return client
    .from("groupMembers")
    .select("name, groupId, memberGroupId, memberUserId")
    .eq("groupId", groupId);
}

export async function getGroups(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    uid: string | null;
  }
) {
  let query = client
    .rpc("groups_query", {
      _uid: args?.uid ?? "",
      _name: args?.search ?? "",
    })
    .eq("companyId", companyId);

  if (args) query = setGenericQueryFilters(query, args);

  return query;
}

export async function getPermissionsByEmployeeType(
  client: SupabaseClient<Database>,
  employeeTypeId: string
) {
  return client
    .from("employeeTypePermission")
    .select("view, create, update, delete, module")
    .eq("employeeTypeId", employeeTypeId);
}

export async function getSuppliers(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  // TODO: this breaks on supplierType filters -- convert to view
  let query = client
    .from("supplierAccount")
    .select(
      `active, user!inner(id, fullName, firstName, lastName, email, avatarUrl), 
      supplier!inner(name, supplierType!left(name))`,
      { count: "exact" }
    )
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("user.fullName", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "user(lastName)", ascending: true },
  ]);
  return query;
}

export async function getUsers(client: SupabaseClient<Database>) {
  return fetchAllFromTable(
    client,
    "user",
    "id, firstName, lastName, fullName, email, avatarUrl",
    (query) => query.eq("active", true).order("lastName")
  );
}

export async function insertEmployeeType(
  client: SupabaseClient<Database>,
  employeeType: { name: string; companyId: string }
) {
  return client
    .from("employeeType")
    .insert([employeeType])
    .select("id")
    .single();
}

export async function insertGroup(
  client: SupabaseClient<Database>,
  group: { name: string; companyId: string }
) {
  return client.from("group").insert(group).select("*").single();
}

export async function upsertEmployeeType(
  client: SupabaseClient<Database>,
  employeeType:
    | { name: string; companyId: string }
    | { id: string; name: string }
) {
  if ("id" in employeeType) {
    return client
      .from("employeeType")
      .update(sanitize(employeeType))
      .eq("id", employeeType.id)
      .select("id")
      .single();
  }
  return client
    .from("employeeType")
    .insert([employeeType])
    .select("id")
    .single();
}

export async function upsertEmployeeTypePermissions(
  client: SupabaseClient<Database>,
  employeeTypeId: string,
  companyId: string,
  permissions: { name: string; permission: CompanyPermission }[]
) {
  const employeeTypePermissions = permissions.map(({ name, permission }) => ({
    employeeTypeId,
    module: capitalize(name) as "Accounting",
    view: permission.view ? [companyId] : [],
    create: permission.create ? [companyId] : [],
    update: permission.update ? [companyId] : [],
    delete: permission.delete ? [companyId] : [],
  }));

  return client.from("employeeTypePermission").upsert(employeeTypePermissions);
}

export async function upsertGroup(
  client: SupabaseClient<Database>,
  {
    id,
    name,
    companyId,
  }: {
    id: string;
    name: string;
    companyId: string;
  }
) {
  return client.from("group").upsert([{ id, name, companyId }]);
}

export async function upsertGroupMembers(
  client: SupabaseClient<Database>,
  groupId: string,
  selections: string[]
) {
  const deleteExisting = await client
    .from("membership")
    .delete()
    .eq("groupId", groupId);

  if (deleteExisting.error) return deleteExisting;

  // separate each id according to whether it is a group or a user
  const memberGroups = selections
    .filter((id) => id.startsWith("group_"))
    .map((id) => ({
      groupId,
      memberGroupId: id.slice(6),
    }));

  const memberUsers = selections
    .filter((id) => id.startsWith("user_"))
    .map((id) => ({
      groupId,
      memberUserId: id.slice(5),
    }));

  return client.from("membership").insert([...memberGroups, ...memberUsers]);
}
