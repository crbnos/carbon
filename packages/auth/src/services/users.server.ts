// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  claimsFor,
  isLegacyClaims,
  REGISTRY_HASH
} from "@carbon/database/access";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { oncePerRead } from "@carbon/logger/middleware.server";
import { chunkArray } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import type { CompanyRole, Result } from "../types";
import { error, success } from "../utils/result";
import { type AuditGrant, logRoleChange } from "./auth-events.server";
import type { SessionClaims } from "./session-access";
import { getClaims } from "./users";

const log = getLogger("auth");

// TTL for the cached permission claims. Bounds staleness if an invalidation
// (a grant or membership write) fails to delete the key — the cache heals
// itself on expiry. 1 hour, matching the auth package's other short-lived keys.
const PERMISSION_CACHE_TTL_SECONDS = 3600;

/**
 * A Redis hash of the user's claims, one field per company. Deleting it clears
 * every company; the registry hash retires entries a deploy changed the pages of.
 */
export function getPermissionCacheKey(userId: string) {
  return `permissions:${REGISTRY_HASH}:${userId}`;
}

export async function getUserByEmail(email: string) {
  return getCarbonServiceRole()
    .from("user")
    .select("*")
    .eq("email", email.toLowerCase())
    .single();
}

/**
 * Claims for a user in a company, resolved once per read request.
 *
 * Every matched loader that calls `requirePermissions` — plus the app-shell
 * loaders that call this directly — otherwise repeated the same Redis GET.
 *
 * Read-gated deliberately: React Router runs an action and its loader
 * revalidation in one request, so memoizing here on a mutating request could
 * let a permission gate pass on claims the action had just revoked.
 */
export function getUserClaims(userId: string, companyId: string) {
  return oncePerRead(`claims:${userId}:${companyId}`, () =>
    loadUserClaims(userId, companyId)
  );
}

async function loadUserClaims(
  userId: string,
  companyId: string
): Promise<SessionClaims> {
  let claims: SessionClaims | null = null;

  try {
    const cachedClaims = await redis.hget(
      getPermissionCacheKey(userId),
      companyId
    );
    if (cachedClaims) {
      claims = JSON.parse(cachedClaims) as SessionClaims;
    }
  } catch (e) {
    log.error("Failed to get claims from redis", { error: e });
  } finally {
    if (!claims) {
      const rawClaims = await getClaims(
        getCarbonServiceRole(),
        userId,
        companyId
      );
      if (rawClaims.error || rawClaims.data === null) {
        log.error("Failed to get claims", { rawClaims });
        throw new Error("Failed to get claims");
      }

      const { permissions, role } = claimsFor(rawClaims.data, companyId);
      claims = { permissions, role };

      // store claims in redis — best-effort. A null/failed write (Redis down,
      // fail-soft via @carbon/kv withResilience) must not abort the in-flight
      // request; we already have the claims from the DB.
      // TRANSITIONAL(#1958): never claims in the old shape (no `grants`): the
      // database has not run the permission migrations yet, and an hour of
      // cache would outlive them.
      try {
        if (!isLegacyClaims(rawClaims.data))
          await redis
            .multi()
            .hset(
              getPermissionCacheKey(userId),
              companyId,
              JSON.stringify(claims)
            )
            .expire(getPermissionCacheKey(userId), PERMISSION_CACHE_TTL_SECONDS)
            .exec();
      } catch (e) {
        log.error("Failed to cache claims in redis", { error: e });
      }
    }

    return claims;
  }
}

const CLEAR_CLAIMS_CHUNK = 500;

/**
 * Drop the cached claims of each user, every company: for a write that changes
 * what many people hold (a role's grants, a restored company). One `DEL` per
 * 500 users, so a large company never sends one huge command.
 */
export async function clearClaims(userIds: readonly string[]): Promise<void> {
  for (const batch of chunkArray([...userIds], CLEAR_CLAIMS_CHUNK)) {
    await redis.del(...batch.map(getPermissionCacheKey));
  }
}

type Write = PromiseLike<{ error: unknown }>;

/** What each role's deactivation removes beside the membership, with the error each answers. */
const ROLE_WRITES: Record<
  CompanyRole,
  (
    serviceRole: SupabaseClient<Database>,
    userId: string,
    companyId: string
  ) => [Write, string][]
> = {
  customer: (serviceRole, userId, companyId) => [
    [
      serviceRole
        .from("customerAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      "Failed to remove customer account"
    ]
  ],
  supplier: (serviceRole, userId, companyId) => [
    [
      serviceRole
        .from("supplierAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      "Failed to remove supplier account"
    ]
  ],
  employee: (serviceRole, userId, companyId) => [
    [
      serviceRole
        .from("employee")
        .update({ active: false })
        .eq("id", userId)
        .eq("companyId", companyId),
      "Failed to deactivate employee"
    ],
    // The person's own grants: a re-invite gives the role's access, and an
    // old override must not come back with it.
    [
      serviceRole
        .from("permission")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      "Failed to remove the employee's access"
    ]
  ]
};

/**
 * Remove the user from the company as `role`: the company is stripped from
 * their `userPermission` keys, and their membership, group memberships and
 * the role's own rows go. "employeeJob" is deliberately left in place. It
 * carries org placement (title, start date, department, shift, manager,
 * location, tags, custom fields), none of which grants access. Deleting it
 * made deactivation lossy: nothing in the re-invite path can reconstruct it.
 *
 * Clears the user's cached claims itself: the create*Account rollbacks call
 * the role functions directly, not through `deactivateUser`.
 */
async function deactivateAs(
  role: CompanyRole,
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  actorId?: string,
  ip?: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const before = (currentPermissions.data?.permissions ?? {}) as Record<
    string,
    string[]
  >;
  const permissions = Object.entries(before).reduce<Record<string, string[]>>(
    (acc, [key, value]) => {
      acc[key] = value.filter((id) => id !== companyId);
      return acc;
    },
    {}
  );

  // An employee's access is their `permission` rows, which this deletes: the
  // audit records them. A portal account's is its `userPermission` keys.
  let personGrants: AuditGrant[] = [];
  if (role === "employee") {
    const grants = await serviceRole
      .from("permission")
      .select("module, page, level")
      .eq("userId", userId)
      .eq("companyId", companyId);
    if (grants.error) {
      return error(grants.error, "Failed to get the employee's access");
    }
    personGrants = grants.data ?? [];
  }

  const companyGroups = await serviceRole
    .from("group")
    .select("id")
    .eq("companyId", companyId);

  const groupIds = companyGroups.data?.map((g) => g.id) ?? [];

  const writes: [Write, string][] = [
    [
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      "Failed to update user permissions"
    ],
    [
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      "Failed to remove user from company"
    ],
    ...ROLE_WRITES[role](serviceRole, userId, companyId)
  ];

  const results = await Promise.all([
    ...writes.map(([write]) => write),
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

  for (const [index, [, message]] of writes.entries()) {
    const failed = results[index]?.error;
    if (failed) return error(failed, message);
  }

  logRoleChange({
    actor: actorId,
    targetUserId: userId,
    companyId,
    beforeRole: role,
    afterRole: null,
    ...(role === "employee"
      ? { grantsBefore: personGrants, grantsAfter: [] }
      : { before, after: permissions }),
    ip,
    reason: "deactivate"
  });

  await clearClaims([userId]);

  return success(`Sucessfully deactivated ${role}`);
}

export const deactivateCustomer = (
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  actorId?: string,
  ip?: string
) => deactivateAs("customer", serviceRole, userId, companyId, actorId, ip);

export const deactivateEmployee = (
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  actorId?: string,
  ip?: string
) => deactivateAs("employee", serviceRole, userId, companyId, actorId, ip);

export const deactivateSupplier = (
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  actorId?: string,
  ip?: string
) => deactivateAs("supplier", serviceRole, userId, companyId, actorId, ip);

export async function deactivateUser(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string,
  actorId?: string,
  ip?: string
) {
  const userToCompany = await serviceRole
    .from("userToCompany")
    .select("role")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .single();

  let role: CompanyRole | undefined = userToCompany.data?.role;

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
      return success("User already deactivated");
    }
    role = invite.data.role;
  }

  if (!role) throw new Error("Invalid user role");

  const result = await deactivateAs(
    role,
    serviceRole,
    userId,
    companyId,
    actorId,
    ip
  );

  // Mark any invite for this user/company as revoked so the link cannot be
  // redeemed and the UI no longer surfaces resend/revoke actions on it.
  if (result.success) {
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

  return result;
}
