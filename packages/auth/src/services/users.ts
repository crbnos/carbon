// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import {
  claimsFromJson,
  expandClaims,
  type Gate,
  holdsGate,
  REGISTRY_HASH
} from "@carbon/database/access";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../config/env";
import type { Permission } from "../types";

const log = getLogger("auth");

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
}

/**
 * A Redis hash of the user's claims, one field per company. Deleting it clears
 * every company; the registry hash retires entries a deploy changed the pages of.
 */
export function getPermissionCacheKey(userId: string) {
  return `permissions:${REGISTRY_HASH}:${userId}`;
}

/**
 * Do resolved claims pass a page gate (`{ "sales.quotes": "Edit" }`) in the
 * company? `permissions` is the `permissions` field from
 * `makePermissionsFromClaims` / `getUserClaims`.
 */
export function hasPermission(
  permissions: Record<string, Permission> | null | undefined,
  gate: Gate,
  companyId: string
): boolean {
  return permissions ? holdsGate(permissions, gate, companyId) : false;
}

export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return {
    data: companies.data.map((company) => ({
      ...company,
      logoLightIcon: company.logoLightIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoLightIcon}`
        : null,
      logoDarkIcon: company.logoDarkIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoDarkIcon}`
        : null,
      logoLight: company.logoLight
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoLight}`
        : null,
      logoDark: company.logoDark
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoDark}`
        : null
    })),
    error: null
  };
}

export async function getCompaniesForUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  const { data, error } = await client
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);

  if (error) {
    log.error("Failed to get companies for user", { userId, error });
    return [];
  }

  return data?.map((row) => row.companyId) ?? [];
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

/** `get_claims` for one company, as the role and the permissions per page. */
export function makePermissionsFromClaims(
  claims: Json | null,
  companyId: string
) {
  if (typeof claims !== "object" || claims === null || Array.isArray(claims))
    return null;
  const raw = claimsFromJson(claims);
  return { permissions: expandClaims(raw, companyId), role: raw.role };
}
