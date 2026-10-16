// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  error,
  hasPermission,
  ITAR_RIDER_SHA256,
  ITAR_RIDER_VERSION
} from "@carbon/auth";
import { deleteAuthAccount } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash, requireAuthSession } from "@carbon/auth/session.server";
import {
  deactivateCustomer,
  deactivateEmployee,
  deactivateSupplier,
  deactivateUser,
  getUserClaims
} from "@carbon/auth/users.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { InviteEmail } from "@carbon/documents/email";
import { insertAuditLogEntries } from "@carbon/ee/audit.server";
import { generateConsolePin, setEmployeePin } from "@carbon/ee/console.server";
import {
  insertEmployeeType,
  updateEmployee,
  upsertEmployeeType,
  upsertEmployeeTypePermissions
} from "@carbon/ee/permissions.server";
import { defaultUpgradeMessage, resolveRequirement } from "@carbon/ee/plan";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { batchTrigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { sendEmail } from "@carbon/lib/email.server";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { now, parseAbsolute } from "@internationalized/date";
import { render } from "@react-email/components";
import { nanoid } from "nanoid";
import { z } from "zod";

// Re-exported, not reimplemented: this module used to carry a near-identical
// copy that (a) missed the canonical version's cache TTL and (b) bypassed its
// per-request memoization.
export { getUserClaims } from "@carbon/auth/users.server";

import {
  emailDomain,
  getSsoAwareInviteLink,
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
import {
  datetime,
  Edition,
  getClientIp,
  redirect,
  requiresItarEntityCertification
} from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupplierContact } from "~/modules/purchasing/purchasing.service";
import { getCustomerContact } from "~/modules/sales/sales.service";
import {
  defineServiceFn,
  type ServiceContext
} from "~/modules/service-fn.server";
import type { EmployeeInsert, InviteInsert, User } from "~/modules/users";
import {
  deleteGroup,
  getPermissionsByEmployeeType,
  insertGroup,
  upsertGroup,
  upsertGroupMembers
} from "~/modules/users/users.service";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { insertEmployeeJob } from "../people/people.service";
import {
  createOperatorValidator,
  employeeTypePermissionsValidator,
  itarEntityCertificationValidator,
  itarUserCertificationValidator,
  userPermissionsValidator
} from "./users.models";

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

// ---------------------------------------------------------------------------
// Operations (`defineServiceFn`): what the routes, the API and MCP all run
// ---------------------------------------------------------------------------
//
// None of these are published yet. The ones that send an invite or write an
// audit record take the request's IP, city and user agent as input, which an
// API caller could set to anything; the permission editors write that IP into
// the permission audit log. They wait for a context that carries the request.

/** Where the request came from, as the route read it from its headers. */
const requestOrigin = {
  ip: z.string().optional(),
  city: z.string().optional()
};

/** The request's IP and city, for the operations that record them. */
export function originOf(request: Request) {
  return {
    ip: getClientIp(request) ?? undefined,
    city: request.headers.get("x-vercel-ip-city") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined
  };
}

/**
 * Role authoring is a Business-plan feature. This is the friendly refusal;
 * the lock is `requireEntitlement` inside `@carbon/ee/permissions.server`.
 */
async function refuseUnlessPermissionsFeature(ctx: ServiceContext) {
  const spec = { feature: "PERMISSIONS" } as const;
  if (await companyHasFeature(ctx.asCaller.supabase, ctx.company.id, spec)) {
    return null;
  }
  return ctx.error(
    "entitlement",
    defaultUpgradeMessage(resolveRequirement(spec))
  );
}

/** The company's name and the inviting user, for the invite email. */
async function inviteSender(ctx: ServiceContext) {
  const client = ctx.asCaller.supabase;
  const [company, user] = await Promise.all([
    client.from("company").select("name").eq("id", ctx.company.id).single(),
    client
      .from("user")
      .select("email, fullName")
      .eq("id", ctx.auditUserId)
      .single()
  ]);
  if (!company.data || !user.data) return null;
  return { companyName: company.data.name, invitedBy: user.data };
}

async function sendInviteEmail(
  ctx: ServiceContext,
  invite: {
    email: string;
    code: string;
    name: string;
    companyName: string;
    invitedBy: { email: string; fullName: string | null };
    ip?: string;
    city?: string;
  }
) {
  const inviteLink = await getSsoAwareInviteLink(
    ctx.asSystem.supabase,
    invite.email,
    invite.code,
    ctx.company.id
  );
  await sendEmail({
    to: invite.email,
    subject: `You have been invited to join ${invite.companyName} on Carbon`,
    headers: { "X-Entity-Ref-ID": nanoid() },
    html: await render(
      InviteEmail({
        invitedByEmail: invite.invitedBy.email,
        invitedByName: invite.invitedBy.fullName ?? "",
        email: invite.email,
        name: invite.name,
        companyName: invite.companyName,
        inviteLink,
        ip: invite.ip ?? "127.0.0.1",
        location: invite.city ?? "Unknown",
        controlledEnvironment: CONTROLLED_ENVIRONMENT
      })
    )
  });
}

/**
 * Invite an employee: create their account in the company and email them
 * the invite link.
 *
 * @remarks
 * Without role authoring (the PERMISSIONS feature), the invite always gets
 * the Admin employee type, whatever was asked for. In a controlled
 * environment the inviter must attest the person is a U.S. person (a
 * `validation` error otherwise). Once SSO is on, an email outside its
 * domains is refused (a `rule` error). A deactivated or still-invited person
 * is re-added (see `createEmployeeAccount`).
 */
export const inviteEmployee = defineServiceFn({
  input: z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    employeeType: z.string().min(1),
    locationId: z.string().min(1),
    usPersonAttestation: z.boolean().default(false),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, input) {
    const companyId = ctx.company.id;
    const client = ctx.asCaller.supabase;

    let employeeType = input.employeeType;
    const canAuthorRoles = await companyHasFeature(client, companyId, {
      feature: "PERMISSIONS"
    });
    if (!canAuthorRoles) {
      const adminType = await client
        .from("employeeType")
        .select("id")
        .eq("companyId", companyId)
        .eq("systemType", "Admin")
        .maybeSingle();
      if (adminType.data?.id) employeeType = adminType.data.id;
    }

    // 22 CFR 120.62: the inviter attests the invitee is a U.S. person.
    if (CONTROLLED_ENVIRONMENT && !input.usPersonAttestation) {
      return ctx.error(
        "validation",
        "You must confirm a reasonable basis that this individual is a U.S. person"
      );
    }

    const ssoDomainError = await getSsoInviteDomainError(
      ctx.asSystem.supabase,
      companyId,
      input.email
    );
    if (ssoDomainError) return ctx.error("rule", ssoDomainError);

    const created = await createEmployeeAccount(client, {
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      employeeType,
      locationId: input.locationId,
      companyId,
      createdBy: ctx.auditUserId,
      attestedBy: CONTROLLED_ENVIRONMENT ? ctx.auditUserId : null,
      attestedAt: CONTROLLED_ENVIRONMENT ? datetime.timestamp() : null
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create employee account",
        created
      );
    }

    const sender = await inviteSender(ctx);
    if (!sender) return ctx.error("internal", "Failed to load company or user");
    await sendInviteEmail(ctx, {
      ...sender,
      email: input.email,
      code: created.code,
      name: `${input.firstName} ${input.lastName}`.trim(),
      ip: input.ip,
      city: input.city
    });
    return { userId: created.userId };
  }
});

/** Email a new customer or supplier account its invite link. */
async function emailAccountInvite(
  ctx: ServiceContext,
  account: { userId: string; email: string; code: string },
  origin: { ip?: string; city?: string }
) {
  const [sender, invitee] = await Promise.all([
    inviteSender(ctx),
    ctx.asCaller.supabase
      .from("user")
      .select("fullName")
      .eq("id", account.userId)
      .single()
  ]);
  if (!sender) return ctx.error("internal", "Failed to load company or user");
  await sendInviteEmail(ctx, {
    ...sender,
    email: account.email,
    code: account.code,
    name: invitee.data?.fullName ?? "",
    ...origin
  });
  return { userId: account.userId };
}

/**
 * Invite a customer contact: create their portal account and email them the
 * invite link.
 */
export const inviteCustomerContact = defineServiceFn({
  input: z.object({
    customerContactId: z.string().min(1),
    customerId: z.string().min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { customerContactId, customerId, ...origin }) {
    const created = await createCustomerAccount(ctx.asCaller.supabase, {
      id: customerContactId,
      customerId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create customer account",
        created
      );
    }
    return emailAccountInvite(ctx, created, origin);
  }
});

/**
 * Invite a supplier contact: create their portal account and email them the
 * invite link.
 */
export const inviteSupplierContact = defineServiceFn({
  input: z.object({
    supplierContactId: z.string().min(1),
    supplierId: z.string().min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { supplierContactId, supplierId, ...origin }) {
    const created = await createSupplierAccount(ctx.asCaller.supabase, {
      id: supplierContactId,
      supplierId,
      companyId: ctx.company.id,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create supplier account",
        created
      );
    }
    return emailAccountInvite(ctx, created, origin);
  }
});

/**
 * Send pending invites again.
 *
 * @remarks
 * One user is re-invited at once: the invite gets a new code (the old link
 * stops working), its acceptance and revocation are cleared, and its
 * `createdAt` restarts the controlled-environment expiry. Several are queued
 * as a job (`queued: true`). Refused when the user has no invite here.
 */
export const resendInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ...requestOrigin
  }),
  permission: { create: "users" },
  async run(ctx, { userIds, ip, city }) {
    const companyId = ctx.company.id;
    if (userIds.length > 1) {
      try {
        await batchTrigger(
          "user-admin",
          userIds.map((id) => ({
            payload: {
              id,
              type: "resend" as const,
              companyId,
              location: city ?? "Unknown",
              ip: ip ?? "127.0.0.1"
            }
          }))
        );
      } catch (err) {
        return ctx.error("internal", "Failed to reinvite users", err);
      }
      return { queued: true };
    }

    const [userId] = userIds;
    const serviceRole = ctx.asSystem.supabase;
    const [company, user] = await Promise.all([
      serviceRole.from("company").select("name").eq("id", companyId).single(),
      serviceRole
        .from("user")
        .select("email, fullName")
        .eq("id", userId)
        .single()
    ]);
    if (!company.data || !user.data) {
      return ctx.error("internal", "Failed to load company or user");
    }

    const existingInvite = await serviceRole
      .from("invite")
      .select("createdBy")
      .eq("email", user.data.email)
      .eq("companyId", companyId)
      .maybeSingle();
    if (existingInvite.error || !existingInvite.data) {
      return ctx.error(
        "notFound",
        "No invite record found for user",
        existingInvite.error
      );
    }

    const refreshed = await serviceRole
      .from("invite")
      .update({
        code: nanoid(),
        acceptedAt: null,
        revokedAt: null,
        createdAt: datetime.timestamp()
      })
      .eq("email", user.data.email)
      .eq("companyId", companyId)
      .select("code")
      .single();
    if (refreshed.error || !refreshed.data) {
      return ctx.error("internal", "Failed to refresh invite", refreshed.error);
    }

    const inviter = await serviceRole
      .from("user")
      .select("email, fullName")
      .eq("id", existingInvite.data.createdBy)
      .single();

    await sendInviteEmail(ctx, {
      companyName: company.data.name,
      invitedBy: {
        email: inviter.data?.email ?? user.data.email,
        fullName: inviter.data?.fullName ?? null
      },
      email: user.data.email,
      code: refreshed.data.code,
      name: user.data.fullName ?? "",
      ip,
      city
    });
    return { queued: false };
  }
});

/**
 * Revoke pending invites, and take the users' access to the company away.
 *
 * @remarks
 * One user is deactivated at once (and, on Cloud, the subscription's seat
 * count updated); several are deactivated by a job. Then every open invite
 * of theirs here is marked revoked, and each revocation is written to the
 * audit log when the company keeps one.
 */
export const revokeInvites = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ip: z.string().optional(),
    userAgent: z.string().optional()
  }),
  permission: { create: "users" },
  async run(ctx, { userIds, ip, userAgent }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    const serviceRole = ctx.asSystem.supabase;

    const users = await serviceRole
      .from("user")
      .select("id, email")
      .in("id", userIds);
    if (users.error) {
      return ctx.error("internal", "Failed to load users", users.error);
    }

    if (users.data.length === 1) {
      const deactivated = await deactivateUser(
        serviceRole,
        users.data[0].id,
        companyId,
        actorId,
        ip
      );
      if (!deactivated.success) {
        return ctx.error(
          "internal",
          "Failed to deactivate user",
          deactivated.message
        );
      }
      if (CarbonEdition === Edition.Cloud) {
        await updateSubscriptionQuantityForCompany(companyId);
      }
    } else {
      await batchTrigger(
        "user-admin",
        userIds.map((id) => ({
          payload: { id, type: "deactivate" as const, companyId, actorId, ip }
        }))
      );
    }

    const revokedAt = datetime.timestamp();
    const revoked = await serviceRole
      .from("invite")
      .update({ revokedAt })
      .in(
        "email",
        users.data.map((user) => user.email)
      )
      .eq("companyId", companyId)
      .is("revokedAt", null)
      .select("id");
    if (revoked.error) {
      return ctx.error("internal", "Failed to revoke invites", revoked.error);
    }

    // Best effort: a company without audit logging has no audit log table.
    if (revoked.data.length > 0) {
      try {
        await insertAuditLogEntries(
          serviceRole,
          companyId,
          revoked.data.map((invite) => ({
            tableName: "invite" as const,
            entityType: "invite" as const,
            entityId: invite.id,
            recordId: invite.id,
            operation: "UPDATE" as const,
            actorId,
            diff: { revokedAt: { old: null, new: revokedAt } },
            metadata: { ipAddress: ip, userAgent }
          }))
        );
      } catch (err) {
        logger.warn("[revoke-invite] audit write skipped", { error: err });
      }
    }
    return { revoked: revoked.data.length };
  }
});

/**
 * Deactivate users in the company: remove their access and their grants
 * here.
 *
 * @remarks
 * Refuses the caller's own account. One user is deactivated at once, and
 * `message` says how it went; several are deactivated by a job
 * (`queued: true`).
 */
export const deactivateUsers = defineServiceFn({
  input: z.object({
    userIds: z.array(z.string().min(1)).min(1),
    ip: z.string().optional()
  }),
  permission: { delete: "users" },
  async run(ctx, { userIds, ip }) {
    const companyId = ctx.company.id;
    const actorId = ctx.auditUserId;
    if (userIds.includes(actorId)) {
      return ctx.error("rule", "You cannot deactivate yourself");
    }

    if (userIds.length === 1) {
      // The service role: "userPermission" has no UPDATE policy, so under the
      // caller's client the permission strip matched no rows and the user
      // kept every grant for this company. It also updates the Stripe seats.
      const result = await deactivateUser(
        ctx.asSystem.supabase,
        userIds[0],
        companyId,
        actorId,
        ip
      );
      if (!result.success) {
        return ctx.error(
          "internal",
          result.message ?? "Failed to deactivate user"
        );
      }
      return { queued: false, message: result.message };
    }

    try {
      await batchTrigger(
        "user-admin",
        userIds.map((id) => ({
          payload: { id, type: "deactivate" as const, companyId, actorId, ip }
        }))
      );
    } catch (err) {
      return ctx.error("internal", "Failed to deactivate users", err);
    }
    return {
      queued: true,
      message: "Success. Please check back in a few moments."
    };
  }
});

const companyPermissions = z.record(z.string(), userPermissionsValidator);

/** `updateEmployee` / `updatePermissions` refusals, by what they mean. */
function permissionsWriteError(
  ctx: ServiceContext,
  message = "Failed to update permissions"
) {
  switch (message) {
    case "Employee not found":
    case "Employee type not found":
      return ctx.error("notFound", message);
    case "You do not have permission to update permissions":
      return ctx.error("forbidden", message);
    default:
      return ctx.error("internal", message);
  }
}

/**
 * Change an employee's employee type and their permissions in the company.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). The employee and the type
 * must both be the company's, and the caller must be a claims admin. The
 * change is written to the permission audit log.
 */
export const updateEmployeePermissions = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    employeeType: z.string().min(1),
    permissions: companyPermissions,
    ip: z.string().optional()
  }),
  permission: { update: "users" },
  async run(ctx, { id, employeeType, permissions, ip }) {
    const gated = await refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const result = await updateEmployee(ctx.asCaller.supabase, {
      id,
      employeeType,
      permissions,
      companyId: ctx.company.id,
      actorId: ctx.auditUserId,
      ip
    });
    if (!result.success) return permissionsWriteError(ctx, result.message);
    return { id };
  }
});

/**
 * Change several employees' permissions in the company, in a job.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Every user must be an
 * employee of the company. `editType: "add"` only grants; any other value
 * also takes away what `permissions` leaves unchecked.
 */
export const bulkUpdatePermissions = defineServiceFn({
  input: z.object({
    editType: z.string().min(1),
    userIds: z.array(z.string().min(1)).min(1),
    permissions: companyPermissions,
    ip: z.string().optional()
  }),
  permission: { update: "users" },
  async run(ctx, { editType, userIds, permissions, ip }) {
    const gated = await refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const companyId = ctx.company.id;
    // The job writes these users' grants as the service role: every id must
    // be an employee of this company. One batched read.
    const uniqueUserIds = [...new Set(userIds)];
    const members = await ctx.asSystem.supabase
      .from("employee")
      .select("id")
      .in("id", uniqueUserIds)
      .eq("companyId", companyId);
    if (members.error || (members.data ?? []).length !== uniqueUserIds.length) {
      logger.error("Bulk permission edit names users outside the company", {
        companyId,
        userIds: uniqueUserIds,
        error: members.error
      });
      return ctx.error("notFound", "Employee not found");
    }

    await batchTrigger(
      "update-permissions",
      userIds.map((id) => ({
        payload: {
          id,
          permissions,
          addOnly: editType === "add",
          companyId,
          actorId: ctx.auditUserId,
          ip
        }
      }))
    );
    return { count: userIds.length };
  }
});

/**
 * Create an employee type with its permissions.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). The type and its
 * permissions are two writes: when the permissions fail, the type stays.
 */
export const createEmployeeType = defineServiceFn({
  input: z.object({
    name: z.string().trim().min(1),
    permissions: employeeTypePermissionsValidator
  }),
  permission: { create: "users" },
  async run(ctx, { name, permissions }) {
    const gated = await refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const client = ctx.asCaller.supabase;
    const companyId = ctx.company.id;
    const created = await insertEmployeeType(client, { name, companyId });
    const employeeTypeId = created.data?.id;
    if (created.error || !employeeTypeId) {
      return ctx.error(
        "internal",
        "Failed to insert employee type",
        created.error
      );
    }

    const saved = await upsertEmployeeTypePermissions(
      client,
      employeeTypeId,
      companyId,
      permissions
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to insert employee type permissions",
        saved.error
      );
    }
    return { id: employeeTypeId };
  }
});

/**
 * Rename an employee type and change its permissions.
 *
 * @remarks
 * Needs role authoring (the PERMISSIONS feature). Two writes, as for
 * `createEmployeeType`.
 */
export const updateEmployeeType = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    permissions: employeeTypePermissionsValidator
  }),
  permission: { update: "users" },
  async run(ctx, { id, name, permissions }) {
    const gated = await refuseUnlessPermissionsFeature(ctx);
    if (gated) return gated;

    const client = ctx.asCaller.supabase;
    const updated = await upsertEmployeeType(client, { id, name });
    if (updated.error) {
      return ctx.error(
        "internal",
        "Failed to update employee type",
        updated.error
      );
    }

    const saved = await upsertEmployeeTypePermissions(
      client,
      id,
      ctx.company.id,
      permissions
    );
    if (saved.error) {
      return ctx.error(
        "internal",
        "Failed to update employee type permissions",
        saved.error
      );
    }
    return { id };
  }
});

const groupMembers = z.array(z.string().min(1)).min(1);

/**
 * Create a group with its members: users (`user_<id>`) and groups
 * (`group_<id>`). When the members cannot be saved, the group is removed.
 */
export const createGroup = defineServiceFn({
  input: z.object({ name: z.string().trim().min(1), selections: groupMembers }),
  permission: { create: "users" },
  async run(ctx, { name, selections }) {
    const client = ctx.asCaller.supabase;
    const created = await insertGroup(client, {
      name,
      companyId: ctx.company.id
    });
    const groupId = created.data?.id;
    if (created.error || !groupId) {
      return ctx.error("internal", "Failed to insert group", created.error);
    }

    const members = await upsertGroupMembers(client, groupId, selections);
    if (members.error) {
      await deleteGroup(client, groupId);
      return ctx.error(
        "internal",
        "Failed to insert group members",
        members.error
      );
    }
    return { id: groupId };
  }
});

/** Rename a group and replace its members. */
export const updateGroup = defineServiceFn({
  input: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    selections: groupMembers
  }),
  // The route has only ever required view; row-level security decides the
  // write. Kept as it was, so this stays unpublished.
  permission: { view: "users" },
  async run(ctx, { id, name, selections }) {
    const client = ctx.asCaller.supabase;
    const [group, members] = await Promise.all([
      upsertGroup(client, { id, name, companyId: ctx.company.id }),
      upsertGroupMembers(client, id, selections)
    ]);
    if (group.error) {
      return ctx.error("internal", "Failed to update group", group.error);
    }
    if (members.error) {
      return ctx.error(
        "internal",
        "Failed to update group members",
        members.error
      );
    }
    return { id };
  }
});

/**
 * Add a console operator: a PIN-only person who pins in at MES consoles.
 *
 * @remarks
 * The operator gets the company's Console Operator employee type and a new
 * 4-digit PIN, stored only as a hash and returned once. The subscription's
 * seat count is updated. When the PIN cannot be set, the operator stays and
 * the error says to reset the PIN.
 */
export const addConsoleOperator = defineServiceFn({
  input: createOperatorValidator,
  permission: { create: "users" },
  async run(ctx, { firstName, lastName, locationId }) {
    const companyId = ctx.company.id;
    const operatorType = await ctx.asSystem.supabase
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Console Operator")
      .single();
    if (operatorType.error || !operatorType.data) {
      return ctx.error(
        "internal",
        "Console Operator employee type not found. Run the migration.",
        operatorType.error
      );
    }

    const created = await createConsoleOperator(ctx.asCaller.supabase, {
      firstName,
      lastName,
      employeeType: operatorType.data.id,
      locationId,
      companyId,
      createdBy: ctx.auditUserId
    });
    if (!created.success) {
      return ctx.error(
        "internal",
        created.message ?? "Failed to create console operator",
        created
      );
    }

    const pin = generateConsolePin();
    try {
      await setEmployeePin(ctx.asSystem.pg, {
        employeeId: created.userId,
        companyId,
        pin,
        updatedBy: ctx.auditUserId
      });
    } catch (err) {
      await updateSubscriptionQuantityForCompany(companyId);
      return ctx.error(
        "internal",
        "Operator created, but the PIN could not be set. Use Reset PIN.",
        err
      );
    }

    await updateSubscriptionQuantityForCompany(companyId);
    return { userId: created.userId, name: created.name, pin };
  }
});

/**
 * Give a person a new console PIN. Their old PIN stops working at once.
 *
 * @remarks
 * A PIN pins in as that person at any MES console, so resetting one hands
 * over their shop-floor identity. Users update covers console operators
 * (PIN-only accounts made for this); for anyone else, an admin included, the
 * caller also needs settings update, the permission that turns console mode
 * on. The PIN is stored only as a hash and returned once.
 */
export const resetConsoleOperatorPin = defineServiceFn({
  input: z.object({ operatorId: z.string().min(1) }),
  permission: { update: "users" },
  async run(ctx, { operatorId }) {
    const user = await ctx.asCaller.supabase
      .from("user")
      .select("id, isConsoleOperator")
      .eq("id", operatorId)
      .single();
    if (user.error || !user.data) {
      return ctx.error("notFound", "Operator not found", user.error);
    }
    if (!user.data.isConsoleOperator && !ctx.can({ update: "settings" })) {
      return ctx.error("forbidden", "You do not have permission to do this");
    }

    // The (employee, company) foreign key refuses an operator outside this
    // company.
    const pin = generateConsolePin();
    try {
      await setEmployeePin(ctx.asSystem.pg, {
        employeeId: operatorId,
        companyId: ctx.company.id,
        pin,
        updatedBy: ctx.auditUserId
      });
    } catch (err) {
      return ctx.error("internal", "Failed to reset PIN", err);
    }
    return { pin };
  }
});

/** Where a certification was signed, as the route read it. */
const signedFrom = {
  ipAddress: z.string().optional(),
  userAgent: z.string().optional()
};

/**
 * Record an ITAR certification (entity or user) that expires in 365 days,
 * plus a best-effort audit-log entry with the IP and user agent. Written with
 * the service role: a self-attesting user does not hold settings create.
 */
async function recordItarCertification(
  ctx: ServiceContext,
  certification: {
    type: "entity" | "user";
    fullLegalName: string;
    title?: string;
    complianceContact?: string;
    ipAddress?: string;
    userAgent?: string;
  }
) {
  const serviceRole = ctx.asSystem.supabase;
  const companyId = ctx.company.id;
  const userId = ctx.auditUserId;
  const certifiedAt = datetime.timestamp();
  const expiresAt = parseAbsolute(certifiedAt, "UTC")
    .add({ days: 365 })
    .toAbsoluteString();

  const inserted = await serviceRole
    .from("itarCertification")
    .insert({
      companyId,
      userId,
      type: certification.type,
      docVersion: ITAR_RIDER_VERSION,
      docHash: ITAR_RIDER_SHA256,
      fullLegalName: certification.fullLegalName,
      title: certification.title ?? null,
      complianceContact: certification.complianceContact ?? null,
      certifiedAt,
      ipAddress: certification.ipAddress ?? null,
      userAgent: certification.userAgent ?? null,
      expiresAt,
      createdBy: userId
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    return ctx.error(
      "internal",
      "Failed to record certification",
      inserted.error
    );
  }

  // Best effort: a company without audit logging has no audit log table; the
  // certification row is the compliance record.
  try {
    await insertAuditLogEntries(serviceRole, companyId, [
      {
        tableName: "itarCertification",
        entityType: "itarCertification",
        entityId: inserted.data.id,
        recordId: inserted.data.id,
        operation: "INSERT",
        actorId: userId,
        metadata: {
          ipAddress: certification.ipAddress,
          userAgent: certification.userAgent
        },
        createdAt: certifiedAt
      }
    ]);
  } catch (err) {
    logger.warn("[acknowledge] audit write skipped for {type} cert", {
      type: certification.type,
      error: err
    });
  }
  return { certificationId: inserted.data.id };
}

/** The first problem, worded for the person who filled the form. */
function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "The certification is incomplete";
}

const RIDER_SIGNER =
  "The Rider must be accepted by a representative of the company it binds.";

/**
 * Accept the ITAR Rider on behalf of the company.
 *
 * @remarks
 * It unblocks the whole company's controlled-environment gate, so it needs
 * users update, and the signer must be a real person of the company: an API
 * key signs as no one, and Carbon staff (who hold users update in companies
 * they set up) cannot bind a customer.
 */
export const certifyItarEntity = defineServiceFn({
  input: z.object({
    authorityToBind: z.boolean(),
    acceptRider: z.boolean(),
    fullLegalName: z.string(),
    title: z.string(),
    complianceContact: z.string(),
    ...signedFrom
  }),
  permission: { update: "users" },
  async run(ctx, { ipAddress, userAgent, ...form }) {
    if (ctx.actor.type !== "user") return ctx.error("forbidden", RIDER_SIGNER);
    const signer = await ctx.asSystem.supabase
      .from("user")
      .select("email")
      .eq("id", ctx.actor.userId)
      .single();
    const email = signer.data?.email;
    if (!email || !requiresItarEntityCertification(email)) {
      return ctx.error("forbidden", RIDER_SIGNER);
    }

    const parsed = itarEntityCertificationValidator.safeParse(form);
    if (!parsed.success) {
      return ctx.error("validation", firstIssue(parsed.error));
    }
    return recordItarCertification(ctx, {
      type: "entity",
      fullLegalName: parsed.data.fullLegalName,
      title: parsed.data.title,
      complianceContact: parsed.data.complianceContact,
      ipAddress,
      userAgent
    });
  }
});

/** Certify that the caller is a U.S. person, for the controlled environment. */
export const certifyItarUser = defineServiceFn({
  input: z.object({
    certifyUsPerson: z.boolean(),
    agreeNotify: z.boolean(),
    understandPenalty: z.boolean(),
    fullLegalName: z.string(),
    ...signedFrom
  }),
  permission: {},
  async run(ctx, { ipAddress, userAgent, ...form }) {
    const parsed = itarUserCertificationValidator.safeParse(form);
    if (!parsed.success) {
      return ctx.error("validation", firstIssue(parsed.error));
    }
    return recordItarCertification(ctx, {
      type: "user",
      fullLegalName: parsed.data.fullLegalName,
      ipAddress,
      userAgent
    });
  }
});
