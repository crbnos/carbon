// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import { SINGLE_TENANT } from "@carbon/env";
import { sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Business) API-key AUTHORING — creating, editing, and deleting a
 * company's public-API keys, gated to the Business plan via the `API_KEYS`
 * feature. The runtime VERIFICATION path (`@carbon/auth`
 * `api-key.server.ts` / the `api+/v1+` authenticator) is a separate concern and
 * is NOT gated here — an already-issued key keeps authenticating regardless of
 * plan.
 *
 * The key is generated and hashed in the open route action (server-only:
 * `hashApiKey` from `@carbon/auth/auth.server` + `nanoid`); this function only
 * receives the already-computed `rawKey`/`keyHash`/`keyPreview` and stores the
 * hash, so no crypto crosses the package boundary.
 *
 * The entitlement LOCK lives INSIDE this commercial function (see
 * `entitlements.server`) so it cannot be stripped from open-licensed app code.
 */

// Minimal input shape — the validator's `Omit<…, "id" | "scopes" | "expiresAt">`
// leaves `name` and `rateLimit` (redefined here so `@carbon/ee` never imports `~/`).
type ApiKeyInput = { name: string; rateLimit?: number };

/**
 * A key's requests per minute is the platform's to set on Carbon Cloud, where
 * companies share the servers. A single-tenant deployment (BYOC, self-hosted)
 * runs on its owner's servers, so its admins set it.
 */
function ownRateLimit(rateLimit: number | undefined) {
  return SINGLE_TENANT && rateLimit ? { rateLimit } : {};
}

export async function upsertApiKey(
  client: SupabaseClient<Database>,
  apiKey:
    | (ApiKeyInput & {
        createdBy: string;
        companyId: string;
        scopes: Record<string, string[]>;
        expiresAt?: string;
        rawKey: string;
        keyHash: string;
        keyPreview: string;
      })
    | (ApiKeyInput & {
        id: string;
        scopes: Record<string, string[]>;
        expiresAt?: string;
      })
) {
  if ("createdBy" in apiKey) {
    await requireEntitlement(client, apiKey.companyId, "API_KEYS");
    // Create: store the hash, return the raw key (caller generates both)
    // The window is always the platform's; the limit is too off single tenant.
    const {
      scopes,
      expiresAt,
      rawKey,
      keyHash,
      rateLimit,
      rateLimitWindow: _rlw,
      ...rest
    } = apiKey as any;

    const result = await client
      .from("apiKey")
      .insert(
        sanitize({
          ...rest,
          ...ownRateLimit(rateLimit),
          keyHash,
          scopes: scopes as any,
          expiresAt: expiresAt || null
        }) as any
      )
      .select("id")
      .single();

    if (result.error) {
      return { data: null, error: result.error };
    }

    // Return the raw key (shown to user once, never stored)
    return { data: { key: rawKey, id: result.data.id }, error: null };
  }

  // The update input carries no companyId — read it from the row so the
  // entitlement check (the lock) can run before the write.
  const existing = await client
    .from("apiKey")
    .select("companyId")
    .eq("id", apiKey.id)
    .single();

  if (existing.error || !existing.data) {
    return {
      data: null,
      error: existing.error || { message: "API key not found" }
    };
  }

  await requireEntitlement(client, existing.data.companyId, "API_KEYS");

  // Update: update name, scopes, expiration (never the key itself)
  // The window is always the platform's; the limit is too off single tenant.
  const {
    scopes,
    expiresAt,
    rateLimit,
    rateLimitWindow: _rlw,
    ...rest
  } = apiKey as any;
  return client
    .from("apiKey")
    .update(
      sanitize({
        ...rest,
        ...ownRateLimit(rateLimit),
        scopes: scopes as any,
        expiresAt: expiresAt || null
      }) as any
    )
    .eq("id", apiKey.id);
}

export async function deleteApiKey(
  client: SupabaseClient<Database>,
  id: string
) {
  // The input carries no companyId — read it from the row so the entitlement
  // check (the lock) can run before the delete.
  const existing = await client
    .from("apiKey")
    .select("companyId")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return {
      data: null,
      error: existing.error || { message: "API key not found" }
    };
  }

  await requireEntitlement(client, existing.data.companyId, "API_KEYS");
  return client.from("apiKey").delete().eq("id", id);
}
