import type { Database, Json } from "@carbon/database";
import { redis } from "@carbon/kv";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CarbonEdition } from "../config/env";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import type { Permission, Result } from "../types";
import { error, success } from "../utils/result";
import {
  getClaims,
  getPermissionCacheKey,
  makePermissionsFromClaims
} from "./users";

export async function getUserByEmail(email: string) {
  return getCarbonServiceRole()
    .from("user")
    .select("*")
    .eq("email", email.toLowerCase())
    .single();
}

export async function getUserClaims(userId: string, companyId: string) {
  let claims: {
    permissions: Record<string, Permission>;
    role: string | null;
  } | null = null;

  try {
    const cachedClaims = await redis.get(getPermissionCacheKey(userId));
    if (cachedClaims) {
      claims = JSON.parse(cachedClaims) as {
        permissions: Record<string, Permission>;
        role: string | null;
      };
    }
  } catch (e) {
    console.error("Failed to get claims from redis", e);
  } finally {
    // if we don't have permissions from redis, get them from the database
    if (!claims) {
      // TODO: remove service role from here, and move it up a level
      const rawClaims = await getClaims(
        getCarbonServiceRole(),
        userId,
        companyId
      );
      if (rawClaims.error || rawClaims.data === null) {
        console.error(rawClaims);
        throw new Error("Failed to get claims");
      }

      // convert rawClaims to permissions
      claims = makePermissionsFromClaims(rawClaims.data as Json[]);

      // store claims in redis
      await redis.set(getPermissionCacheKey(userId), JSON.stringify(claims));

      if (!claims) {
        throw new Error("Failed to get claims");
      }
    }

    return claims;
  }
}

export async function deactivateCustomer(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const companyGroups = await serviceRole
    .from("group")
    .select("id")
    .eq("companyId", companyId);

  const groupIds = companyGroups.data?.map((g) => g.id) ?? [];

  const [updatePermissions, userToCompanyDelete, customerAccountDelete] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("customerAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      ...(groupIds.length > 0
        ? [
            serviceRole
              .from("membership")
              .delete()
              .eq("memberUserId", userId)
              .in("groupId", groupIds)
          ]
        : [])
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (customerAccountDelete.error) {
    return error(
      customerAccountDelete.error,
      "Failed to remove customer account"
    );
  }

  return success("Sucessfully deactivated customer");
}

export async function deactivateEmployee(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const companyGroups = await serviceRole
    .from("group")
    .select("id")
    .eq("companyId", companyId);

  const groupIds = companyGroups.data?.map((g) => g.id) ?? [];

  const [updatePermissions, userToCompanyDelete, employeeDeactivate] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("employee")
        .update({ active: false })
        .eq("id", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("employeeJob")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      ...(groupIds.length > 0
        ? [
            serviceRole
              .from("membership")
              .delete()
              .eq("memberUserId", userId)
              .in("groupId", groupIds)
          ]
        : [])
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (employeeDeactivate.error) {
    return error(employeeDeactivate.error, "Failed to deactivate employee");
  }

  return success("Sucessfully deactivated employee");
}

export async function deactivateUser(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const userToCompany = await serviceRole
    .from("userToCompany")
    .select("role")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .single();

  let result: Result;

  if (userToCompany.error) {
    // No userToCompany row — either pending invite, or already deactivated.
    const user = await serviceRole
      .from("user")
      .select("*")
      .eq("id", userId)
      .single();
    if (user.error) {
      return error(user.error, "Failed to get user");
    }

    const invite = await serviceRole
      .from("invite")
      .select("*")
      .eq("email", user.data?.email)
      .eq("companyId", companyId)
      .maybeSingle();

    if (!invite.data) {
      // No userToCompany and no invite — already fully deactivated.
      return success("User already deactivated");
    }

    if (invite.data.role === "customer") {
      result = await deactivateCustomer(serviceRole, userId, companyId);
    } else if (invite.data.role === "employee") {
      result = await deactivateEmployee(serviceRole, userId, companyId);
    } else if (invite.data.role === "supplier") {
      result = await deactivateSupplier(serviceRole, userId, companyId);
    } else {
      throw new Error("Invalid user role");
    }
  } else {
    if (userToCompany.data?.role === "customer") {
      result = await deactivateCustomer(serviceRole, userId, companyId);
    } else if (userToCompany.data?.role === "employee") {
      result = await deactivateEmployee(serviceRole, userId, companyId);
    } else if (userToCompany.data?.role === "supplier") {
      result = await deactivateSupplier(serviceRole, userId, companyId);
    } else {
      throw new Error("Invalid user role");
    }
  }

  // Clear stale permission cache
  if (result && result.success) {
    await redis.del(getPermissionCacheKey(userId));
  }

  // Mark any invite for this user/company as revoked so the link cannot be
  // redeemed and the UI no longer surfaces resend/revoke actions on it.
  if (result && result.success) {
    const userRecord = await serviceRole
      .from("user")
      .select("email")
      .eq("id", userId)
      .single();
    if (!userRecord.error && userRecord.data?.email) {
      await serviceRole
        .from("invite")
        .update({ revokedAt: new Date().toISOString() })
        .eq("email", userRecord.data.email)
        .eq("companyId", companyId)
        .is("revokedAt", null);
    }
  }

  // Update Stripe subscription quantity after successful deactivation
  if (result && result.success && CarbonEdition === Edition.Cloud) {
    await updateSubscriptionQuantityForCompany(companyId);
  }

  return result;
}

export async function deactivateSupplier(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const companyGroups = await serviceRole
    .from("group")
    .select("id")
    .eq("companyId", companyId);

  const groupIds = companyGroups.data?.map((g) => g.id) ?? [];

  const [updatePermissions, userToCompanyDelete, supplierAccountDelete] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("supplierAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      ...(groupIds.length > 0
        ? [
            serviceRole
              .from("membership")
              .delete()
              .eq("memberUserId", userId)
              .in("groupId", groupIds)
          ]
        : [])
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (supplierAccountDelete.error) {
    return error(
      supplierAccountDelete.error,
      "Failed to remove supplier account"
    );
  }

  return success("Sucessfully deactivated supplier");
}
