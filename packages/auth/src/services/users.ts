// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { type Claims, claimsFor } from "@carbon/database/access";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../config/env";

const log = getLogger("auth");

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
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

/**
 * The user's claims in the company read now, past the claims cache
 * (`getUserClaims`): for a check that must see a grant written moments ago, or
 * one revoked within the cache's hour. `client` decides who asks. Throws when
 * the read fails.
 */
export async function readClaimsFresh(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Claims> {
  const { data, error } = await getClaims(client, userId, companyId);
  if (error || data === null) {
    throw new Error("Failed to read claims", { cause: error });
  }
  return claimsFor(data, companyId);
}
