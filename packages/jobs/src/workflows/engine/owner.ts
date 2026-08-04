import {
  getClaims,
  makePermissionsFromClaims,
  type Permission
} from "@carbon/auth";
import { getUserScopedClient } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { PermissionAction } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("workflows");

export type OwnerPermissions = Record<string, Permission>;

/** A fresh five-minute connection as the owner. Call inside every step, never once per run. */
export async function getOwnerClient(
  ownerId: string,
  runId: string
): Promise<SupabaseClient<Database>> {
  // The run tag is not optional: an untagged write blinds the origin filter and loop guards.
  return getUserScopedClient(ownerId, { workflowRunId: runId });
}

/** Not `getUserClaims`: that reads privileged, through a one-hour cache, so a
 * revoked permission would survive an hour. This asks as the owner. */
export async function readOwnerPermissions(
  client: SupabaseClient<Database>,
  ownerId: string,
  companyId: string
): Promise<OwnerPermissions | null> {
  const rawClaims = await getClaims(client, ownerId, companyId);

  if (rawClaims.error || rawClaims.data === null) {
    log.error("Failed to read workflow owner claims", {
      ownerId,
      companyId,
      error: rawClaims.error
    });
    return null;
  }

  const claims = makePermissionsFromClaims(rawClaims.data as Json[]);
  return claims?.permissions ?? null;
}

export function hasPermission(
  permissions: OwnerPermissions,
  module: string,
  action: PermissionAction,
  companyId: string
): boolean {
  const granted = permissions[module]?.[action];
  if (!Array.isArray(granted)) return false;
  // "0" is the wildcard for all companies.
  return granted.includes("0") || granted.includes(companyId);
}
