import type { Result } from "@carbon/auth";
import { error, getClaims, getPermissionCacheKey, success } from "@carbon/auth";
import { logPermissionChange } from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Enterprise) RBAC authoring — the single, licensed source of truth
 * for creating/editing employee types, editing an individual user's permissions,
 * and building the flattened `userPermission.permissions` object. Gated to the
 * Business plan via the `PERMISSIONS` feature (`@carbon/ee/plan`); Community ships
 * an "everyone is an admin" experience so none of this is reachable there.
 *
 * Consumed on the server by the ERP authoring routes AND by the `@carbon/jobs`
 * bulk-edit task (`carbon/update-permissions`), which previously carried its own
 * drifting copy of `updatePermissions` — this is now the only copy.
 *
 * The low-level community primitives (`setUserPermissions`,
 * `makePermissionsFromEmployeeType`) stay in the ERP `users.server.ts`: they are
 * shared plumbing the invite flow depends on, not authoring.
 */

export type CompanyPermission = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type Permission = {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
};

type ModuleName = { name: string | null };

type EmployeeTypePermissionRow = {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
  module: string | null;
};

// Uppercase the first letter only (mirrors the ERP `~/utils/string` capitalize),
// which `@carbon/ee` cannot import.
function capitalize(words: string) {
  const [first, ...otherLetters] = words;
  return [first?.toLocaleUpperCase() ?? "", ...otherLetters].join("");
}

function isClaimPermission(key: string, value: unknown) {
  const action = key.split("_")[1];
  return (
    action !== undefined &&
    ["view", "create", "update", "delete"].includes(action) &&
    Array.isArray(value)
  );
}

// ---------------------------------------------------------------------------
// Employee-type CRUD
// ---------------------------------------------------------------------------

export async function deleteEmployeeType(
  client: SupabaseClient<Database>,
  employeeTypeId: string,
  companyId: string
) {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  return client
    .from("employeeType")
    .delete()
    .eq("id", employeeTypeId)
    .eq("companyId", companyId)
    .eq("protected", false);
}

export async function insertEmployeeType(
  client: SupabaseClient<Database>,
  employeeType: { name: string; companyId: string }
) {
  await requireEntitlement(client, employeeType.companyId, "PERMISSIONS");
  return client
    .from("employeeType")
    .insert([employeeType])
    .select("id")
    .single();
}

export async function upsertEmployeeType(
  client: SupabaseClient<Database>,
  employeeType:
    | { name: string; companyId: string }
    | { id: string; name: string }
) {
  if ("id" in employeeType) {
    // The update input carries no companyId — read it from the row so the
    // entitlement check (the lock) can run before the write.
    const existing = await client
      .from("employeeType")
      .select("companyId")
      .eq("id", employeeType.id)
      .single();

    if (existing.error || !existing.data) {
      return {
        data: null,
        error: existing.error || { message: "Employee type not found" }
      };
    }

    await requireEntitlement(client, existing.data.companyId, "PERMISSIONS");

    return client
      .from("employeeType")
      .update(employeeType)
      .eq("id", employeeType.id)
      .eq("companyId", existing.data.companyId)
      .select("id")
      .single();
  }

  await requireEntitlement(client, employeeType.companyId, "PERMISSIONS");
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
  await requireEntitlement(client, companyId, "PERMISSIONS");
  const employeeTypePermissions = permissions.map(({ name, permission }) => ({
    employeeTypeId,
    module: capitalize(name) as "Accounting",
    view: permission.view ? [companyId] : [],
    create: permission.create ? [companyId] : [],
    update: permission.update ? [companyId] : [],
    delete: permission.delete ? [companyId] : []
  }));

  return client.from("employeeTypePermission").upsert(employeeTypePermissions);
}

// ---------------------------------------------------------------------------
// Permission-object translators (claims / employee-type / UI grid shapes)
// ---------------------------------------------------------------------------

export function makeEmptyPermissionsFromModules(data: ModuleName[]) {
  return data.reduce<
    Record<string, { name: string; permission: CompanyPermission }>
  >((acc, m) => {
    if (m.name && m.name !== "Messaging") {
      acc[m.name] = {
        name: m.name.toLowerCase(),
        permission: {
          view: false,
          create: false,
          update: false,
          delete: false
        }
      };
    }
    return acc;
  }, {});
}

export function makeCompanyPermissionsFromClaims(
  claims: Json[] | null,
  companyId: string
) {
  if (typeof claims !== "object" || claims === null) return null;
  const permissions: Record<string, CompanyPermission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    // `isClaimPermission` guarantees `value` is a string[] and `key` has an
    // action segment, so `module` is present and the array branch is the only one.
    if (!isClaimPermission(key, value) || !Array.isArray(value)) return;
    const [module, action] = key.split("_");
    if (module === undefined) return;

    const perm = permissions[module] ?? {
      view: false,
      create: false,
      update: false,
      delete: false
    };

    if (action === "view") perm.view = value.includes(companyId);
    else if (action === "create") perm.create = value.includes(companyId);
    else if (action === "update") perm.update = value.includes(companyId);
    else if (action === "delete") perm.delete = value.includes(companyId);

    permissions[module] = perm;
  });

  if ("role" in claims) {
    role = claims.role as string;
  }

  if ("items" in permissions) {
    delete permissions.items;
  }

  if ("messaging" in permissions) {
    delete permissions.messaging;
  }

  return { permissions, role };
}

export function makeCompanyPermissionsFromEmployeeType(
  data: EmployeeTypePermissionRow[],
  companyId: string
) {
  const result: Record<
    string,
    { name: string; permission: CompanyPermission }
  > = {};
  if (!data) return result;
  data.forEach((permission) => {
    if (!permission.module) {
      throw new Error(
        `Module is missing for permission ${JSON.stringify(permission)}`
      );
    } else {
      result[permission.module] = {
        name: permission.module.toLowerCase(),
        permission: {
          view: permission.view.includes(companyId),
          create: permission.create.includes(companyId),
          update: permission.update.includes(companyId),
          delete: permission.delete.includes(companyId)
        }
      };
    }
  });

  if ("items" in result) {
    delete result.items;
  }

  if ("Messaging" in result) {
    delete result.Messaging;
  }

  return result;
}

// ---------------------------------------------------------------------------
// The write path — builds and persists the flattened permission object
// ---------------------------------------------------------------------------

export async function updateEmployee(
  client: SupabaseClient<Database>,
  {
    id,
    employeeType,
    permissions,
    companyId,
    actorId,
    ip
  }: {
    id: string;
    employeeType: string;
    permissions: Record<string, CompanyPermission>;
    companyId: string;
    actorId?: string;
    ip?: string;
  }
): Promise<Result> {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  const updateEmployeeEmployeeType = await client
    .from("employee")
    .upsert([{ id, companyId, employeeTypeId: employeeType }]);

  if (updateEmployeeEmployeeType.error)
    return error(updateEmployeeEmployeeType.error, "Failed to update employee");

  return updatePermissions(client, {
    id,
    permissions,
    companyId,
    actorId,
    ip
  });
}

export async function updatePermissions(
  client: SupabaseClient<Database>,
  {
    id,
    permissions,
    companyId,
    addOnly = false,
    actorId,
    ip
  }: {
    id: string;
    permissions: Record<string, CompanyPermission>;
    companyId: string;
    addOnly?: boolean;
    actorId?: string;
    ip?: string;
  }
): Promise<Result> {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  const claimsAdmin = await client.rpc("is_claims_admin", {
    company: companyId
  });
  if (claimsAdmin.error)
    return error(claimsAdmin.error, "Failed to check claims admin");
  if (claimsAdmin.data === true) {
    const claims = await getClaims(client, id);

    if (claims.error) return error(claims.error, "Failed to get claims");

    const updatedPermissions = (
      typeof claims.data !== "object" ||
      Array.isArray(claims.data) ||
      claims.data === null
        ? {}
        : claims.data
    ) as Record<string, string[]>;
    delete updatedPermissions.role;

    // Snapshot the effective grant set BEFORE the in-place mutation below, so
    // the audit event carries an honest before/after diff (NIST 3.3.1/3.3.2).
    const beforePermissions = structuredClone(updatedPermissions);

    // add any missing claims to the current claims
    Object.keys(permissions).forEach((name) => {
      const module = name.toLowerCase();
      if (!(`${module}_view` in updatedPermissions)) {
        updatedPermissions[`${module}_view`] = [];
      }
      if (!(`${module}_create` in updatedPermissions)) {
        updatedPermissions[`${module}_create`] = [];
      }
      if (!(`${module}_update` in updatedPermissions)) {
        updatedPermissions[`${module}_update`] = [];
      }
      if (!(`${module}_delete` in updatedPermissions)) {
        updatedPermissions[`${module}_delete`] = [];
      }
    });

    if (addOnly) {
      Object.entries(permissions).forEach(([name, permission]) => {
        const module = name.toLowerCase();
        if (
          permission.view &&
          !updatedPermissions[`${module}_view`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_view`]!.push(companyId);
        }
        if (
          permission.create &&
          !updatedPermissions[`${module}_create`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_create`]!.push(companyId);
        }
        if (
          permission.update &&
          !updatedPermissions[`${module}_update`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_update`]!.push(companyId);
        }
        if (
          permission.delete &&
          !updatedPermissions[`${module}_delete`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_delete`]!.push(companyId);
        }
      });
    } else {
      Object.entries(permissions).forEach(([name, permission]) => {
        const module = name.toLowerCase();
        if (permission.view) {
          if (!updatedPermissions[`${module}_view`]?.includes(companyId)) {
            updatedPermissions[`${module}_view`] = [
              ...(updatedPermissions[`${module}_view`] ?? []),
              companyId
            ];
          }
        } else {
          updatedPermissions[`${module}_view`] = (
            updatedPermissions[`${module}_view`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.create) {
          if (!updatedPermissions[`${module}_create`]?.includes(companyId)) {
            updatedPermissions[`${module}_create`] = [
              ...(updatedPermissions[`${module}_create`] ?? []),
              companyId
            ];
          }
        } else {
          updatedPermissions[`${module}_create`] = (
            updatedPermissions[`${module}_create`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.update) {
          if (!updatedPermissions[`${module}_update`]?.includes(companyId)) {
            updatedPermissions[`${module}_update`] = [
              ...(updatedPermissions[`${module}_update`] ?? []),
              companyId
            ];
          }
        } else {
          updatedPermissions[`${module}_update`] = (
            updatedPermissions[`${module}_update`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.delete) {
          if (!updatedPermissions[`${module}_delete`]?.includes(companyId)) {
            updatedPermissions[`${module}_delete`] = [
              ...(updatedPermissions[`${module}_delete`] ?? []),
              companyId
            ];
          }
        } else {
          updatedPermissions[`${module}_delete`] = (
            updatedPermissions[`${module}_delete`] as string[]
          ).filter((c: string) => c !== companyId);
        }
      });
    }

    // The "0" global-company wildcard is retired (NIST 800-171 3.1.5). Strip it
    // from every array so it can never be persisted to the authoritative table.
    for (const key of Object.keys(updatedPermissions)) {
      const value = updatedPermissions[key];
      if (Array.isArray(value)) {
        updatedPermissions[key] = value.filter((c: string) => c !== "0");
      }
    }

    const permissionsUpdate = await getCarbonServiceRole()
      .from("userPermission")
      .update({ permissions: updatedPermissions })
      .eq("id", id);
    if (permissionsUpdate.error)
      return error(permissionsUpdate.error, "Failed to update claims");

    await redis.del(getPermissionCacheKey(id));

    // Audit the change (NIST 800-171 3.3.1/3.3.2): actor, target, before/after.
    logPermissionChange({
      actor: actorId,
      targetUserId: id,
      companyId,
      ip,
      before: beforePermissions,
      after: updatedPermissions,
      reason: addOnly ? "bulk-add" : "bulk-edit"
    });

    return success("Permissions updated");
  }

  return error(null, "You do not have permission to update permissions");
}
