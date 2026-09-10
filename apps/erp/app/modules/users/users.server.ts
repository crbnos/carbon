import { CONTROLLED_ENVIRONMENT, error, success } from "@carbon/auth";
import { deleteAuthAccount } from "@carbon/auth/auth.server";
import { logPermissionChange } from "@carbon/auth/auth-events.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash, requireAuthSession } from "@carbon/auth/session.server";
import {
  deactivateCustomer,
  deactivateEmployee,
  deactivateSupplier
} from "@carbon/auth/users.server";
import type { Database, Json } from "@carbon/database";
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
  seedSsoIdentityForUser,
  uncoveredSsoDomainError
} from "@carbon/ee/sso.server";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";
import { getSupplierContact } from "~/modules/purchasing";
import { getCustomerContact } from "~/modules/sales";
import type {
  CompanyPermission,
  EmployeeInsert,
  EmployeeTypePermission,
  InviteInsert,
  Module,
  Permission,
  User
} from "~/modules/users";
import { getPermissionsByEmployeeType } from "~/modules/users";
import { getDatabaseClient } from "~/services/database.server";
import type { Result } from "~/types";
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

  if (email && invite.data.email !== email) {
    throw new Error(
      "Invite code does not match email. Please logout and try again."
    );
  }

  const user = await getUserByEmail(invite.data.email);
  if (user.error) return user;

  const activationFunction =
    invite.data.role === "employee"
      ? activateEmployee
      : invite.data.role === "customer"
        ? activateCustomer
        : invite.data.role === "supplier"
          ? activateSupplier
          : null;

  if (!activationFunction) {
    return {
      data: null,
      error: {
        message: "Invalid invite role"
      }
    };
  }

  const [activate, addUser, setPermissions] = await Promise.all([
    activationFunction(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId
    }),
    addUserToCompany(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
      role: invite.data.role
    }),
    setUserPermissions(
      serviceRole,
      user.data.id,
      invite.data.permissions as Record<string, string[]>
    )
  ]);

  if (activate.error) {
    logger.error("Failed to activate invite", { error: activate.error });
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId
    });
    return activate;
  }

  if (addUser.error) {
    logger.error("Failed to add user to company", { error: addUser.error });
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId
    });
    return addUser;
  }

  if (setPermissions.error) {
    logger.error("Failed to set user permissions", {
      error: setPermissions.error
    });
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId
    });
    return setPermissions;
  }

  return serviceRole
    .from("invite")
    .update({ acceptedAt: new Date().toISOString() })
    .eq("code", code)
    .select("*")
    .single();
}

async function activateCustomer(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId
  }: {
    userId: string;
    companyId: string;
  }
) {
  const result = await client
    .from("customerAccount")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId)
    .select("id");

  if (!result.error && (!result.data || result.data.length === 0)) {
    return {
      data: null,
      error: {
        message: `Customer account not found for user ${userId} in company ${companyId}. The account may have been deleted during deactivation.`
      }
    };
  }

  return result;
}

async function activateEmployee(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId
  }: {
    userId: string;
    companyId: string;
  }
) {
  const result = await client
    .from("employee")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId)
    .select("id");

  if (!result.error && (!result.data || result.data.length === 0)) {
    return {
      data: null,
      error: {
        message: `Employee record not found for user ${userId} in company ${companyId}. The record may have been deleted during deactivation.`
      }
    };
  }

  return result;
}

async function activateSupplier(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId
  }: {
    userId: string;
    companyId: string;
  }
) {
  const result = await client
    .from("supplierAccount")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId)
    .select("id");

  if (!result.error && (!result.data || result.data.length === 0)) {
    return {
      data: null,
      error: {
        message: `Supplier account not found for user ${userId} in company ${companyId}. The account may have been deleted during deactivation.`
      }
    };
  }

  return result;
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
  const customerContact = await getCustomerContact(client, id);
  if (
    customerContact.error ||
    customerContact.data === null ||
    customerContact.data.contact === null ||
    !customerContact.data.contact.email
  ) {
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
      .select("id")
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (existingEmployee.data) {
      return {
        success: false,
        message: "This user is already an employee in this company"
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
    insertInvite(serviceRole, {
      role: "employee",
      permissions,
      email,
      companyId,
      createdBy,
      code,
      attestedBy: attestedBy ?? null,
      attestedAt: attestedAt ?? null
    })
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
  const supplierContact = await getSupplierContact(client, id);
  if (
    supplierContact.error ||
    supplierContact.data === null ||
    supplierContact.data.contact === null ||
    !supplierContact.data.contact.email
  ) {
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

export async function insertInvite(
  client: SupabaseClient<Database>,
  invite: InviteInsert
) {
  return client
    .from("invite")
    .upsert([{ ...invite, acceptedAt: null }], {
      onConflict: "email, companyId",
      ignoreDuplicates: false
    })
    .select("*")
    .single();
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

function isClaimPermission(key: string, value: unknown) {
  const action = key.split("_")[1];
  return (
    action !== undefined &&
    ["view", "create", "update", "delete"].includes(action) &&
    Array.isArray(value)
  );
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

export function makeEmptyPermissionsFromModules(data: Module[]) {
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
  let permissions: Record<string, CompanyPermission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: false,
          create: false,
          update: false,
          delete: false
        };
      }

      if (!Array.isArray(value)) {
        permissions[module] = {
          view: false,
          create: false,
          update: false,
          delete: false
        };
      } else {
        switch (action) {
          case "view":
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            permissions[module]["view"] = value.includes(companyId);
            break;
          case "create":
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            permissions[module]["create"] = value.includes(companyId);
            break;
          case "update":
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            permissions[module]["update"] = value.includes(companyId);
            break;
          case "delete":
            // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
            permissions[module]["delete"] = value.includes(companyId);
            break;
        }
      }
    }
  });

  if ("role" in claims) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    role = claims["role"] as string;
  }

  if ("items" in permissions) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete permissions["items"];
  }

  if ("messaging" in permissions) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete permissions["messaging"];
  }

  return { permissions, role };
}

export function makePermissionsFromClaims(claims: Json[] | null) {
  if (typeof claims !== "object" || claims === null) return null;
  let permissions: Record<string, Permission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: [],
          create: [],
          update: [],
          delete: []
        };
      }

      switch (action) {
        case "view":
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          permissions[module]["view"] = value as string[];
          break;
        case "create":
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          permissions[module]["create"] = value as string[];
          break;
        case "update":
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          permissions[module]["update"] = value as string[];
          break;
        case "delete":
          // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
          permissions[module]["delete"] = value as string[];
          break;
      }
    }
  });

  if ("role" in claims) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    role = claims["role"] as string;
  }

  if ("items" in permissions) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete permissions["items"];
  }

  if ("messaging" in permissions) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete permissions["messaging"];
  }

  return { permissions, role };
}

export function makeCompanyPermissionsFromEmployeeType(
  data: EmployeeTypePermission[],
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
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete result["items"];
  }

  if ("Messaging" in result) {
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete result["Messaging"];
  }

  return result;
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

async function rollbackInvite(
  serviceRole: SupabaseClient<Database>,
  { userId, companyId }: { userId: string; companyId: string }
) {
  await Promise.all([
    serviceRole
      .from("employee")
      .update({ active: false })
      .eq("id", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("userToCompany")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("customerAccount")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("supplierAccount")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId)
  ]);
}

async function setUserPermissions(
  client: SupabaseClient<Database>,
  userId: string,
  permissions: Record<string, string[]>
) {
  const user = await client
    .from("userPermission")
    .select("permissions")
    .eq("id", userId)
    .maybeSingle();

  const currentPermissions = (user.data?.permissions ?? {}) as Record<
    string,
    string[]
  >;
  const newPermissions = { ...currentPermissions };

  Object.entries(permissions).forEach(([key, value]) => {
    if (key in newPermissions) {
      newPermissions[key] = [...newPermissions[key], ...value];
    } else {
      newPermissions[key] = value;
    }
  });

  const result = await client
    .from("userPermission")
    .upsert({ id: userId, permissions: newPermissions });

  await redis.del(getPermissionCacheKey(userId));

  return result;
}

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
  const updateEmployeeEmployeeType = await client
    .from("employee")
    .upsert([{ id, companyId, employeeTypeId: employeeType }]);

  if (updateEmployeeEmployeeType.error)
    return error(updateEmployeeEmployeeType.error, "Failed to update employee");

  return updatePermissions(client, { id, permissions, companyId, actorId, ip });
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
  if (await client.rpc("is_claims_admin", { company: companyId })) {
    const claims = await getClaims(client, id);

    if (claims.error) return error(claims.error, "Failed to get claims");

    const updatedPermissions = (
      typeof claims.data !== "object" ||
      Array.isArray(claims.data) ||
      claims.data === null
        ? {}
        : claims.data
    ) as Record<string, string[]>;
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    delete updatedPermissions["role"];

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
          updatedPermissions[`${module}_view`].push(companyId);
        }
        if (
          permission.create &&
          !updatedPermissions[`${module}_create`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_create`].push(companyId);
        }
        if (
          permission.update &&
          !updatedPermissions[`${module}_update`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_update`].push(companyId);
        }
        if (
          permission.delete &&
          !updatedPermissions[`${module}_delete`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_delete`].push(companyId);
        }
      });
    } else {
      Object.entries(permissions).forEach(([name, permission]) => {
        const module = name.toLowerCase();
        if (permission.view) {
          if (!updatedPermissions[`${module}_view`]?.includes(companyId)) {
            updatedPermissions[`${module}_view`] = [
              ...updatedPermissions[`${module}_view`],
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
              ...updatedPermissions[`${module}_create`],
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
              ...updatedPermissions[`${module}_update`],
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
              ...updatedPermissions[`${module}_delete`],
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
      reason: addOnly ? "add" : "edit"
    });

    return success("Permissions updated");
  } else {
    return error(null, "You do not have permission to update permissions");
  }
}
