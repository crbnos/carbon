import type { Database } from "@carbon/database";
import { fetchAllFromTable } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthContextHolder, getAuthClient, mcpTool } from "~/services/mcp";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { capitalize } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import type { CompanyPermission } from "./types";
export const deleteEmployeeType = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteEmployeeType(employeeTypeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeType")
      .delete()
      .eq("id", employeeTypeId)
      .eq("protected", false);
  }
);

export const deleteGroup = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteGroup(groupId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("group").delete().eq("id", groupId);
  }
);

export const getCompaniesForUser = mcpTool(
  {
    classification: "READ"
  },
  async function getCompaniesForUser() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
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
);

export const getCustomers = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomers(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
      { column: "user(lastName)", ascending: true }
    ]);
    return query;
  }
);

export const getEmployee = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployee(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("employees")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .single();
  }
);

export async function getUnrevokedInviteEmails() {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client
    .from("invite")
    .select("email")
    .eq("companyId", companyId)
    .is("revokedAt", null);
}

export const getEmployees = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployees(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("employees")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    // Default to active employees when the user hasn't explicitly filtered on
    // active status. The Active/Inactive dropdown still works because picking
    // a value puts an `active:eq:...` filter in the URL, which overrides this.
    const hasActiveFilter = args.filters?.some((f) => f.column === "active");
    if (!hasActiveFilter) {
      query = query.eq("active", true);
    }

    query = setGenericQueryFilters(query, args, [
      { column: "lastName", ascending: true }
    ]);
    return query;
  }
);

/**
 * Gets console operators — users with @console.internal emails.
 * Uses the employees view (which joins user + employee) and filters
 * by the synthetic email pattern since there's no FK from employee to user
 * for PostgREST to use directly.
 *
 * TODO: After running db:generate, replace email pattern filter with
 * .eq("isConsoleOperator", true) once the column is in the employees view.
 */
export const getConsoleOperators = mcpTool(
  {
    classification: "READ"
  },
  async function getConsoleOperators(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("employees")
      .select("*", { count: "exact" })
      .eq("companyId", companyId)
      .like("email", "%@console.internal");

    if (args.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    query = setGenericQueryFilters(query, args, [
      { column: "lastName", ascending: true }
    ]);
    return query;
  }
);

export const getEmployeeType = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployeeType(employeeTypeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeType")
      .select("*")
      .eq("id", employeeTypeId)
      .single();
  }
);

export const getEmployeeTypes = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployeeTypes(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("employeeType")
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

export const getInvitable = mcpTool(
  {
    classification: "READ"
  },
  async function getInvitable() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("employeesAcrossCompanies")
      .select("*")
      .eq("active", true)
      .not("companyId", "cs", `{"${companyId}"}`)
      .order("lastName");
  }
);

export const getModules = mcpTool(
  {
    classification: "READ"
  },
  async function getModules() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("modules").select("name").order("name");
  }
);

export const getGroup = mcpTool(
  {
    classification: "READ"
  },
  async function getGroup(groupId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("group").select("id, name").eq("id", groupId).single();
  }
);

export const getGroupMembers = mcpTool(
  {
    classification: "READ"
  },
  async function getGroupMembers(groupId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("groupMembers")
      .select("name, groupId, memberGroupId, memberUserId")
      .eq("groupId", groupId);
  }
);

export const getGroups = mcpTool(
  {
    classification: "READ"
  },
  async function getGroups(
    args?: GenericQueryFilters & {
      search: string | null;
      uid: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .rpc("groups_query", {
        _uid: args?.uid ?? "",
        _name: args?.search ?? ""
      })
      .eq("companyId", companyId);

    if (args) query = setGenericQueryFilters(query, args);

    return query;
  }
);

export const getGroupEmails = mcpTool(
  {
    classification: "READ"
  },
  async function getGroupEmails(groupIds: string[]): Promise<string[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
    if (!groupIds || groupIds.length === 0) return [];

    const userIdsResult = (await client.rpc("users_for_groups", {
      groups: groupIds
    })) as { data: string[]; error: unknown };

    if (userIdsResult.error || !Array.isArray(userIdsResult.data)) return [];

    return getUserEmails(userIdsResult.data);
  }
);

export const getPermissionsByEmployeeType = mcpTool(
  {
    classification: "READ"
  },
  async function getPermissionsByEmployeeType(employeeTypeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeTypePermission")
      .select("view, create, update, delete, module")
      .eq("employeeTypeId", employeeTypeId);
  }
);

export const getSuppliers = mcpTool(
  {
    classification: "READ"
  },
  async function getSuppliers(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
      { column: "user(lastName)", ascending: true }
    ]);
    return query;
  }
);

export const getUsers = mcpTool(
  {
    classification: "READ"
  },
  async function getUsers() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return fetchAllFromTable<{
      id: string;
      firstName: string;
      lastName: string;
      fullName: string;
      email: string;
      avatarUrl: string | null;
    }>(
      client,
      "user",
      "id, firstName, lastName, fullName, email, avatarUrl",
      (query) => query.eq("active", true).order("lastName")
    );
  }
);

export const getUserEmails = mcpTool(
  {
    classification: "READ"
  },
  async function getUserEmails(userIds: string[]): Promise<string[]> {
    const client = getAuthClient<SupabaseClient<Database>>();
    if (!userIds || userIds.length === 0) return [];

    const result = await client
      .from("user")
      .select("email")
      .in("id", userIds)
      .eq("active", true);

    if (result.error || !result.data) return [];

    return result.data
      .map((u) => u.email)
      .filter((email): email is string => !!email);
  }
);

export const insertEmployeeType = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertEmployeeType(employeeType: { name: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeType")
      .insert([employeeType])
      .select("id")
      .single();
  }
);

export const insertGroup = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertGroup(group: { name: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("group").insert(group).select("*").single();
  }
);

export const upsertEmployeeType = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertEmployeeType(
    employeeType:
      | { name: string; companyId: string }
      | { id: string; name: string }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const upsertEmployeeTypePermissions = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertEmployeeTypePermissions(
    employeeTypeId: string,
    permissions: { name: string; permission: CompanyPermission }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const employeeTypePermissions = permissions.map(({ name, permission }) => ({
      employeeTypeId,
      module: capitalize(name) as "Accounting",
      view: permission.view ? [companyId] : [],
      create: permission.create ? [companyId] : [],
      update: permission.update ? [companyId] : [],
      delete: permission.delete ? [companyId] : []
    }));

    return client
      .from("employeeTypePermission")
      .upsert(employeeTypePermissions);
  }
);

export const upsertGroup = mcpTool(
  {
    classification: "WRITE",
    argOrder: ["args"]
  },
  async function upsertGroup({ id, name }: { id: string; name: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("group").upsert([{ id, name, companyId }]);
  }
);

export const upsertGroupMembers = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertGroupMembers(groupId: string, selections: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
        memberGroupId: id.slice(6)
      }));

    const memberUsers = selections
      .filter((id) => id.startsWith("user_"))
      .map((id) => ({
        groupId,
        memberUserId: id.slice(5)
      }));

    return client.from("membership").insert([...memberGroups, ...memberUsers]);
  }
);
