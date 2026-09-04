import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import {
  getIntegrationConfigById,
  type IntegrationID,
  resolveIntegrationSecrets,
  splitSecrets
} from "@carbon/ee";
import { getIntegrationServerHooks } from "@carbon/ee/hooks.server";
import {
  connectionsHealthy,
  needsReconnect,
  readConnections
} from "@carbon/ee/integrations/connections";
import { PIECE_ALLOWLIST, requiredScopesFor } from "@carbon/jobs/integrations";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Integration } from "~/modules/settings/types";
import { sanitize } from "~/utils/supabase";
import type { customFieldValidator } from "./settings.models";

const INTEGRATION_CACHE_TTL = 3600;
const logger = getLogger("erp", "settings");

export async function clearCustomFieldsCache(companyId?: string) {
  const keys = companyId ? `customFields:${companyId}:*` : "customFields:*";
  redis.keys(keys).then(function (keys) {
    const pipeline = redis.pipeline();
    keys.forEach(function (key) {
      pipeline.del(key);
    });
    return pipeline.exec();
  });
}

export async function clearCompanyIntegrationCache(
  companyId: string
): Promise<void> {
  const cacheKey = `integrations:${companyId}`;

  try {
    // Clear both old and new key formats
    await redis.del(cacheKey, `json:${cacheKey}`);
  } catch (error) {
    logger.error("Redis cache invalidation error", { error });
  }
}

export async function clearAllIntegrationCaches(): Promise<void> {
  try {
    // Clear both old and new key patterns
    const oldPattern = "integrations:*";
    const newPattern = "json:integrations:*";

    const [oldKeys, newKeys] = await Promise.all([
      redis.keys(oldPattern),
      redis.keys(newPattern)
    ]);

    const allKeys = [...oldKeys, ...newKeys];
    if (allKeys.length > 0) {
      logger.info("Clearing integration cache entries", {
        count: allKeys.length
      });
      await redis.del(...allKeys);
    }
  } catch (error) {
    logger.error("Error clearing all integration caches", { error });
  }
}

export async function deactivateIntegration(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    updatedBy: string;
  }
) {
  const { id, companyId, updatedBy } = args;

  const result = await client
    .from("companyIntegration")
    .update({
      active: false,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id)
    .eq("companyId", companyId);

  if (result.error) {
    return result;
  }

  await clearCompanyIntegrationCache(companyId);

  return result;
}

export async function deleteCustomField(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  try {
    clearCustomFieldsCache(companyId);
  } finally {
    return client.from("customField").delete().eq("id", id);
  }
}

interface CompanyIntegration {
  id: string;
  companyId: string;
  metadata: Record<string, any>;
  active: boolean;
}

export async function getCompanyIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<CompanyIntegration[]> {
  const cacheKey = `integrations:${companyId}`;

  try {
    // Try the new prefixed key first
    let cached = await redis.get(`json:${cacheKey}`);
    if (cached && typeof cached === "string") {
      try {
        return JSON.parse(cached);
      } catch (parseError) {
        logger.error("JSON parse error for prefixed cache key", {
          cacheKey: `json:${cacheKey}`,
          error: parseError
        });
        await redis.del(`json:${cacheKey}`);
      }
    }

    // Fallback to old key format for backwards compatibility
    cached = await redis.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      // Log the type and content for debugging
      logger.info("Cache hit", {
        cacheKey,
        type: typeof cached,
        isArray: Array.isArray(cached),
        value: cached,
        constructor: cached?.constructor?.name
      });

      // Handle different response types from Upstash
      if (Array.isArray(cached)) {
        // Direct array return from Upstash
        return cached as CompanyIntegration[];
      } else if (typeof cached === "object" && cached !== null) {
        // Object return from Upstash - could be a parsed JSON already
        return cached as CompanyIntegration[];
      } else if (typeof cached === "string") {
        // String return - needs JSON parsing
        try {
          return JSON.parse(cached);
        } catch (parseError) {
          logger.error("JSON parse error for cache key", {
            cacheKey,
            error: parseError,
            cached
          });
          await redis.del(cacheKey);
        }
      } else {
        logger.warning("Unexpected cache format for key", {
          cacheKey,
          type: typeof cached,
          cached
        });
        await redis.del(cacheKey);
      }
    }
  } catch (error) {
    logger.error("Redis cache read error", { error });
    // Clear the corrupted cache entry
    try {
      await redis.del(cacheKey);
    } catch (deleteError) {
      logger.error("Failed to delete corrupted cache entry", {
        error: deleteError
      });
    }
  }

  const { data, error } = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);

  if (error) {
    throw error;
  }

  // Secret material must never reach Redis. Strip each integration's secret keys
  // into the vault-backed shape (config only) before caching AND returning, so no
  // consumer of this function depends on a plaintext secret in `metadata` (secret
  // reads go through resolveIntegrationSecrets against the row, not this cache).
  const integrations = (data || []).map((integration) => ({
    ...integration,
    metadata: splitSecrets(integration.id, integration.metadata).config
  }));

  try {
    // Force string storage to avoid Upstash automatic deserialization issues
    const serializedData = JSON.stringify(integrations);
    if (typeof serializedData === "string" && serializedData.length > 0) {
      // Use a prefixed key to ensure we know this is a JSON string
      await redis.setex(
        `json:${cacheKey}`,
        INTEGRATION_CACHE_TTL,
        serializedData
      );
    } else {
      logger.error("Failed to serialize integrations data for cache");
    }
  } catch (error) {
    logger.error("Redis cache write error", { error });
  }

  return integrations as CompanyIntegration[];
}

export async function hasIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<boolean> {
  const integrations = await getCompanyIntegrations(client, companyId);
  return integrations.some((i) => i.id === integrationId && i.active === true);
}

export async function getCompanyIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string
): Promise<CompanyIntegration | null> {
  const integrations = await getCompanyIntegrations(client, companyId);
  return (
    integrations.find((i) => i.id === integrationId && i.active === true) ||
    null
  );
}

export async function upsertCompanyIntegration(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    active: boolean;
    metadata: Json;
    companyId: string;
    updatedBy: string;
  }
) {
  // Split secret material out of the metadata: only the non-secret config is
  // written to the column; the secrets go to Supabase Vault. The row is upserted
  // FIRST (so it exists), then the vault RPC stamps `secretRef` onto it.
  const { config, secrets } = splitSecrets(update.id, update.metadata);

  const result = await client
    .from("companyIntegration")
    .upsert([{ ...update, metadata: config as Json }], {
      onConflict: "id,companyId"
    })
    .select()
    .single();

  if (result.error) {
    return result;
  }

  if (Object.keys(secrets).length > 0) {
    const serviceRole = getCarbonServiceRole();
    const { error: vaultError } = await serviceRole.rpc(
      "upsert_integration_secret",
      {
        p_company_id: update.companyId,
        p_integration_id: update.id,
        p_secret: secrets as never
      }
    );
    if (vaultError) {
      logger.error("Failed to persist integration secret to vault", {
        error: vaultError,
        id: update.id
      });
      return { ...result, data: null, error: vaultError };
    }
  }

  await clearCompanyIntegrationCache(update.companyId);

  return result;
}

/**
 * Flip an integration to installed without touching anything else on the row. The
 * piece callback marks its card installed after a connection is saved; an upsert
 * with empty metadata would wipe whatever settings the row already holds.
 */
export async function markIntegrationInstalled(
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; updatedBy: string }
): Promise<{ error: PostgrestError | null }> {
  // Read the row directly: `getCompanyIntegration` is Redis-cached and drops
  // inactive rows, and both matter here.
  const existing = await client
    .from("companyIntegration")
    .select("active")
    .eq("id", args.id)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (existing.error) return { error: existing.error };

  let error: PostgrestError | null = null;
  if (existing.data === null) {
    ({ error } = await client.from("companyIntegration").insert({
      id: args.id,
      companyId: args.companyId,
      active: true,
      metadata: {},
      updatedBy: args.updatedBy
    }));
  } else if (existing.data.active !== true) {
    ({ error } = await client
      .from("companyIntegration")
      .update({ active: true, updatedBy: args.updatedBy })
      .eq("id", args.id)
      .eq("companyId", args.companyId));
  }
  if (error === null) await clearCompanyIntegrationCache(args.companyId);
  return { error };
}

export async function upsertCustomField(
  client: SupabaseClient<Database>,
  customField:
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof customFieldValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  try {
    clearCustomFieldsCache();
  } finally {
    if ("createdBy" in customField) {
      const sortOrders = await client
        .from("customField")
        .select("sortOrder")
        .eq("table", customField.table);

      if (sortOrders.error) return sortOrders;
      const maxSortOrder = sortOrders.data.reduce((max, item) => {
        return Math.max(max, item.sortOrder);
      }, 0);

      return client
        .from("customField")
        .insert([{ ...customField, sortOrder: maxSortOrder + 1 }]);
    }
    return client
      .from("customField")
      .update(
        sanitize({
          ...customField,
          updatedBy: customField.updatedBy
        })
      )
      .eq("id", customField.id);
  }
}

export async function updateCustomFieldsSortOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  try {
    clearCustomFieldsCache();
  } finally {
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client.from("customField").update({ sortOrder, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
}

export async function getIntegrationHealth(
  companyId: string,
  integration: Integration
): Promise<Integration & { health: "healthy" | "unhealthy" | "inactive" }> {
  if (!integration.active) {
    return {
      ...integration,
      health: "inactive"
    };
  }

  const key = `integrations:${companyId}:${integration.id}:health`;

  // A workflow-piece card's health is its accounts: none revoked/expired, and none
  // predating a scope the piece now needs (its steps would fail with
  // `missing_scope`). One read serves both questions. Decided here rather than in
  // an ee hook because only this side can see the allowlist's required list, and
  // an ee hook would read the same rows a second time.
  if (PIECE_ALLOWLIST[integration.id!] !== undefined) {
    const cached = await redis.get(key);
    if (cached === "1") return { ...integration, health: "healthy" };
    if (cached === "0") return { ...integration, health: "unhealthy" };

    // A failed read is one unhealthy card, never a crashed Settings page —
    // `getIntegrationsWithHealth` runs these in a Promise.all with no catch. It
    // is not cached: the next load should re-ask rather than pin a transient
    // failure for the TTL.
    let healthy: boolean;
    try {
      const [rows, required] = await Promise.all([
        readConnections(getCarbonServiceRole(), companyId, integration.id!),
        requiredScopesFor(integration.id!)
      ]);
      healthy =
        connectionsHealthy(rows) &&
        !rows.some((row) => needsReconnect(row, required));
    } catch {
      return { ...integration, health: "unhealthy" };
    }
    // An unhealthy piece card stays unhealthy until someone reconnects, and every
    // path that changes that (callback, disconnect, uninstall) invalidates this
    // key — so a short negative cache is safe and stops the Settings grid from
    // re-reading the rows on every load.
    await redis.set(
      key,
      healthy ? "1" : "0",
      "EX",
      healthy ? INTEGRATION_CACHE_TTL * 5 : 60
    );
    return { ...integration, health: healthy ? "healthy" : "unhealthy" };
  }

  const serverHooks = getIntegrationServerHooks(integration.id!);
  const config = getIntegrationConfigById(integration.id as IntegrationID);
  const healthcheck = serverHooks?.onHealthcheck ?? config?.onHealthcheck;

  if (!healthcheck) {
    return {
      ...integration,
      health: "healthy"
    };
  }

  const cached = await redis.get(key);

  // Only cache healthy status
  if (cached === "1") {
    return {
      ...integration,
      health: "healthy"
    };
  }

  // Resolve vaulted secrets back into the metadata before the healthcheck
  // builds its provider/client. Since the secret-vault refactor, credentials no
  // longer live in the plaintext `metadata` column, so an unresolved metadata
  // authenticates with nothing and every secret-bearing healthcheck (Rillet,
  // Xero, Email) would read "unhealthy". `resolveIntegrationSecrets` looks up
  // the row's `secretRef` itself (the `integrations` view doesn't expose it) and
  // throws when the secret can't be read — treat that as unhealthy rather than
  // crashing the whole settings page.
  let resolvedMetadata: Record<string, any>;
  try {
    resolvedMetadata = (await resolveIntegrationSecrets(
      getCarbonServiceRole(),
      companyId,
      integration.id!,
      (integration.metadata as Record<string, any>) ?? {}
    )) as Record<string, any>;
  } catch {
    return {
      ...integration,
      health: "unhealthy"
    };
  }

  const status = await (
    healthcheck as (
      companyId: string,
      metadata: Record<string, any>
    ) => Promise<boolean>
  )(companyId, resolvedMetadata);

  await redis.set(key, status ? "1" : "0", "EX", INTEGRATION_CACHE_TTL * 5); // Cache for 5 minutes

  return {
    ...integration,
    health: status ? "healthy" : "unhealthy"
  };
}

export async function getIntegrationsWithHealth(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const results = await client
    .from("integrations")
    .select("*")
    .eq("companyId", companyId);

  if (results.error) return results;

  const integrations = results.data;

  const withHealth = await Promise.all(
    integrations.map((i) => getIntegrationHealth(companyId, i))
  );

  return {
    data: withHealth,
    error: null
  };
}

export async function invalidateIntegrationHealthCache(
  integrationId: string,
  companyId: string
) {
  const key = `integrations:${companyId}:${integrationId}:health`;

  return await redis.del(key);
}

// Server-only (needs the service-role client for the Vault RPC). Lives here rather
// than in settings.service.ts because that file is re-exported by the client barrel;
// a client.server import there would leak the service-role client into the browser
// bundle. Reached by the MCP direct-executor, which imports this module server-side.
export async function updateIntegrationMetadata(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: any,
  updatedBy?: string
) {
  // Split secret material out to Supabase Vault; only the non-secret config is
  // written to the column. The row already exists (this is an update), so vault
  // FIRST (fail-closed: if the vault write fails, the plaintext is left intact
  // rather than stripped-and-lost), then write the stripped config.
  const { config, secrets } = splitSecrets(integrationId, metadata);

  if (Object.keys(secrets).length > 0) {
    const serviceRole = getCarbonServiceRole();
    const { error } = await serviceRole.rpc("upsert_integration_secret", {
      p_company_id: companyId,
      p_integration_id: integrationId,
      p_secret: secrets as never
    });
    if (error) {
      return { data: null, error };
    }
  }

  return client
    .from("companyIntegration")
    .update(
      sanitize({
        metadata: config as Json,
        updatedAt: new Date().toISOString(),
        updatedBy
      })
    )
    .eq("companyId", companyId)
    .eq("id", integrationId);
}
