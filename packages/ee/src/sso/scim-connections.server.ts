// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The admin side of SCIM provisioning — Settings → Security → Provisioning.
 * Mirrors `connections.server.ts` (SAML SSO). Every authoring write embeds
 * `requireEntitlement(…, "SCIM")`; turning SCIM off does not, so a company
 * that lost the plan can still stop its IdP.
 *
 * The bearer token copies the API-key pattern: only its SHA-256 hash
 * (`hashApiKey`) and last 4 characters are stored, and the raw token is
 * returned once, to the action that made it.
 */

import { hashApiKey } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import { customAlphabet } from "nanoid";
import { requireEntitlement } from "../entitlements.server";
import { reconcileEmployeeTypes } from "./scim.server";

const logger = getLogger("ee", "scim-connections");

const tokenBody = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  32
);

type IdentityProvider = Database["public"]["Enums"]["scimIdentityProvider"];

type Result<T> = { data: T | null; error: string | null };

export function generateScimToken(): {
  token: string;
  tokenHash: string;
  tokenPreview: string;
} {
  const token = `scim_${tokenBody()}`;
  return {
    token,
    tokenHash: hashApiKey(token),
    tokenPreview: token.slice(-4)
  };
}

/**
 * What the Provisioning card shows: the connection (never its token hash),
 * the pushed groups with their mappings and member counts, and how many
 * provisioned people are active. `data` is null when SCIM is not set up.
 */
export async function getScimConnection(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const connection = await client
    .from("scimConnection")
    .select(
      "id, identityProvider, tokenPreview, defaultEmployeeTypeId, defaultLocationId, lastRequestAt, createdAt"
    )
    .eq("companyId", companyId)
    .maybeSingle();
  if (connection.error) return { data: null, error: connection.error };
  if (!connection.data) return { data: null, error: null };

  const [groups, active] = await Promise.all([
    client
      .from("scimGroup")
      .select(
        "id, displayName, employeeTypeId, priority, scimGroupMember(count)"
      )
      .eq("companyId", companyId)
      .order("priority")
      .order("displayName"),
    client
      .from("scimUser")
      .select("id", { count: "exact", head: true })
      .eq("companyId", companyId)
      .eq("active", true)
  ]);
  if (groups.error) return { data: null, error: groups.error };
  if (active.error) return { data: null, error: active.error };

  return {
    data: {
      connection: connection.data,
      groups: (groups.data ?? []).map(({ scimGroupMember, ...group }) => ({
        ...group,
        memberCount: scimGroupMember?.[0]?.count ?? 0
      })),
      activeCount: active.count ?? 0
    },
    error: null
  };
}

/** Both defaults must belong to the company: their tables have single-column keys. */
async function checkDefaults(
  serviceRole: SupabaseClient<Database>,
  companyId: string,
  {
    defaultEmployeeTypeId,
    defaultLocationId
  }: { defaultEmployeeTypeId: string; defaultLocationId: string }
): Promise<string | null> {
  const [type, location] = await Promise.all([
    serviceRole
      .from("employeeType")
      .select("id")
      .eq("id", defaultEmployeeTypeId)
      .eq("companyId", companyId)
      .maybeSingle(),
    serviceRole
      .from("location")
      .select("id")
      .eq("id", defaultLocationId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (type.error || !type.data) return "Employee type not found";
  if (location.error || !location.data) return "Location not found";
  return null;
}

export async function createScimConnection(
  serviceRole: SupabaseClient<Database>,
  input: {
    companyId: string;
    userId: string;
    identityProvider: IdentityProvider;
    defaultEmployeeTypeId: string;
    defaultLocationId: string;
  }
): Promise<Result<{ token: string }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const refusal = await checkDefaults(serviceRole, input.companyId, input);
  if (refusal) return { data: null, error: refusal };

  const { token, tokenHash, tokenPreview } = generateScimToken();
  const inserted = await serviceRole.from("scimConnection").insert({
    companyId: input.companyId,
    identityProvider: input.identityProvider,
    defaultEmployeeTypeId: input.defaultEmployeeTypeId,
    defaultLocationId: input.defaultLocationId,
    tokenHash,
    tokenPreview,
    createdBy: input.userId
  });
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      return { data: null, error: "SCIM is already set up for this company." };
    }
    logger.error("Failed to create the SCIM connection", {
      companyId: input.companyId,
      error: inserted.error
    });
    return { data: null, error: "Failed to set up SCIM" };
  }

  return { data: { token }, error: null };
}

export async function updateScimConnection(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    identityProvider: IdentityProvider;
    defaultEmployeeTypeId: string;
    defaultLocationId: string;
  }
): Promise<Result<{ changed: number }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const refusal = await checkDefaults(serviceRole, input.companyId, input);
  if (refusal) return { data: null, error: refusal };

  const updated = await serviceRole
    .from("scimConnection")
    .update({
      identityProvider: input.identityProvider,
      defaultEmployeeTypeId: input.defaultEmployeeTypeId,
      defaultLocationId: input.defaultLocationId,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId)
    .select("*")
    .maybeSingle();
  if (updated.error || !updated.data) {
    logger.error("Failed to update the SCIM connection", {
      companyId: input.companyId,
      error: updated.error
    });
    return { data: null, error: "Failed to update SCIM" };
  }

  // A new default type moves everyone in no mapped group.
  const reconciled = await reconcileEmployeeTypes(db, serviceRole, {
    connection: updated.data
  });
  return { data: reconciled, error: null };
}

export async function regenerateScimToken(
  serviceRole: SupabaseClient<Database>,
  input: { companyId: string; userId: string }
): Promise<Result<{ token: string }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  const { token, tokenHash, tokenPreview } = generateScimToken();
  const updated = await serviceRole
    .from("scimConnection")
    .update({
      tokenHash,
      tokenPreview,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("companyId", input.companyId)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data) {
    logger.error("Failed to regenerate the SCIM token", {
      companyId: input.companyId,
      error: updated.error
    });
    return { data: null, error: "Failed to regenerate the SCIM token" };
  }

  return { data: { token }, error: null };
}

/**
 * Turn SCIM off: the connection and its SCIM rows go; every Carbon user,
 * membership and employee stays as it is. Not gated, so a company that lost
 * the plan can still stop its IdP.
 */
export async function deleteScimConnection(
  serviceRole: SupabaseClient<Database>,
  input: { companyId: string }
): Promise<Result<true>> {
  const deleted = await serviceRole
    .from("scimConnection")
    .delete()
    .eq("companyId", input.companyId);
  if (deleted.error) {
    logger.error("Failed to delete the SCIM connection", {
      companyId: input.companyId,
      error: deleted.error
    });
    return { data: null, error: "Failed to turn off SCIM" };
  }
  return { data: true, error: null };
}

export async function updateScimGroupMapping(
  serviceRole: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  input: {
    companyId: string;
    userId: string;
    groupId: string;
    employeeTypeId: string | null;
    priority: number;
  }
): Promise<Result<{ changed: number }>> {
  await requireEntitlement(serviceRole, input.companyId, "SCIM");

  if (input.employeeTypeId) {
    const type = await serviceRole
      .from("employeeType")
      .select("id")
      .eq("id", input.employeeTypeId)
      .eq("companyId", input.companyId)
      .maybeSingle();
    if (type.error || !type.data) {
      return { data: null, error: "Employee type not found" };
    }
  }

  const updated = await serviceRole
    .from("scimGroup")
    .update({
      employeeTypeId: input.employeeTypeId,
      priority: input.priority,
      updatedBy: input.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", input.groupId)
    .eq("companyId", input.companyId)
    .select("id")
    .maybeSingle();
  if (updated.error || !updated.data) {
    logger.error("Failed to update the SCIM group mapping", {
      companyId: input.companyId,
      groupId: input.groupId,
      error: updated.error
    });
    return { data: null, error: "Group not found" };
  }

  const connection = await serviceRole
    .from("scimConnection")
    .select("*")
    .eq("companyId", input.companyId)
    .single();
  if (connection.error) {
    return { data: null, error: "SCIM is not set up for this company" };
  }

  // A priority or mapping change can move anyone in any mapped group.
  const reconciled = await reconcileEmployeeTypes(db, serviceRole, {
    connection: connection.data
  });
  return { data: reconciled, error: null };
}
