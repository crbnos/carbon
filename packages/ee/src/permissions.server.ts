// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type {
  Actor,
  CarbonError,
  ServiceContext
} from "@carbon/api/service-fn.server";
import type { Result } from "@carbon/auth";
import { error, getClaims, success } from "@carbon/auth";
import { bustApiKeyCache } from "@carbon/auth/auth.server";
import {
  logApiKeyAccessChange,
  logPermissionChange,
  logRoleAccessChange
} from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { clearClaims } from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import {
  type AccessSubjectType,
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
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EntitlementError, requireEntitlement } from "./entitlements.server";
import {
  bulkEditGrants,
  claimsMayEditAccounts,
  type GrantRow,
  keyGrantsAboveActor,
  pageName,
  refusedModules,
  SUBJECT_RULES,
  subjectTypeOf
} from "./permission-grants";

/**
 * Gated to the Business plan via each subject's feature (`SUBJECT_RULES`);
 * Community ships an "everyone is an admin" experience so none of this is
 * reachable there.
 *
 * The invite flow's permission merge stays in the ERP `users.service.ts`: only
 * portal invites carry permissions through it, and it is not authoring.
 */

/**
 * Delete one of the company's unprotected employee types. The plan lock is
 * returned as a refusal (`subjectEntitlement`), like every other subject write.
 * A protected type, or one that is not the company's, is left as it is.
 */
export async function deleteEmployeeType(
  client: SupabaseClient<Database>,
  { companyId, id }: { companyId: string; id: string }
): Promise<{ error: AccessWriteError | null }> {
  const unentitled = await subjectEntitlement(client, companyId, "role");
  if (unentitled) return { error: unentitled };
  const deleted = await client
    .from("employeeType")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId)
    .eq("protected", false);
  if (deleted.error) {
    return {
      error: {
        code: "internal",
        message: "Failed to delete employee type",
        cause: deleted.error
      }
    };
  }
  return { error: null };
}

/**
 * What a grant write does to the subject's own grants: replace them, remove
 * one, or `keep` them as they are while a person moves type (`employeeType`).
 */
export type AccessChange =
  | { set: readonly GrantInput[] }
  | { remove: GrantRow }
  | { keep: true };

/**
 * Why a grant write wrote nothing. `entitlement`: the company's plan lacks the
 * subject's feature (`SUBJECT_RULES[…].refusal` is the message).
 */
export type AccessWriteError = {
  code: "entitlement" | "forbidden" | "notFound" | "validation" | "internal";
  message: string;
  /** The failed query's error, for the log; never shown. */
  cause?: unknown;
};

/**
 * A grant write's refusal as the service function's error, `cause` kept. The
 * one mapping every ERP caller of these writes uses: pass the write, or a
 * refusal already in hand (`subjectEntitlement`, or a write's `error` once
 * read) — a refusal in hand always maps to an error.
 */
export function grantWriteRefusal(
  ctx: Pick<ServiceContext, "error">,
  write: AccessWriteError
): Promise<CarbonError>;
export function grantWriteRefusal(
  ctx: Pick<ServiceContext, "error">,
  write: Promise<{ error: AccessWriteError | null }> | AccessWriteError | null
): Promise<CarbonError | null>;
export async function grantWriteRefusal(
  ctx: Pick<ServiceContext, "error">,
  write: Promise<{ error: AccessWriteError | null }> | AccessWriteError | null
): Promise<CarbonError | null> {
  const error = write instanceof Promise ? (await write).error : write;
  return error ? ctx.error(error.code, error.message, error.cause) : null;
}

/**
 * The entitlement lock (`requireEntitlement`) for a subject type, as a returned
 * refusal: every refusal of a grant write is returned, none thrown.
 */
export async function subjectEntitlement(
  client: SupabaseClient<Database>,
  companyId: string,
  type: AccessSubjectType
): Promise<AccessWriteError | null> {
  try {
    await requireEntitlement(client, companyId, SUBJECT_RULES[type].feature);
    return null;
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    return { code: "entitlement", message: SUBJECT_RULES[type].refusal };
  }
}

async function auditedClaims(userId: string, companyId: string) {
  const claims = await getClaims(getCarbonServiceRole(), userId, companyId);
  if (claims.error || claims.data === null) return null;
  return claimKeys(claimsFor(claims.data, companyId).permissions);
}

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

async function ownedSubject(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  subject: GrantSubject
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

/** A key write that would give the key more than its writer holds (`keyGrantsAboveActor`). */
function keyCapRefusal(pages: readonly string[]): AccessWriteError {
  const shown = pages.slice(0, 5).map(pageName).join(", ");
  const more = pages.length > 5 ? ` and ${pages.length - 5} more` : "";
  return {
    code: "forbidden",
    message: `An API key cannot have more access than you: ${shown}${more}`
  };
}

class Refusal extends Error {
  constructor(
    code: AccessWriteError["code"],
    message: string,
    readonly refusal: AccessWriteError = { code, message }
  ) {
    super(message);
  }
}

/**
 * Write the grants of a role, a person or an API key in the company: the one
 * grant write. It checks the entitlement (`SUBJECT_RULES[…].feature`; an
 * `entitlement` error), that the subject is the company's, the modules the
 * subject may hold (`refusedModules`), and that a key gets no more than
 * `actor` holds (`keyGrantsAboveActor`; a `forbidden` error); clamps each
 * level to its page; writes in one transaction; clears the caches the change
 * reaches (the person's claims, every member of the role, the key's record);
 * and writes the audit event: `permission_changed` with the claim keys before
 * and after for a person, `role_access_changed` with the grant changes for a
 * role, and `permission_changed` with the grant changes for a key.
 *
 * A person can be moved to another employee type of the company in the same
 * transaction (`employeeType`); `{ keep: true }` moves them and leaves their
 * grants alone, and needs no plan feature, as choosing a type on invite or
 * convert never did. `subjectRow` writes the subject's own row in
 * that transaction too, before the grants: an API key is created or renamed
 * with its grants, or not at all.
 */
export async function writeAccessGrants(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    subject,
    change,
    employeeType,
    subjectRow,
    actor,
    actorId,
    ip,
    reason
  }: {
    companyId: string;
    subject: GrantSubject;
    change: AccessChange;
    /** A person only: the employee type to move them to. */
    employeeType?: string;
    subjectRow?: (tx: KyselyTx) => Promise<unknown>;
    /** Who writes, as the request authorised them. Setting a key's grants needs it. */
    actor?: Actor;
    actorId: string;
    ip?: string;
    /** A person only: why, on their `permission_changed` event. */
    reason?: string;
  }
): Promise<{ error: AccessWriteError | null }> {
  const type = subjectTypeOf(subject);
  if ("keep" in change) {
    if (!("userId" in subject) || !employeeType) {
      return {
        error: {
          code: "validation",
          message:
            "Only a person's employee type can change without a grant change"
        }
      };
    }
  } else {
    const unentitled = await subjectEntitlement(client, companyId, type);
    if (unentitled) return { error: unentitled };
  }

  if ("set" in change) {
    const refused = refusedModules(type, change.set);
    if (refused.length) {
      return {
        error: {
          code: "validation",
          message: `${refused.join(", ")} cannot be granted to ${SUBJECT_RULES[type].noun}`
        }
      };
    }
    // Fail closed: a key's grants are capped at the writer's, so need them.
    if (type === "key" && !actor) {
      return {
        error: {
          code: "forbidden",
          message: "An API key's access can only be set by a known caller"
        }
      };
    }
  }

  const userId = "userId" in subject ? subject.userId : null;
  const claimsBefore = userId ? await auditedClaims(userId, companyId) : null;

  let written: Awaited<ReturnType<typeof writeInTransaction>>;
  try {
    written = await db.transaction().execute(writeInTransaction);
  } catch (err) {
    if (err instanceof Refusal) return { error: err.refusal };
    return {
      error: {
        code: "internal",
        message: "Failed to update permissions",
        cause: err
      }
    };
  }
  const { owned, before, moveTo } = written;

  async function writeInTransaction(tx: KyselyTx) {
    await subjectRow?.(tx);
    const owned = await ownedSubject(tx, companyId, subject);
    if (!owned) throw new Refusal("notFound", SUBJECT_RULES[type].notFound);

    const moveTo =
      userId && employeeType && employeeType !== owned.employeeTypeId
        ? employeeType
        : null;
    if (userId && moveTo) {
      const ownType = await tx
        .selectFrom("employeeType")
        .select("id")
        .where("id", "=", moveTo)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!ownType) throw new Refusal("notFound", SUBJECT_RULES.role.notFound);
      await tx
        .updateTable("employee")
        .set({ employeeTypeId: moveTo })
        .where("id", "=", userId)
        .where("companyId", "=", companyId)
        .execute();
    }

    const before = await readGrants(tx, companyId, subject);
    if (type === "key" && "set" in change && actor && actor.type !== "system") {
      const above = keyGrantsAboveActor({
        actor: actor.permissions,
        companyId,
        before,
        after: change.set
      });
      if (above.length) {
        const refusal = keyCapRefusal(above);
        throw new Refusal(refusal.code, refusal.message);
      }
    }
    if ("set" in change) {
      await replaceGrants(tx, {
        companyId,
        subject,
        grants: change.set,
        userId: actorId
      });
    } else if ("remove" in change) {
      await removeGrant(tx, { companyId, subject, ...change.remove });
    }
    return { owned, before, moveTo };
  }

  let affected = 0;
  if (userId) {
    await clearClaims([userId]);
  } else if ("employeeTypeId" in subject) {
    const employees = await db
      .selectFrom("employee")
      .select("id")
      .where("companyId", "=", companyId)
      .where("employeeTypeId", "=", subject.employeeTypeId)
      .execute();
    affected = employees.length;
    await clearClaims(employees.map((e) => e.id));
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
      logApiKeyAccessChange({
        actor: actorId,
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
 * Create an employee type (`name` only) or rename one (`id` given), and set
 * its grants, in one transaction (`writeAccessGrants`): a failed grant write
 * leaves no type and no half-saved edit. Returns the type's id.
 */
export async function saveEmployeeType(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  {
    companyId,
    employeeType,
    grants,
    actorId,
    ip
  }: {
    companyId: string;
    employeeType: { name: string } | { id: string; name: string };
    grants: readonly GrantInput[];
    actorId: string;
    ip?: string;
  }
): Promise<
  { id: string; error: null } | { id: null; error: AccessWriteError }
> {
  const { name } = employeeType;
  const id = "id" in employeeType ? employeeType.id : crypto.randomUUID();
  const written = await writeAccessGrants(client, db, {
    companyId,
    subject: { employeeTypeId: id },
    change: { set: grants },
    actorId,
    ip,
    subjectRow: (tx) =>
      "id" in employeeType
        ? tx
            .updateTable("employeeType")
            .set({ name })
            .where("id", "=", id)
            .where("companyId", "=", companyId)
            .execute()
        : tx
            .insertInto("employeeType")
            .values({ id, name, companyId })
            .execute()
  });
  return written.error
    ? { id: null, error: written.error }
    : { id, error: null };
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
    return error({ companyId, userId: id }, SUBJECT_RULES.person.notFound);
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
    own,
    role,
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
    ? error(written.error.cause ?? null, written.error.message)
    : success("Permissions updated");
}
