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

/**
 * A connection as the owner. Call inside every step, never once per run.
 *
 * Cached briefly, because `contextFor` asks once per node AND again per batch
 * item, so a 100-item batch would otherwise sign ~101 JWTs. The TTL sits inside the token's
 * own five-minute life, so a long run still re-mints rather than carrying an
 * expiring token, and a revoked permission is picked up within the minute.
 */
const CLIENT_TTL_MS = 60_000;
const ownerClients = new Map<
  string,
  { client: SupabaseClient<Database>; mintedAt: number }
>();

export async function getOwnerClient(
  ownerId: string,
  runId: string
): Promise<SupabaseClient<Database>> {
  const key = `${ownerId}:${runId}`;
  const now = Date.now();
  const cached = ownerClients.get(key);
  if (cached !== undefined && now - cached.mintedAt < CLIENT_TTL_MS) {
    return cached.client;
  }

  // The run tag is not optional: an untagged write blinds the origin filter and loop guards.
  const client = await getUserScopedClient(ownerId, { workflowRunId: runId });

  // Bounded: one entry per in-flight run, and stale ones are dropped on the way past.
  for (const [otherKey, entry] of ownerClients) {
    if (now - entry.mintedAt >= CLIENT_TTL_MS) ownerClients.delete(otherKey);
  }
  ownerClients.set(key, { client, mintedAt: now });
  return client;
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
