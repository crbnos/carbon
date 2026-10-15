// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT, error, hasPermission } from "@carbon/auth";
import { deleteAuthAccount } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash, requireAuthSession } from "@carbon/auth/session.server";
import {
  deactivateCustomer,
  deactivateEmployee,
  deactivateSupplier,
  getUserClaims
} from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { redis } from "@carbon/kv";
import { now, parseAbsolute } from "@internationalized/date";

// Re-exported, not reimplemented: this module used to carry a near-identical
// copy that (a) missed the canonical version's cache TTL and (b) bypassed its
// per-request memoization.
export { getUserClaims } from "@carbon/auth/users.server";

import {
  emailDomain,
  getSsoConnection,
  getSsoConnectionByDomain,
  isSsoEnabled,
  // Shared with migrateUserToSso on purpose: both paths merge an invite's
  // permissions into userPermission, and they must not drift.
  mergeInvitePermissions,
  seedSsoIdentityForUser,
  uncoveredSsoDomainError
} from "@carbon/ee/sso.server";
import { getLogger } from "@carbon/logger";
import { datetime, redirect } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupplierContact } from "~/modules/purchasing";
import { getCustomerContact } from "~/modules/sales";
import type { EmployeeInsert, InviteInsert, User } from "~/modules/users";
import { getPermissionsByEmployeeType } from "~/modules/users";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { insertEmployeeJob } from "../people/people.service";

const logger = getLogger("erp", "users");

/**
 * Controlled environments (ITAR) expire invites 7 days after creation. Computed
 * at read time — no `expiresAt` column. Resend resets `createdAt`, restarting
 * the window. Enforced only when CONTROLLED_ENVIRONMENT is on.
 */
export const INVITE_EXPIRY_DAYS = 7;

export function isControlledInviteExpired(createdAt: string): boolean {
  if (!CONTROLLED_ENVIRONMENT) return false;
  const expiresAt = parseAbsolute(createdAt, "UTC").add({
    days: INVITE_EXPIRY_DAYS
  });
  return expiresAt.compare(now("UTC")) < 0;
}

/**
 * Once a company has an active SSO connection, employee invites must stay on
 * its covered domains — an uncovered invite would silently bypass the IdP via
 * magic-link auth. Customer/supplier invites are external by nature and are
 * not constrained. Scoped to THIS company's connection: a domain covered by
 * another company's connection is neither required nor blocked here.
 * Returns the refusal message for the email field, or null when the invite
 * may proceed. A failed connection read refuses (fail closed) rather than
 * guessing.
 */
export async function getSsoInviteDomainError(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  email: string
): Promise<string | null> {
  const connection = await getSsoConnection(serviceRole, companyId);
  if (connection.error) {
    logger.error("Failed to read SSO connection for invite check", {
      companyId,
      error: connection.error
    });
    return "Could not verify the company's single sign-on configuration. Try again.";
  }
  if (!connection.data) {
    return null;
  }
  return uncoveredSsoDomainError(connection.data.domains ?? [], email);
}

export async function acceptInvite(
  serviceRole: SupabaseClient<Database>,
  code: string,
  email?: string
) {
  const invite = await serviceRole
    .from("invite")
    .select("*")
    .eq("code", code)
    .is("acceptedAt", null)
    .is("revokedAt", null)
    .single();

  if (invite.error) return invite;

  if (isControlledInviteExpired(invite.data.createdAt)) {
    return {
      data: null,
      error: {
        message:
          "This invite has expired. Please request a new invite to continue."
      }
    };
  }

  // GoTrue stores auth emails lower-cased, while an invite keeps the address
  // as it was typed, so compare the normalized forms.
  if (
    email &&
    invite.data.email.trim().toLowerCase() !== email.trim().toLowerCase()
  ) {
    throw new Error(
      "Invite code does not match email. Please logout and try again."
    );
  }

  const user = await getUserByEmail(invite.data.email);
  if (user.error) return user;

  if (!["employee", "customer", "supplier"].includes(invite.data.role)) {
    return {
      data: null,
      error: {
        message: "Invalid invite role"
      }
    };
  }

  const userId = user.data.id;
  const { companyId, role } = invite.data;

  // Account activation, company membership, the permission merge and the
  // acceptedAt stamp are one unit of work. They used to run as three
  // concurrent writes followed by a compensating rollbackInvite, which could
  // not undo what it had not yet written and silently mismatched the
  // customer/supplier account keys. A transaction removes the half-states
  // instead of trying to repair them: nothing is visible unless all of it
  // commits. Mirrors migrateUserToSso, the SSO path that has to finish the
  // same work.
  const db = getDatabaseClient();

  try {
    const acceptedInvite = await db.transaction().execute(async (trx) => {
      switch (role) {
        case "employee": {
          // Deactivation dropped this membership and the trigger that seeds it
          // only fires on INSERT, so reactivation has to restore it. Done before
          // the active flip and inside the transaction: an employee is never
          // visible as active while outside their employee type's group.
          const employee = await trx
            .selectFrom("employee")
            .select(["id", "employeeTypeId"])
            .where("id", "=", userId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!employee) {
            throw new Error(
              `Employee record not found for user ${userId} in company ${companyId}. The record may have been deleted during deactivation.`
            );
          }

          if (employee.employeeTypeId) {
            await trx
              .insertInto("membership")
              .values({
                groupId: employee.employeeTypeId,
                memberUserId: userId
              })
              .onConflict((oc) =>
                oc.columns(["groupId", "memberUserId"]).doNothing()
              )
              .execute();
          }

          await trx
            .updateTable("employee")
            .set({ active: true })
            .where("id", "=", userId)
            .where("companyId", "=", companyId)
            .execute();
          break;
        }
        case "customer": {
          const customerAccount = await trx
            .updateTable("customerAccount")
            .set({ active: true })
            .where("id", "=", userId)
            .where("companyId", "=", companyId)
            .returning("id")
            .executeTakeFirst();

          if (!customerAccount) {
            throw new Error(
              `Customer account not found for user ${userId} in company ${companyId}. The account may have been deleted during deactivation.`
            );
          }
          break;
        }
        case "supplier": {
          const supplierAccount = await trx
            .updateTable("supplierAccount")
            .set({ active: true })
            .where("id", "=", userId)
            .where("companyId", "=", companyId)
            .returning("id")
            .executeTakeFirst();

          if (!supplierAccount) {
            throw new Error(
              `Supplier account not found for user ${userId} in company ${companyId}. The account may have been deleted during deactivation.`
            );
          }
          break;
        }
        default: {
          // A new "role" enum value fails typecheck here until it is handled,
          // instead of being activated as a supplier.
          const unhandled: never = role;
          throw new Error(`Invalid invite role: ${unhandled}`);
        }
      }

      await trx
        .insertInto("userToCompany")
        .values({ userId, companyId, role })
        .onConflict((oc) => oc.columns(["userId", "companyId"]).doNothing())
        .execute();

      // Serialize on the user row before the read-merge-write below. The
      // userPermission lock alone holds nothing while that row is absent, so
      // two first acceptances for this user in different companies could both
      // merge from {} and the later upsert would drop the earlier grant.
      // NO KEY UPDATE, not UPDATE: foreign-key checks from rows that reference
      // the user (createdBy and the like) are not blocked.
      await trx
        .selectFrom("user")
        .select("id")
        .where("id", "=", userId)
        .forNoKeyUpdate()
        .executeTakeFirstOrThrow();

      // setUserPermissions semantics, but under a row lock so two concurrent
      // grants cannot lose one another's writes.
      const currentPermission = await trx
        .selectFrom("userPermission")
        .select("permissions")
        .where("id", "=", userId)
        .forUpdate()
        .executeTakeFirst();

      const mergedPermissions = JSON.stringify(
        mergeInvitePermissions(
          (currentPermission?.permissions ?? {}) as Record<string, string[]>,
          (invite.data.permissions ?? {}) as Record<string, string[]>
        )
      );

      await trx
        .insertInto("userPermission")
        .values({ id: userId, permissions: mergedPermissions })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({ permissions: mergedPermissions })
        )
        .execute();

      // Guarded so a concurrent acceptance can never apply twice, and so a
      // revoke that committed after the lookup above still wins.
      const accepted = await trx
        .updateTable("invite")
        .set({ acceptedAt: datetime.timestamp() })
        .where("code", "=", code)
        .where("companyId", "=", companyId)
        .where("acceptedAt", "is", null)
        .where("revokedAt", "is", null)
        .returningAll()
        .executeTakeFirst();

      if (!accepted) {
        throw new Error(
          "This invite has already been accepted or was revoked."
        );
      }

      return accepted;
    });

    // Post-commit and failure-tolerant: the grants just written are cached by
    // requirePermissions, so a stale entry would outlive the acceptance.
    try {
      await redis.del(getPermissionCacheKey(userId));
    } catch (err) {
      logger.error(
        "Failed to invalidate permission cache after invite accept",
        { error: err, userId }
      );
    }

    return { data: acceptedInvite, error: null };
  } catch (err) {
    logger.error("Failed to accept invite", { error: err, userId, companyId });
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Failed to accept invite"
      }
    };
  }
}

export async function addUserToCompany(
  client: SupabaseClient<Database>,
  userToCompany: {
    userId: string;
    companyId: string;
    role: "employee" | "customer" | "supplier";
  }
) {
  return client.from("userToCompany").insert(userToCompany);
}

/**
 * Pre-seed a SAML SSO identity for a newly-created auth user when their email
 * domain already has a verified SSO connection — so their first SAML sign-in
 * links to this account instead of being rejected by GOTRUE_DISABLE_SIGNUP.
 * (Existing users on a domain are handled by the backfill in verifySsoDomain.)
 *
 * Best-effort: a failure is logged, never thrown — account creation must not
 * fail because seeding failed, and the domain-verify backfill is a fallback.
 * Rollback-safe: identities cascade-delete with auth.users, so a later insert
 * failure that deletes the auth account also removes this row. Self-gates on
 * isSsoEnabled(); off-Enterprise it does not query.
 */
async function seedSsoIdentityForNewUser(
  serviceRole: SupabaseClient<Database>,
  { userId, email }: { userId: string; email: string }
): Promise<void> {
  if (!isSsoEnabled()) return;
  const domain = emailDomain(email);
  if (!domain) return;

  const connection = await getSsoConnectionByDomain(serviceRole, domain);
  if (connection.error || !connection.data) return;

  const seed = await seedSsoIdentityForUser(getDatabaseClient(), {
    userId,
    email,
    providerId: connection.data.providerId
  });
  if (seed.error) {
    logger.error("Failed to pre-seed SSO identity for new user", {
      userId,
      domain,
      error: seed.error
    });
  }
}

export async function createCustomerAccount(
  client: SupabaseClient<Database>,
  {
    id,
    customerId,
    companyId,
    createdBy
  }: {
    id: string;
    customerId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string; email: string }
> {
  // Both ids come from the form: the contact must be this company's and hang
  // off the customer the account is being created for, or the account (and the
  // contact's userId write below) would point at another tenant's rows.
  const customerContact = await getCustomerContact(client, id, companyId);
  if (
    customerContact.error ||
    customerContact.data === null ||
    customerContact.data.customerId !== customerId ||
    customerContact.data.contact === null ||
    !customerContact.data.contact.email
  ) {
    logger.error("Failed to get customer contact for the company", {
      companyId,
      customerContactId: id,
      customerId,
      error: customerContact.error
    });
    return { success: false, message: "Failed to get customer contact" };
  }

  const { email, firstName, lastName } = customerContact.data.contact;

  const permissions = makeCustomerPermissions(companyId);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;

  if (user.data) {
    userId = user.data.id;
    if (!(await authIdentityExists(userId))) {
      return {
        success: false,
        message:
          "This user's auth account no longer exists. Contact support before re-adding."
      };
    }
  } else {
    isNewUser = true;
    const resolvedId = await resolveAuthUserId(email);
    if (!resolvedId) {
      return { success: false, message: "Failed to create auth account" };
    }
    userId = resolvedId;

    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      avatarUrl: null
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }

    await seedSsoIdentityForNewUser(serviceRole, { userId, email });
  }

  const code = crypto.randomUUID();
  const [contactUpdate, customerAccountInsert, inviteInsert] =
    await Promise.all([
      client.from("customerContact").update({ userId }).eq("id", id),
      insertCustomerAccount(client, {
        id: userId,
        customerId,
        companyId
      }),
      insertInvite(serviceRole, {
        role: "customer",
        permissions,
        email,
        companyId,
        createdBy,
        code
      })
    ]);

  if (contactUpdate.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: contactUpdate.error.message };
  }

  if (customerAccountInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: customerAccountInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId, email };
}

export async function createEmployeeAccount(
  client: SupabaseClient<Database>,
  {
    email,
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
    createdBy,
    attestedBy,
    attestedAt
  }: {
    email: string;
    firstName: string;
    lastName: string;
    employeeType: string;
    locationId: string;
    companyId: string;
    createdBy: string;
    // ITAR (controlled environments): the inviter's 22 CFR 120.62 U.S.-person
    // attestation. Null in ordinary deployments.
    attestedBy?: string | null;
    attestedAt?: string | null;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string }
> {
  // Both ids come from the invite form. The employee type's permission rows
  // carry their own company ids, so a foreign type would put another
  // company's grants into this invite; the location lands on employeeJob.
  const [ownedEmployeeType, ownedLocation] = await Promise.all([
    getCarbonServiceRole()
      .from("employeeType")
      .select("id")
      .eq("id", employeeType)
      .eq("companyId", companyId)
      .maybeSingle(),
    getCarbonServiceRole()
      .from("location")
      .select("id")
      .eq("id", locationId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (ownedEmployeeType.error || !ownedEmployeeType.data) {
    logger.error("Invite employee type is not in the company", {
      companyId,
      employeeType,
      error: ownedEmployeeType.error
    });
    return { success: false, message: "Employee type not found" };
  }
  if (ownedLocation.error || !ownedLocation.data) {
    logger.error("Invite location is not in the company", {
      companyId,
      locationId,
      error: ownedLocation.error
    });
    return { success: false, message: "Location not found" };
  }

  const employeeTypePermissions = await getPermissionsByEmployeeType(
    client,
    employeeType
  );
  if (employeeTypePermissions.error) {
    return { success: false, message: employeeTypePermissions.error.message };
  }

  const permissions = makePermissionsFromEmployeeType(employeeTypePermissions);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;
  let isReactivation = false;

  if (user.data) {
    userId = user.data.id;
    if (!(await authIdentityExists(userId))) {
      return {
        success: false,
        message:
          "This user's auth account no longer exists. Contact support before re-adding."
      };
    }

    const existingEmployee = await client
      .from("employee")
      .select("id, active")
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle();

    // A failed read must not fall through to the first-time path: there the
    // invite upsert can succeed beside a failing employee insert and leave a
    // redeemable invite behind.
    if (existingEmployee.error) {
      logger.error("Failed to read the existing employee row", {
        companyId,
        userId,
        error: existingEmployee.error
      });
      return { success: false, message: existingEmployee.error.message };
    }

    // Only an *active* employee is genuinely already a member. An inactive row
    // is the residue of a deactivation or a revoked invite: deactivation keeps
    // the "employee" row (and now the "employeeJob" row too), so refusing here
    // dead-ended re-adding someone — the blocking record is also hidden by the
    // employee list's default Active/Invited filter, leaving no way to act on
    // the error. reinviteDeactivatedEmployee reuses those rows instead.
    if (existingEmployee.data?.active) {
      return {
        success: false,
        message: "This user is already an employee in this company"
      };
    }

    isReactivation = Boolean(existingEmployee.data);
  } else {
    isNewUser = true;
    const resolvedId = await resolveAuthUserId(email);
    if (!resolvedId) {
      return { success: false, message: "Failed to create auth account" };
    }
    userId = resolvedId;

    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName,
      lastName,
      avatarUrl: null
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }

    await seedSsoIdentityForNewUser(serviceRole, { userId, email });
  }

  const code = crypto.randomUUID();
  const invite = {
    role: "employee",
    permissions,
    email,
    companyId,
    createdBy,
    code,
    attestedBy: attestedBy ?? null,
    attestedAt: attestedAt ?? null
  } satisfies InviteInsert;

  if (isReactivation) {
    // Reusing surviving rows is an UPDATE, which RLS would gate behind
    // users_update / people_update, so this path writes outside RLS, scoped by
    // id + companyId. It is one transaction because the three writes are only
    // correct together (see the helper), and it needs no compensation: the
    // auth user already existed, so a rollback leaves nothing behind.
    //
    // Writing outside RLS must not grant more than a first-time add, which
    // inserts under the caller's client: the INSERT policies on "employee" and
    // "employeeJob" require users_update and people_create. The route only
    // requires users_create, so the same two are checked here.
    const claims = await getUserClaims(createdBy, companyId).catch(
      (err: unknown) => {
        logger.error("Failed to read the inviter's permissions", {
          companyId,
          createdBy,
          error: err
        });
        return null;
      }
    );
    if (
      !hasPermission(claims?.permissions, "users", "update", companyId) ||
      !hasPermission(claims?.permissions, "people", "create", companyId)
    ) {
      logger.error("Re-adding a deactivated employee was refused", {
        companyId,
        userId,
        createdBy
      });
      return {
        success: false,
        message:
          "Re-adding a deactivated employee requires the Users update and People create permissions"
      };
    }

    try {
      await reinviteDeactivatedEmployee(getDatabaseClient(), {
        userId,
        companyId,
        employeeTypeId: employeeType,
        locationId,
        invite
      });
    } catch (err) {
      logger.error("Failed to re-invite employee", {
        error: err,
        userId,
        companyId
      });
      return {
        success: false,
        message:
          err instanceof Error ? err.message : "Failed to re-invite employee"
      };
    }

    return { success: true, code, userId };
  }

  const [employeeInsert, jobInsert, inviteInsert] = await Promise.all([
    insertEmployee(client, {
      id: userId,
      employeeTypeId: employeeType,
      active: false,
      companyId
    }),
    insertEmployeeJob(client, {
      id: userId,
      companyId,
      locationId
    }),
    insertInvite(serviceRole, invite)
  ]);

  if (employeeInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    }
    return { success: false, message: employeeInsert.error.message };
  }

  if (jobInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateEmployee(serviceRole, userId, companyId);
    }
    return { success: false, message: jobInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateEmployee(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId };
}

export async function createSupplierAccount(
  client: SupabaseClient<Database>,
  {
    id,
    supplierId,
    companyId,
    createdBy
  }: {
    id: string;
    supplierId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string; email: string }
> {
  // Both ids come from the form: the contact must be this company's and hang
  // off the supplier the account is being created for, or the account (and the
  // contact's userId write below) would point at another tenant's rows.
  const supplierContact = await getSupplierContact(client, id, companyId);
  if (
    supplierContact.error ||
    supplierContact.data === null ||
    supplierContact.data.supplierId !== supplierId ||
    supplierContact.data.contact === null ||
    !supplierContact.data.contact.email
  ) {
    logger.error("Failed to get supplier contact for the company", {
      companyId,
      supplierContactId: id,
      supplierId,
      error: supplierContact.error
    });
    return { success: false, message: "Failed to get supplier contact" };
  }

  const { email, firstName, lastName } = supplierContact.data.contact;

  const permissions = makeSupplierPermissions(companyId);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;

  if (user.data) {
    userId = user.data.id;
    if (!(await authIdentityExists(userId))) {
      return {
        success: false,
        message:
          "This user's auth account no longer exists. Contact support before re-adding."
      };
    }
  } else {
    isNewUser = true;
    const resolvedId = await resolveAuthUserId(email);
    if (!resolvedId) {
      return { success: false, message: "Failed to create auth account" };
    }
    userId = resolvedId;

    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      avatarUrl: null
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }

    await seedSsoIdentityForNewUser(serviceRole, { userId, email });
  }

  const code = crypto.randomUUID();
  const [contactUpdate, supplierAccountInsert, inviteInsert] =
    await Promise.all([
      client.from("supplierContact").update({ userId }).eq("id", id),
      insertSupplierAccount(client, {
        id: userId,
        supplierId,
        companyId
      }),
      insertInvite(serviceRole, {
        role: "supplier",
        permissions,
        email,
        companyId,
        createdBy,
        code
      })
    ]);

  if (contactUpdate.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: contactUpdate.error.message };
  }

  if (supplierAccountInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: supplierAccountInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId, email };
}

async function createUser(
  client: SupabaseClient<Database>,
  user: Omit<User, "fullName">
) {
  const { data, error } = await insertUser(client, user);

  if (error) {
    await deleteAuthAccount(client, user.id);
  }

  return { data, error };
}

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
}

export async function getCurrentUser(
  request: Request,
  client: SupabaseClient<Database>
) {
  const { userId } = await requireAuthSession(request);

  const user = await getUser(client, userId);
  if (user?.error || user?.data === null) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, "Failed to get user"))
    );
  }

  return user.data;
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${userId}`;
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

export async function getUserByEmail(email: string) {
  return getCarbonServiceRole()
    .from("user")
    .select("*")
    .eq("email", email.toLowerCase())
    .single();
}

// Returns false if the auth identity for this userId has been deleted, leaving only an app-side row.
async function authIdentityExists(userId: string): Promise<boolean> {
  const { error } = await getCarbonServiceRole().auth.admin.getUserById(userId);
  return !error;
}

// Creates the auth user for email, or recovers the existing ID if a prior deletion left one behind.
async function resolveAuthUserId(email: string): Promise<string | null> {
  const serviceRole = getCarbonServiceRole();
  const result = await serviceRole.auth.admin.createUser({
    email: email.toLowerCase(),
    password: crypto.randomUUID(),
    email_confirm: true
  });

  if (!result.error) return result.data.user.id;

  // Only recover for "already registered"; other errors (network, rate limit) surface as-is.
  if (result.error.code !== "user_already_exists") return null;

  // auth record exists but app user row doesn't; find the orphaned ID.
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await serviceRole.auth.admin.listUsers({
      page,
      perPage
    });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
    page++;
  }
}

export async function getUserGroups(
  client: SupabaseClient<Database>,
  userId: string
) {
  // Normalize an empty result to [] (not null) — belt-and-suspenders with the
  // groups_for_user COALESCE migration, so a user with no memberships is a
  // well-formed empty array rather than a null the /x guard could mistake for
  // an auth failure.
  const result = await client.rpc("groups_for_user", { uid: userId });
  return { ...result, data: result.data ?? [] };
}

export async function getUserDefaults(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userDefaults")
    .select("*")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getModulePreferences(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userModulePreference")
    .select("module, position, hidden")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .order("position");
}

export async function upsertModulePreferences(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  preferences: { module: string; position: number; hidden: boolean }[]
) {
  return client.from("userModulePreference").upsert(
    preferences.map((p) => ({
      userId,
      companyId,
      module: p.module,
      position: p.position,
      hidden: p.hidden,
      updatedAt: new Date().toISOString()
    })),
    { onConflict: "userId,companyId,module" }
  );
}

async function insertCustomerAccount(
  client: SupabaseClient<Database>,
  customerAccount: {
    id: string;
    customerId: string;
    companyId: string;
  }
) {
  return client
    .from("customerAccount")
    .insert(customerAccount)
    .select("id")
    .single();
}

export async function insertEmployee(
  client: SupabaseClient<Database>,
  employee: EmployeeInsert
) {
  return client.from("employee").insert([employee]).select("*").single();
}

/**
 * Re-add someone whose "employee" row survived a deactivation or a revoked
 * invite, writing the employee type, org placement and invite in one
 * transaction. They are only correct together: acceptInvite restores the
 * employee-type membership from employee.employeeTypeId, while the invite's
 * permissions come from the type chosen on the form. Written separately, a
 * failed employee write left a redeemable invite for the new type next to a row
 * still naming the old one.
 *
 * The employee row is locked first. That re-checks the caller's "not active"
 * read, so a concurrent acceptance cannot be flipped back to inactive, and it
 * serialises two re-adds of the same person, so the later one overwrites all
 * three rows rather than some of them. The row must still exist: this path
 * only reuses rows, and a first-time employee insert stays under the caller's
 * RLS client. Active stays false until the invite is accepted.
 *
 * "employeeJob" is upserted because deactivation keeps it (title, start date,
 * department, shift, manager, tags and custom fields carry through), but an
 * employee deactivated before that change has none. Only locationId is written
 * on conflict. Kept here rather than in people.service.ts — every export there
 * is also published as an MCP tool.
 *
 * The invite write mirrors insertInvite: upsert on (email, companyId), clearing
 * acceptedAt and revokedAt so a spent invite row becomes redeemable again, and
 * restarting createdAt so the controlled-environment expiry counts from now.
 */
async function reinviteDeactivatedEmployee(
  db: Kysely<KyselyDatabase>,
  {
    userId,
    companyId,
    employeeTypeId,
    locationId,
    invite
  }: {
    userId: string;
    companyId: string;
    employeeTypeId: string;
    locationId: string;
    invite: Omit<InviteInsert, "permissions"> & {
      permissions: Record<string, string[]>;
    };
  }
) {
  await db.transaction().execute(async (trx) => {
    const employee = await trx
      .selectFrom("employee")
      .select("active")
      .where("id", "=", userId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();

    if (!employee) {
      throw new Error(
        `Employee record not found for user ${userId} in company ${companyId}. Try adding the employee again.`
      );
    }

    if (employee.active) {
      throw new Error("This user is already an employee in this company");
    }

    await trx
      .updateTable("employee")
      .set({ employeeTypeId })
      .where("id", "=", userId)
      .where("companyId", "=", companyId)
      .execute();

    // updatedBy names the inviter: this connection has no auth.uid(), and the
    // audit log falls back to the row's own audit columns for the actor.
    await trx
      .insertInto("employeeJob")
      .values({ id: userId, companyId, locationId })
      .onConflict((oc) =>
        oc.columns(["id", "companyId"]).doUpdateSet({
          locationId,
          updatedBy: invite.createdBy,
          updatedAt: datetime.timestamp()
        })
      )
      .execute();

    const permissions = JSON.stringify(invite.permissions);

    await trx
      .insertInto("invite")
      .values({
        role: invite.role,
        permissions,
        email: invite.email,
        companyId: invite.companyId,
        createdBy: invite.createdBy,
        code: invite.code,
        attestedBy: invite.attestedBy ?? null,
        attestedAt: invite.attestedAt ?? null,
        acceptedAt: null,
        revokedAt: null
      })
      .onConflict((oc) =>
        oc.columns(["email", "companyId"]).doUpdateSet({
          role: invite.role,
          permissions,
          createdBy: invite.createdBy,
          updatedBy: invite.createdBy,
          // The controlled-environment expiry counts from createdAt. The
          // reused row is the original invite, usually long since accepted,
          // so keeping its createdAt expired the new invite on arrival.
          createdAt: datetime.timestamp(),
          code: invite.code,
          attestedBy: invite.attestedBy ?? null,
          attestedAt: invite.attestedAt ?? null,
          acceptedAt: null,
          revokedAt: null
        })
      )
      .execute();
  });
}

export async function insertInvite(
  client: SupabaseClient<Database>,
  invite: InviteInsert
) {
  return (
    client
      .from("invite")
      // Re-inviting an email that already has an invite row reuses it via the
      // onConflict upsert. Clear both terminal states so a previously revoked or
      // accepted invite becomes redeemable again — otherwise the acceptance
      // loader (invite.$code.tsx) rejects the row and it can never be accepted.
      // createdAt restarts too: the controlled-environment expiry counts from
      // it, and the reused row's is the original invite's.
      .upsert(
        [
          {
            ...invite,
            createdAt: datetime.timestamp(),
            acceptedAt: null,
            revokedAt: null
          }
        ],
        {
          onConflict: "email, companyId",
          ignoreDuplicates: false
        }
      )
      .select("*")
      .single()
  );
}

async function insertSupplierAccount(
  client: SupabaseClient<Database>,
  supplierAccount: {
    id: string;
    supplierId: string;
    companyId: string;
  }
) {
  return client
    .from("supplierAccount")
    .insert(supplierAccount)
    .select("id")
    .single();
}

async function insertUser(
  client: SupabaseClient<Database>,
  user: Omit<User, "fullName" | "createdAt">
) {
  return client.from("user").upsert([user]).select("*");
}

/**
 * Creates a console-only operator: a lightweight user record that can pin in
 * at MES terminals without needing email, password, or Supabase Auth.
 *
 * Uses a synthetic email ({uuid}@console.internal) to satisfy the NOT NULL
 * constraint. No auth.users entry is created — operators cannot log in.
 */
export async function createConsoleOperator(
  client: SupabaseClient<Database>,
  {
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
    createdBy
  }: {
    firstName: string;
    lastName: string;
    employeeType: string;
    locationId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; userId: string; name: string }
> {
  const serviceRole = getCarbonServiceRole();
  const userId = crypto.randomUUID();
  const syntheticEmail = `${userId}@console.internal`;

  // 1. Insert user record (no Supabase Auth)
  // Note: isConsoleOperator field added by migration 20260319000000_console-mode.sql
  // Type will be available after db:generate runs
  const userInsert = await serviceRole
    .from("user")
    .insert({
      id: userId,
      email: syntheticEmail,
      firstName,
      lastName,
      avatarUrl: null,
      active: true,
      isConsoleOperator: true
    } as any)
    .select("*")
    .single();

  if (userInsert.error) {
    return { success: false, message: userInsert.error.message };
  }

  // 2. Insert employee (auto-active, no invite needed)
  const employeeInsert = await insertEmployee(client, {
    id: userId,
    employeeTypeId: employeeType,
    active: true,
    companyId
  });

  if (employeeInsert.error) {
    // Cleanup: remove user
    await serviceRole.from("user").delete().eq("id", userId);
    return { success: false, message: employeeInsert.error.message };
  }

  // 3. Insert employeeJob
  const jobInsert = await insertEmployeeJob(client, {
    id: userId,
    companyId,
    locationId
  });

  if (jobInsert.error) {
    // Cleanup
    await serviceRole.from("employee").delete().eq("id", userId);
    await serviceRole.from("user").delete().eq("id", userId);
    return { success: false, message: jobInsert.error.message };
  }

  // 4. Add to userToCompany (for billing/plan counting)
  const companyLink = await serviceRole
    .from("userToCompany")
    .insert({ userId, companyId, role: "employee" as const })
    .select("*")
    .single();

  if (companyLink.error) {
    // Non-critical — operator still works without this
    logger.error("Failed to link console operator to company", {
      error: companyLink.error
    });
  }

  return {
    success: true,
    userId,
    name: `${firstName} ${lastName}`
  };
}

/**
 * Converts a console-only operator to a full user by adding a Supabase Auth
 * account and updating their email to a real one.
 */
export async function convertConsoleOperatorToUser(
  client: SupabaseClient<Database>,
  {
    userId,
    email,
    employeeType,
    companyId,
    createdBy
  }: {
    userId: string;
    email: string;
    employeeType: string;
    companyId: string;
    createdBy: string;
  }
): Promise<{ success: false; message: string } | { success: true }> {
  const serviceRole = getCarbonServiceRole();

  // userId comes from the URL and every write below is service-role, so prove
  // the operator is an employee of THIS company — otherwise another company's
  // operator could be given an auth login under an email the caller chose —
  // and that the employee type is this company's.
  const [membership, targetEmployeeType] = await Promise.all([
    serviceRole
      .from("employee")
      .select("id")
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("employeeType")
      .select("id")
      .eq("id", employeeType)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (membership.error || !membership.data) {
    logger.error("Console operator is not an employee of the company", {
      companyId,
      userId,
      error: membership.error
    });
    return { success: false, message: "User is not a console operator" };
  }
  if (targetEmployeeType.error || !targetEmployeeType.data) {
    logger.error("Employee type is not in the company", {
      companyId,
      employeeType,
      error: targetEmployeeType.error
    });
    return { success: false, message: "Employee type not found" };
  }

  // Verify the user is a console operator
  // Note: isConsoleOperator field added by migration 20260319000000_console-mode.sql
  const existingUser = await serviceRole
    .from("user")
    .select("*")
    .eq("id", userId)
    .single();

  if (existingUser.error || !(existingUser.data as any)?.isConsoleOperator) {
    return { success: false, message: "User is not a console operator" };
  }

  // Check email isn't already taken
  const emailCheck = await serviceRole
    .from("user")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (emailCheck.data) {
    return { success: false, message: "Email is already in use" };
  }

  // Create Supabase Auth account with the same user ID
  const createAuth = await serviceRole.auth.admin.createUser({
    id: userId,
    email: email.toLowerCase(),
    password: crypto.randomUUID(),
    email_confirm: true
  });

  if (createAuth.error) {
    return { success: false, message: createAuth.error.message };
  }

  // Update user record: real email + no longer console operator
  const updateUser = await serviceRole
    .from("user")
    .update({
      email: email.toLowerCase(),
      isConsoleOperator: false
    } as any)
    .eq("id", userId);

  if (updateUser.error) {
    // Cleanup auth
    await deleteAuthAccount(serviceRole, userId);
    return { success: false, message: updateUser.error.message };
  }

  // Change employee type to the selected type
  await serviceRole
    .from("employee")
    .update({ employeeTypeId: employeeType })
    .eq("id", userId)
    .eq("companyId", companyId);

  // Create invite so user gets the magic link email
  const code = crypto.randomUUID();
  const employee = await client
    .from("employee")
    .select("employeeTypeId")
    .eq("id", userId)
    .eq("companyId", companyId)
    .single();

  if (employee.data?.employeeTypeId) {
    const employeeTypePermissions = await getPermissionsByEmployeeType(
      client,
      employee.data.employeeTypeId
    );

    if (!employeeTypePermissions.error) {
      const permissions = makePermissionsFromEmployeeType(
        employeeTypePermissions
      );

      const inviteResult = await insertInvite(serviceRole, {
        role: "employee",
        permissions,
        email: email.toLowerCase(),
        companyId,
        createdBy,
        code
      });

      if (inviteResult.error) {
        logger.error("Failed to create invite for converted operator", {
          error: inviteResult.error
        });
      }
    }
  }

  return { success: true };
}

function makePermissionsFromEmployeeType({
  data
}: {
  data: {
    view: string[];
    create: string[];
    update: string[];
    delete: string[];
    module: string;
  }[];
}) {
  const permissions: Record<string, string[]> = {};

  data.forEach((permission) => {
    if (!permission.module) {
      throw new Error(
        `Permission module is missing for permission ${JSON.stringify(data)}`
      );
    }

    const module = permission.module.toLowerCase();

    permissions[`${module}_view`] = permission.view;
    permissions[`${module}_create`] = permission.create;
    permissions[`${module}_update`] = permission.update;
    permissions[`${module}_delete`] = permission.delete;
  });

  return permissions;
}

function makeCustomerPermissions(companyId: string) {
  // TODO: this should be more dynamic
  const permissions: Record<string, string[]> = {
    documents_view: [companyId],
    documents_create: [companyId],
    documents_udpate: [companyId],
    documents_delete: [companyId],
    jobs_view: [companyId],
    sales_view: [companyId],
    parts_view: [companyId]
  };

  return permissions;
}

function makeSupplierPermissions(companyId: string) {
  // TODO: this should be more dynamic
  const permissions: Record<string, string[]> = {
    documents_view: [companyId],
    documents_create: [companyId],
    documents_udpate: [companyId],
    documents_delete: [companyId],
    purchasing_view: [companyId],
    parts_view: [companyId]
  };

  return permissions;
}

export async function getInvite(
  client: SupabaseClient<Database>,
  email: string,
  companyId: string
) {
  return client
    .from("invite")
    .select("*")
    .eq("email", email)
    .eq("companyId", companyId)
    .single();
}

export async function resetPassword(userId: string, password: string) {
  return getCarbonServiceRole().auth.admin.updateUserById(userId, {
    password
  });
}
