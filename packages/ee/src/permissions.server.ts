// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Result } from "@carbon/auth";
import { error, getClaims, getPermissionCacheKey, success } from "@carbon/auth";
import {
  logPermissionChange,
  logRoleAccessChange
} from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { Constants, type Database } from "@carbon/database";
import {
  claimKeys,
  claimsFromJson,
  expandClaims,
  LEVELS,
  type Level
} from "@carbon/database/access";
import {
  type GrantInput,
  type GrantModule,
  readGrants,
  replaceGrants
} from "@carbon/database/access-write";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Enterprise) RBAC authoring — the single, licensed source of truth
 * for creating/editing employee types and editing an individual user's
 * permissions. Every write is a `permission` grant (`replaceAccessGrants`). Gated to the
 * Business plan via the `PERMISSIONS` feature (`@carbon/ee/plan`); Community ships
 * an "everyone is an admin" experience so none of this is reachable there.
 *
 * Consumed on the server by the ERP authoring routes AND by the `@carbon/jobs`
 * bulk-edit task (`carbon/update-permissions`), which previously carried its own
 * drifting copy of `updatePermissions` — this is now the only copy.
 *
 * The invite flow's permission merge stays in the ERP `users.service.ts`: only
 * portal invites carry permissions through it, and it is not authoring.
 */

// Uppercase the first letter only (mirrors the ERP `~/utils/string` capitalize),
// which `@carbon/ee` cannot import.
function capitalize(words: string) {
  const [first, ...otherLetters] = words;
  return [first?.toLocaleUpperCase() ?? "", ...otherLetters].join("");
}

const MODULES = new Set<string>(Constants.public.Enums.module);

/** A form's module name ("parts", "Parts") as the `module` enum value. */
function toModule(name: string): GrantModule | null {
  const module = capitalize(name.toLowerCase());
  return MODULES.has(module) ? (module as GrantModule) : null;
}

const higher = (a: Level, b: Level) =>
  LEVELS.indexOf(a) >= LEVELS.indexOf(b) ? a : b;

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

// ---------------------------------------------------------------------------
// The write path — builds and persists the flattened permission object
// ---------------------------------------------------------------------------

// The target user id comes from the caller's form (and the bulk path runs as
// the service role), so prove it is an employee of the company whose
// permissions are being written before touching the user's grants. Read via
// the service role: the membership fact must not depend on the caller's RLS.
async function isCompanyEmployee(
  userId: string,
  companyId: string
): Promise<boolean> {
  const employee = await getCarbonServiceRole()
    .from("employee")
    .select("id")
    .eq("id", userId)
    .eq("companyId", companyId)
    .maybeSingle();
  return !employee.error && !!employee.data;
}

/** The user's claims in the company, as flat keys for the audit log. */
async function auditedClaims(userId: string, companyId: string) {
  const claims = await getClaims(getCarbonServiceRole(), userId, companyId);
  if (claims.error || claims.data === null) return null;
  return claimKeys(expandClaims(claimsFromJson(claims.data), companyId));
}

/** What a save changes: one entry per module or page whose grant moves. */
function grantChanges(
  before: { module: string; page: string | null; level: string }[],
  after: readonly GrantInput[]
) {
  const key = (g: { module: string; page: string | null }) =>
    `${g.module}\u0000${g.page ?? ""}`;
  const from = new Map(before.map((g) => [key(g), g.level]));
  const to = new Map(
    after.filter((g) => g.level !== null).map((g) => [key(g), g.level])
  );
  const changes: {
    module: string;
    page: string | null;
    from: string;
    to: string;
  }[] = [];
  for (const k of new Set([...from.keys(), ...to.keys()])) {
    const a = from.get(k) ?? "inherit";
    const b = to.get(k) ?? "inherit";
    if (a === b) continue;
    const [module, page] = k.split("\u0000") as [string, string];
    changes.push({ module, page: page || null, from: a, to: b });
  }
  return changes;
}

/**
 * Replace every grant of a role or a person in the company, in one
 * transaction. Clears the cached claims of everyone the change reaches (the
 * person, or every employee on the role) and writes the audit event.
 */
export async function replaceAccessGrants(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    subject,
    grants,
    actorId,
    ip,
    reason
  }: {
    companyId: string;
    subject: { employeeTypeId: string } | { userId: string };
    grants: readonly GrantInput[];
    actorId: string;
    ip?: string;
    reason?: string;
  }
): Promise<Result> {
  await requireEntitlement(client, companyId, "PERMISSIONS");

  if ("userId" in subject) {
    if (!(await isCompanyEmployee(subject.userId, companyId))) {
      return error({ companyId, userId: subject.userId }, "Employee not found");
    }
  } else {
    const ownType = await db
      .selectFrom("employeeType")
      .select("id")
      .where("id", "=", subject.employeeTypeId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!ownType) {
      return error(
        { companyId, employeeTypeId: subject.employeeTypeId },
        "Employee type not found"
      );
    }
  }

  const before = await readGrants(db, companyId, subject);
  const beforeClaims =
    "userId" in subject ? await auditedClaims(subject.userId, companyId) : null;

  try {
    await replaceGrants(db, { companyId, subject, grants, userId: actorId });
  } catch (err) {
    return error(err, "Failed to update permissions");
  }

  if ("userId" in subject) {
    await redis.del(getPermissionCacheKey(subject.userId));
    // Audit the change (NIST 800-171 3.3.1/3.3.2): actor, target, before/after.
    logPermissionChange({
      actor: actorId,
      targetUserId: subject.userId,
      companyId,
      ip,
      before: beforeClaims,
      after: await auditedClaims(subject.userId, companyId),
      reason
    });
  } else {
    const employees = await db
      .selectFrom("employee")
      .select("id")
      .where("companyId", "=", companyId)
      .where("employeeTypeId", "=", subject.employeeTypeId)
      .execute();
    if (employees.length) {
      await redis.del(...employees.map((e) => getPermissionCacheKey(e.id)));
    }
    logRoleAccessChange({
      actor: actorId,
      employeeTypeId: subject.employeeTypeId,
      companyId,
      ip,
      changes: grantChanges(before, grants),
      affected: employees.length
    });
  }

  return success("Permissions updated");
}

/** Move an employee to another employee type of the company. */
export async function updateEmployee(
  client: SupabaseClient<Database>,
  {
    id,
    employeeType,
    companyId
  }: {
    id: string;
    employeeType: string;
    companyId: string;
  }
): Promise<Result> {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  if (!(await isCompanyEmployee(id, companyId))) {
    // error() logs the context when it is non-null.
    return error({ companyId, userId: id }, "Employee not found");
  }
  // The employee type comes from the form and employee.employeeTypeId has a
  // single-column foreign key, so another company's type would be accepted.
  const ownType = await getCarbonServiceRole()
    .from("employeeType")
    .select("id")
    .eq("id", employeeType)
    .eq("companyId", companyId)
    .maybeSingle();
  if (ownType.error || !ownType.data) {
    return error(
      { companyId, employeeTypeId: employeeType, error: ownType.error },
      "Employee type not found"
    );
  }
  const updateEmployeeEmployeeType = await client
    .from("employee")
    .upsert([{ id, companyId, employeeTypeId: employeeType }]);

  if (updateEmployeeEmployeeType.error)
    return error(updateEmployeeEmployeeType.error, "Failed to update employee");
  return success("Employee updated");
}

/**
 * The bulk edit: each chosen grant becomes an override on the person. A grant
 * whose level equals the role's stores no override. `addOnly` only raises a
 * level. The person's other grants are kept.
 */
export async function updatePermissions(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    id,
    grants: chosen,
    companyId,
    addOnly = false,
    actorId,
    ip
  }: {
    id: string;
    grants: readonly { module: string; page: string | null; level: Level }[];
    companyId: string;
    addOnly?: boolean;
    actorId: string;
    ip?: string;
  }
): Promise<Result> {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  if (!(await isCompanyEmployee(id, companyId))) {
    // error() logs the context when it is non-null.
    return error({ companyId, userId: id }, "Employee not found");
  }
  const claimsAdmin = await client.rpc("is_claims_admin", {
    company: companyId
  });
  if (claimsAdmin.error)
    return error(claimsAdmin.error, "Failed to check claims admin");
  if (claimsAdmin.data !== true) {
    return error(null, "You do not have permission to update permissions");
  }

  const employee = await db
    .selectFrom("employee")
    .leftJoin("employeeType", "employeeType.id", "employee.employeeTypeId")
    .select(["employee.employeeTypeId", "employeeType.systemType"])
    .where("employee.id", "=", id)
    .where("employee.companyId", "=", companyId)
    .executeTakeFirst();
  const roleGrants = employee?.employeeTypeId
    ? await readGrants(db, companyId, {
        employeeTypeId: employee.employeeTypeId
      })
    : [];
  const own = await readGrants(db, companyId, { userId: id });
  const find = (
    grants: readonly { module: string; page: string | null; level: Level }[],
    module: string,
    page: string | null
  ) => grants.find((g) => g.module === module && g.page === page)?.level;
  // What the person gets with no override: the role's page grant, else its
  // module grant; Full on the Admin type.
  const roleLevel = (module: string, page: string | null): Level =>
    employee?.systemType === "Admin"
      ? "Full"
      : (find(roleGrants, module, page) ??
        find(roleGrants, module, null) ??
        "None");

  const edited = new Map<string, GrantInput>();
  for (const grant of chosen) {
    const module = toModule(grant.module);
    if (!module) continue;
    const role = roleLevel(module, grant.page);
    const level = addOnly
      ? higher(grant.level, find(own, module, grant.page) ?? role)
      : grant.level;
    edited.set(`${module}:${grant.page ?? ""}`, {
      module,
      page: grant.page,
      level: level === role ? null : level
    });
  }

  const grants: GrantInput[] = [
    ...own.filter((g) => !edited.has(`${g.module}:${g.page ?? ""}`)),
    ...edited.values()
  ];
  return replaceAccessGrants(client, db, {
    companyId,
    subject: { userId: id },
    grants,
    actorId,
    ip,
    reason: addOnly ? "bulk-add" : "bulk-edit"
  });
}
