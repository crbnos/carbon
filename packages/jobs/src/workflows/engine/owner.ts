// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getUserScopedClient } from "@carbon/auth/client.server";
import { readClaimsFresh } from "@carbon/auth/users";
import type { Database } from "@carbon/database";
import {
  admits,
  type Claims,
  type ExpandedClaims,
  type Gate,
  holdsGate,
  MODULES,
  moduleOf,
  pageById,
  userActor
} from "@carbon/database/access";
import { gatePages } from "@carbon/ee/workflows";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("workflows");

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

/**
 * The permissions a workflow may act with: the owner's, while the owner is an
 * employee of the company. A customer or supplier portal account runs nothing.
 */
export function ownerPermissionsOf(
  claims: Claims,
  companyId: string
): ExpandedClaims | null {
  if (!admits(userActor(claims), companyId, "employee")) return null;
  return claims.permissions;
}

/**
 * The one wording for a lost permission: the gate's page label, or its module's
 * label when the gate names several pages of one shared table.
 */
function noAccess(gate: Gate): string {
  const pages = gatePages(gate);
  const first: string = pages[0] ?? "";
  const page = pages.length === 1 ? pageById(first) : undefined;
  const area =
    page?.label ??
    MODULES.find((module) => module.id === moduleOf(first))?.label ??
    first.charAt(0).toUpperCase() + first.slice(1);
  return `The owner of this workflow no longer has access to ${area}.`;
}

/** Why the owner may not pass `gate` in the company, or `null` when they may
 * (or when there is no gate). The engine and the builder's test-run route both
 * refuse with it, so the check and its wording are written once. */
export function ownerRefusal(
  gate: Gate | undefined,
  permissions: ExpandedClaims,
  companyId: string
): string | null {
  if (gate === undefined || holdsGate(permissions, gate, companyId)) {
    return null;
  }
  return noAccess(gate);
}

/** Not `getUserClaims`: that reads privileged, through a cache that a failed
 * clear leaves stale for up to an hour. This asks as the owner, uncached. */
export async function readOwnerPermissions(
  client: SupabaseClient<Database>,
  ownerId: string,
  companyId: string
): Promise<ExpandedClaims | null> {
  let claims: Claims;
  try {
    claims = await readClaimsFresh(client, ownerId, companyId);
  } catch (error) {
    log.error("Failed to read workflow owner claims", {
      ownerId,
      companyId,
      error
    });
    return null;
  }

  const permissions = ownerPermissionsOf(claims, companyId);
  if (permissions === null) {
    log.warn("Workflow owner is not an employee of the company", {
      ownerId,
      companyId,
      role: claims.role
    });
  }
  return permissions;
}
