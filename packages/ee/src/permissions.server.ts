// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Result } from "@carbon/auth";
import { error, getClaims, getPermissionCacheKey, success } from "@carbon/auth";
import { bustApiKeyCache } from "@carbon/auth/auth.server";
import {
  logAuthEvent,
  logPermissionChange,
  logRoleAccessChange,
  SYSTEM_ACTOR
} from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  claimKeys,
  claimsFor,
  isAdminType,
  type Level
} from "@carbon/database/access";
import {
  type GrantInput,
  type GrantSubject,
  readGrants,
  removeGrant,
  replaceGrants
} from "@carbon/database/access-write";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";
import {
  type AccessSubjectType,
  bulkEditGrants,
  claimsMayEditAccounts,
  type GrantRow,
  type LeveledGrant,
  refusedModules
} from "./permission-grants";

/**
 * Commercial (Enterprise) RBAC authoring — the single, licensed source of truth
 * for creating/editing employee types and editing the access of a role, a
 * person or an API key. Every grant write is `writeAccessGrants`. Gated to the
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
// Grant writes: every subject, one entry point
// ---------------------------------------------------------------------------

export type AccessSubject = GrantSubject;

/** Replace the subject's grants with a set, or remove one of them. */
export type AccessChange =
  | { set: readonly GrantInput[] }
  | { remove: GrantRow };

export type AccessWriteError = {
  code: "notFound" | "validation" | "internal";
  message: string;
};

const subjectTypeOf = (subject: AccessSubject): AccessSubjectType =>
  "employeeTypeId" in subject ? "role" : "userId" in subject ? "person" : "key";

/** The user's claims in the company, as flat keys for the audit event. */
async function auditedClaims(userId: string, companyId: string) {
  const claims = await getClaims(getCarbonServiceRole(), userId, companyId);
  if (claims.error || claims.data === null) return null;
  return claimKeys(claimsFor(claims.data, companyId).permissions);
}

/** What a write changed: one entry per module or page whose grant moved. */
function grantChanges(
  before: readonly { module: string; page: string | null; level: string }[],
  after: readonly { module: string; page: string | null; level: string }[]
) {
  const key = (g: { module: string; page: string | null }) =>
    `${g.module}\u0000${g.page ?? ""}`;
  const from = new Map(before.map((g) => [key(g), g.level]));
  const to = new Map(after.map((g) => [key(g), g.level]));
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

/** The subject's own row in the company, with what the write needs from it. */
async function ownedSubject(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  subject: AccessSubject
): Promise<{ employeeTypeId?: string | null; keyHash?: string } | null> {
  if ("userId" in subject) {
    const employee = await db
      .selectFrom("employee")
      .select("employeeTypeId")
      .where("id", "=", subject.userId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return employee ? { employeeTypeId: employee.employeeTypeId } : null;
  }
  if ("employeeTypeId" in subject) {
    const type = await db
      .selectFrom("employeeType")
      .select("id")
      .where("id", "=", subject.employeeTypeId)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    return type ? {} : null;
  }
  const key = await db
    .selectFrom("apiKey")
    .select("keyHash")
    .where("id", "=", subject.apiKeyId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  return key ? { keyHash: key.keyHash } : null;
}

const NOT_FOUND: Record<AccessSubjectType, string> = {
  role: "Employee type not found",
  person: "Employee not found",
  key: "API key not found"
};

/**
 * Write the grants of a role, a person or an API key in the company: the one
 * grant write. It checks the entitlement (`API_KEYS` for a key, else
 * `PERMISSIONS`; throws `EntitlementError`), that the subject is the
 * company's, and the modules the subject may hold (`refusedModules`); clamps each
 * level to its page; writes in one transaction; clears the caches the change
 * reaches (the person's claims, every member of the role, the key's record);
 * and writes the audit event: `permission_changed` with the claim keys before
 * and after for a person, `role_access_changed` with the grant changes for a
 * role, and `permission_changed` with the grant changes for a key.
 *
 * A person can be moved to another employee type of the company in the same
 * transaction (`employeeType`).
 */
export async function writeAccessGrants(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    subject,
    change,
    employeeType,
    actorId,
    ip,
    reason
  }: {
    companyId: string;
    subject: AccessSubject;
    change: AccessChange;
    /** A person only: the employee type to move them to. */
    employeeType?: string;
    actorId: string;
    ip?: string;
    reason?: string;
  }
): Promise<{ error: AccessWriteError | null }> {
  const type = subjectTypeOf(subject);
  await requireEntitlement(
    client,
    companyId,
    type === "key" ? "API_KEYS" : "PERMISSIONS"
  );

  const owned = await ownedSubject(db, companyId, subject);
  if (!owned) return { error: { code: "notFound", message: NOT_FOUND[type] } };

  const typeBefore = owned.employeeTypeId ?? null;
  const moveTo =
    "userId" in subject && employeeType && employeeType !== typeBefore
      ? employeeType
      : null;
  if (moveTo) {
    const ownType = await db
      .selectFrom("employeeType")
      .select("id")
      .where("id", "=", moveTo)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!ownType)
      return { error: { code: "notFound", message: NOT_FOUND.role } };
  }

  if ("set" in change) {
    const refused = refusedModules(type, change.set);
    if (refused.length) {
      return {
        error: {
          code: "validation",
          message: `${refused.join(", ")} cannot be granted to an API key`
        }
      };
    }
  }

  const before = await readGrants(db, companyId, subject);
  const userId = "userId" in subject ? subject.userId : null;
  const claimsBefore = userId ? await auditedClaims(userId, companyId) : null;

  try {
    await db.transaction().execute(async (tx) => {
      if (userId && moveTo) {
        await tx
          .updateTable("employee")
          .set({ employeeTypeId: moveTo })
          .where("id", "=", userId)
          .where("companyId", "=", companyId)
          .execute();
      }
      if ("set" in change) {
        await replaceGrants(tx, {
          companyId,
          subject,
          grants: change.set,
          userId: actorId
        });
      } else {
        await removeGrant(tx, { companyId, subject, ...change.remove });
      }
    });
  } catch (err) {
    error(err, "Failed to update permissions");
    return {
      error: { code: "internal", message: "Failed to update permissions" }
    };
  }

  let affected = 0;
  if (userId) {
    await redis.del(getPermissionCacheKey(userId));
  } else if ("employeeTypeId" in subject) {
    const employees = await db
      .selectFrom("employee")
      .select("id")
      .where("companyId", "=", companyId)
      .where("employeeTypeId", "=", subject.employeeTypeId)
      .execute();
    affected = employees.length;
    if (employees.length) {
      await redis.del(...employees.map((e) => getPermissionCacheKey(e.id)));
    }
  } else if (owned.keyHash) {
    await bustApiKeyCache(owned.keyHash);
  }

  // NIST 800-171 3.3.1/3.3.2: who changed whose access, from what to what.
  // Each subject keeps the event its log consumers match on.
  if (userId) {
    logPermissionChange({
      actor: actorId,
      targetUserId: userId,
      companyId,
      ip,
      before: claimsBefore,
      after: await auditedClaims(userId, companyId),
      reason: reason ?? (moveTo ? "Employee type changed" : undefined)
    });
  } else {
    const changes = grantChanges(
      before,
      await readGrants(db, companyId, subject)
    );
    if ("employeeTypeId" in subject) {
      logRoleAccessChange({
        actor: actorId,
        employeeTypeId: subject.employeeTypeId,
        companyId,
        ip,
        changes,
        affected
      });
    } else if ("apiKeyId" in subject) {
      // Main audited no key write; a key has no event helper of its own.
      logAuthEvent("permission_changed", {
        actor: actorId || SYSTEM_ACTOR,
        apiKeyId: subject.apiKeyId,
        companyId,
        ip,
        changes
      });
    }
  }

  return { error: null };
}

/**
 * The bulk edit (`bulkEditGrants`) for one person. Runs in the
 * `carbon/update-permissions` job as the service role, so it authorizes the
 * actor who queued it: they must hold Users → Accounts at Edit in the company.
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
  const employee = await db
    .selectFrom("employee")
    .leftJoin("employeeType", "employeeType.id", "employee.employeeTypeId")
    .select([
      "employee.employeeTypeId",
      "employeeType.systemType",
      "employeeType.companyId as employeeTypeCompanyId"
    ])
    .where("employee.id", "=", id)
    .where("employee.companyId", "=", companyId)
    .executeTakeFirst();
  if (!employee) {
    // error() logs the context when it is non-null.
    return error({ companyId, userId: id }, "Employee not found");
  }
  const actorClaims = await getClaims(
    getCarbonServiceRole(),
    actorId,
    companyId
  );
  if (
    actorClaims.error ||
    actorClaims.data === null ||
    !claimsMayEditAccounts(actorClaims.data, companyId)
  ) {
    return error(
      { companyId, actorId },
      "You do not have permission to update permissions"
    );
  }

  const role = employee.employeeTypeId
    ? await readGrants(db, companyId, {
        employeeTypeId: employee.employeeTypeId
      })
    : [];
  const own = await readGrants(db, companyId, { userId: id });
  const grants = bulkEditGrants({
    chosen,
    own: own as LeveledGrant[],
    role: role as LeveledGrant[],
    admin: isAdminType(
      {
        systemType: employee.systemType,
        companyId: employee.employeeTypeCompanyId
      },
      companyId
    ),
    addOnly
  });
  const written = await writeAccessGrants(client, db, {
    companyId,
    subject: { userId: id },
    change: { set: grants },
    actorId,
    ip,
    reason: addOnly ? "bulk-add" : "bulk-edit"
  });
  return written.error
    ? error(null, written.error.message)
    : success("Permissions updated");
}
