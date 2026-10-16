// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { bustApiKeyCache, hashApiKey } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import {
  blockSchema,
  type DocumentBlock,
  type DocumentSettings,
  type DocumentTheme,
  documentSectionPlacementSchema,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  sectionConfigSchema,
  themeSchema
} from "@carbon/documents/template";
import {
  integrations as availableIntegrations,
  getIntegrationConfigById,
  getIntegrationIdsByRole,
  type IntegrationHealthcheckResult,
  type IntegrationID,
  resolveIntegrationSecrets,
  splitSecrets
} from "@carbon/ee";
import { isAccountingSyncEnabled } from "@carbon/ee/accounting";
import { deleteApiKey, upsertApiKey } from "@carbon/ee/api-keys.server";
import {
  disableAuditLog,
  enableAuditLog,
  getArchiveDownloadUrl
} from "@carbon/ee/audit.server";
import { updateConsoleSetting } from "@carbon/ee/console.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { getIntegrationServerHooks } from "@carbon/ee/hooks.server";
import { isIntegrationWhitelisted } from "@carbon/ee/plan";
import { companyHasFeature } from "@carbon/ee/plan.server";
import { patchRampSettings } from "@carbon/ee/ramp.server";
import { updateRequireMfaSetting } from "@carbon/ee/two-factor.server";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import {
  createPrintJob,
  deletePrinterRoute,
  getPrintingSettings,
  getPrintJob,
  getPrintJobContent,
  type PrintingSettings,
  printerRouteValidator,
  reprintValidator,
  setContextAssignment,
  updateAssignmentValidator,
  updatePrintingSettings,
  upsertPrinterRoute
} from "@carbon/printing";
import { invalidatePrinterCache } from "@carbon/printing/printing.server";
import type { JSONContent } from "@carbon/react";
import { serverFns } from "@carbon/server-functions";
import { getStripeConnectAccountId } from "@carbon/stripe/send-sales-invoice.server";
import { getBillingPortalRedirectUrl } from "@carbon/stripe/stripe.server";
import {
  datetime,
  isInternalEmail,
  labelSizes,
  unchecked
} from "@carbon/utils";
import { parseTime } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { z } from "zod";
import { plmReleaseControl } from "~/modules/items/items.models";
import { insertEmployeeJob } from "~/modules/people/people.service";
import { upsertLocation } from "~/modules/resources/resources.service";
import {
  type CarbonError,
  defineServiceFn,
  type ErrorCategory,
  type ServiceContext
} from "~/modules/service-fn.server";
import type { Integration } from "~/modules/settings/types";
import { isActiveCompanyEmployee } from "~/modules/shared/shared.server";
import { invalidateCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getPermissionCacheKey } from "~/modules/users/users.server";
import { sendMfaRequiredEmails } from "~/services/mfa-email.server";
import { sanitize } from "~/utils/supabase";
import { oeeDevicesCacheKey } from "./oee-devices-cache";
import {
  apiKeyValidator,
  calculatedShelfLifeInputScopes,
  companyValidator,
  type customFieldValidator,
  expiredEntityPolicies,
  incompletePickingListPolicies,
  invoiceAutomations,
  kanbanOutputTypes,
  purchasePriceUpdateTimingTypes,
  returnPickedMaterialTimings,
  subsidiaryValidator
} from "./settings.models";
import {
  deleteDocumentSection,
  insertCompany,
  resolveSections,
  seedCompany,
  setLocationResponsibleEmployee,
  updateCompany,
  updateCompanyWithBaseCurrencyChange,
  updateSubsidiary,
  upsertDocumentSection,
  upsertDocumentTemplate,
  upsertItemPostingGroupResponsibility
} from "./settings.service";

const INTEGRATION_CACHE_TTL = 3600;
const logger = getLogger("erp", "settings");

/**
 * Drop the cached auth record for an API key so a scope change or revocation
 * takes effect immediately in the common case. An in-flight auth read can still
 * re-prime the cache with the pre-write row, so the hard bound is the 30s TTL —
 * callers that delete the row should bust AGAIN after the delete commits, using
 * the returned keyHash (unreadable from the DB once the row is gone).
 *
 * Service-role on purpose: apiKey's RLS SELECT requires `settings_view`, but the
 * routes that revoke or rescope a key gate on `users_update`, so the caller's own
 * client cannot see the row and the bust would silently do nothing.
 */
export async function invalidateApiKeyCache(
  id: string,
  companyId: string
): Promise<string | null> {
  const { data, error } = await getCarbonServiceRole()
    .from("apiKey")
    .select("keyHash")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  // A failed lookup is indistinguishable from a missing row at the return type,
  // and neither may block the revoke — log it so a stale scope surviving its TTL
  // is diagnosable rather than silent.
  if (error) {
    logger.error("Failed to read api key for cache bust", {
      error,
      id,
      companyId
    });
  }
  if (!data?.keyHash) return null;
  await bustApiKeyCache(data.keyHash);
  return data.keyHash;
}

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
    // Clear both old and new key formats, and the OEE device lists: a new API
    // key or environment can name different stations.
    await redis.del(
      cacheKey,
      `json:${cacheKey}`,
      ...getIntegrationIdsByRole("oee").map((integrationId) =>
        oeeDevicesCacheKey(companyId, integrationId)
      )
    );
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

export async function getSlackIntegration(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ token: string; channelId?: string } | null> {
  // The Redis cache (getCompanyIntegration) no longer holds secret material, so
  // read the row directly with a service-role client — required both to resolve
  // the vaulted access_token and, in the transitional window, to see the plaintext
  // still in the column.
  const serviceRole = getCarbonServiceRole();
  const { data: integration } = await serviceRole
    .from("companyIntegration")
    .select("metadata, secretRef, active")
    .eq("companyId", companyId)
    .eq("id", "slack")
    .maybeSingle();

  if (!integration?.active || !integration.metadata) {
    return null;
  }

  const metadata = (await resolveIntegrationSecrets(
    serviceRole,
    companyId,
    "slack",
    integration.metadata,
    integration.secretRef
  )) as any;

  if (!metadata.access_token) {
    return null;
  }

  return {
    token: metadata.access_token,
    channelId: metadata.channel_id || metadata.default_channel_id
  };
}

export async function hasSlackIntegration(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<boolean> {
  return hasIntegration(client, companyId, "slack");
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
  if (update.id === "ramp") {
    try {
      const data = await patchRampSettings(
        getCarbonServiceRole(),
        update.companyId,
        {
          metadata: update.metadata as Record<string, unknown>,
          active: update.active,
          updatedBy: update.updatedBy
        }
      );
      await clearCompanyIntegrationCache(update.companyId);
      return { data, error: null };
    } catch (error) {
      logger.error("Failed to atomically patch Ramp settings", {
        error,
        companyId: update.companyId
      });
      return { data: null, error };
    }
  }

  // Split secret material out of the metadata: only the non-secret config is
  // written to the column; the secrets go to Supabase Vault. The row is upserted
  // FIRST (so it exists), then the vault RPC stamps `secretRef` onto it.
  // `secrets` is a PARTIAL bag — splitSecrets omits untouched masked fields — so
  // `upsert_integration_secret` MERGES it into the stored bag (an omitted secret
  // keeps its value). A full replace here silently wiped a multi-secret
  // integration's other credential on a partial save.
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

export type IntegrationHealthStatus =
  | "healthy"
  | "unhealthy"
  | "inactive"
  | "sync-off";

type IntegrationHealthFields = {
  health: IntegrationHealthStatus;
  /** Why an unhealthy check failed, when the integration says. */
  healthReason: string | null;
};

/**
 * Connection health, plus `sync-off` for an accounting integration whose
 * connection works but whose sync switch is off (a new connection still being
 * set up, or one switched off since). A broken connection still reads
 * `unhealthy` — that is the more urgent thing to show.
 */
export async function getIntegrationHealth(
  companyId: string,
  integration: Integration
): Promise<Integration & IntegrationHealthFields> {
  const result = await getConnectionHealth(companyId, integration);
  if (
    result.health === "healthy" &&
    (getIntegrationIdsByRole("accounting") as string[]).includes(
      integration.id ?? ""
    ) &&
    !isAccountingSyncEnabled(integration.metadata)
  ) {
    return { ...result, health: "sync-off" };
  }
  return result;
}

async function getConnectionHealth(
  companyId: string,
  integration: Integration
): Promise<
  Integration &
    IntegrationHealthFields & { health: "healthy" | "unhealthy" | "inactive" }
> {
  if (!integration.active) {
    return {
      ...integration,
      health: "inactive",
      healthReason: null
    };
  }

  const serverHooks = getIntegrationServerHooks(integration.id!);
  const config = getIntegrationConfigById(integration.id as IntegrationID);
  const healthcheck = serverHooks?.onHealthcheck ?? config?.onHealthcheck;

  if (!healthcheck) {
    return {
      ...integration,
      health: "healthy",
      healthReason: null
    };
  }

  const key = `integrations:${companyId}:${integration.id}:health`;

  const cached = await redis.get(key);

  // Only cache healthy status
  if (cached === "1") {
    return {
      ...integration,
      health: "healthy",
      healthReason: null
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
      health: "unhealthy",
      healthReason: null
    };
  }

  const result = await (
    healthcheck as (
      companyId: string,
      metadata: Record<string, any>
    ) => Promise<boolean | IntegrationHealthcheckResult>
  )(companyId, resolvedMetadata);
  const healthy = typeof result === "boolean" ? result : result.healthy;
  const reason = typeof result === "boolean" ? null : (result.reason ?? null);

  await redis.set(key, healthy ? "1" : "0", "EX", INTEGRATION_CACHE_TTL * 5); // Cache for 5 hours

  return {
    ...integration,
    health: healthy ? "healthy" : "unhealthy",
    healthReason: healthy ? null : reason
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
// bundle. Reached by the Carbon API registry (api+/v1+/lib/registry.server.ts),
// which imports this module server-side.
export async function updateIntegrationMetadata(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: any,
  updatedBy?: string
) {
  if (integrationId === "ramp") {
    try {
      const data = await patchRampSettings(getCarbonServiceRole(), companyId, {
        metadata: metadata as Record<string, unknown>,
        updatedBy
      });
      await clearCompanyIntegrationCache(companyId);
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

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

/**
 * Where a sync operation's `entityId` resolves to a human-readable document
 * number, per `entityType` (the keys of the accounting sync engine's
 * `ENTITY_DEFINITIONS`). `employee` and `inventoryAdjustment` are absent on
 * purpose: the first is a `user` id with no readable column of its own, the
 * second an `itemLedger` row with no document number at all.
 */
const SYNC_ENTITY_READABLE_ID_SOURCES: Record<
  string,
  { table: string; column: string }
> = {
  customer: { table: "customer", column: "name" },
  vendor: { table: "supplier", column: "name" },
  item: { table: "item", column: "readableId" },
  purchaseOrder: { table: "purchaseOrder", column: "purchaseOrderId" },
  bill: { table: "purchaseInvoice", column: "invoiceId" },
  salesOrder: { table: "salesOrder", column: "salesOrderId" },
  invoice: { table: "salesInvoice", column: "invoiceId" },
  payment: { table: "payment", column: "paymentId" },
  charge: { table: "charge", column: "chargeId" },
  reimbursement: { table: "reimbursement", column: "reimbursementId" },
  journalEntry: { table: "journal", column: "journalEntryId" },
  // One table, two entity types — the sweep splits `memo` by party.
  creditMemo: { table: "memo", column: "memoId" },
  supplierCredit: { table: "memo", column: "memoId" }
};

const JOURNAL_REVERSAL_SUFFIX = ":reversal";
const DAILY_CONSOLIDATION_PREFIX = "daily:";

/** The fields of a sync operation this resolver reads. */
type SyncOperationReference = {
  integration: string;
  entityType: string;
  entityId: string;
  direction: string;
};

/**
 * The lookup key, built identically here and in `SyncActivity`'s
 * `getEntityReference`.
 */
function syncOperationReadableIdKey(operation: {
  entityType: string;
  entityId: string;
}) {
  return `${operation.entityType}:${operation.entityId}`;
}

/**
 * A pulled operation is keyed by the PROVIDER's remote id, so it only
 * reaches a Carbon row through `externalIntegrationMapping`. One query for
 * the whole page, keyed back by `entityType:externalId`.
 */
async function getPulledEntityIds(
  client: SupabaseClient<Database>,
  companyId: string,
  operations: SyncOperationReference[]
): Promise<Map<string, string>> {
  const pulled = operations.filter(
    (operation) =>
      operation.direction === "pull-from-accounting" &&
      operation.entityType in SYNC_ENTITY_READABLE_ID_SOURCES
  );
  if (pulled.length === 0) return new Map();

  const { data, error } = await client
    .from("externalIntegrationMapping")
    .select("entityType, entityId, externalId")
    .eq("companyId", companyId)
    .in("integration", [
      ...new Set(pulled.map((operation) => operation.integration))
    ])
    .in("entityType", [
      ...new Set(pulled.map((operation) => operation.entityType))
    ])
    .in("externalId", [
      ...new Set(pulled.map((operation) => operation.entityId))
    ]);

  if (error || !data) return new Map();

  return new Map(
    data.map((row) => [`${row.entityType}:${row.externalId}`, row.entityId])
  );
}

/**
 * Resolve one page of sync operations to the document numbers a human reads
 * — `PO000001` rather than `po_6UyRfXggN6YrmCSauBaVf1`. One query per entity
 * type on the page (plus one for pulled records' mappings), never one per
 * row.
 *
 * Silently incomplete by design, and the caller falls back to the raw id: a
 * pulled record that never landed a Carbon row has only the provider's
 * remote id, a pulled payment's id is a composite of two remote ids, and a
 * daily-consolidation journal marker backs no row at all.
 *
 * `recordId` is the CARBON row id — the same as `entityId` for a push, the
 * mapped id for a pull — so the table's link goes somewhere real instead of
 * to the provider's remote id.
 */
export async function getSyncOperationReadableIds(
  client: SupabaseClient<Database>,
  companyId: string,
  operations: SyncOperationReference[]
): Promise<Record<string, { label: string; recordId: string }>> {
  const pulledEntityIds = await getPulledEntityIds(
    client,
    companyId,
    operations
  );

  // entityType -> the ids to look up, mapped back to the operation keys they
  // came from (a journal reversal's id is the journal's id plus a suffix, so
  // one row can answer two keys).
  const byEntityType = new Map<string, Map<string, string[]>>();

  for (const operation of operations) {
    if (!(operation.entityType in SYNC_ENTITY_READABLE_ID_SOURCES)) continue;

    let lookupId =
      pulledEntityIds.get(syncOperationReadableIdKey(operation)) ??
      operation.entityId;

    if (operation.entityType === "journalEntry") {
      if (lookupId.startsWith(DAILY_CONSOLIDATION_PREFIX)) continue;
      if (lookupId.endsWith(JOURNAL_REVERSAL_SUFFIX)) {
        lookupId = lookupId.slice(0, -JOURNAL_REVERSAL_SUFFIX.length);
      }
    } else if (lookupId.includes(":")) {
      // A pulled payment's composite remote id — no Carbon row behind it.
      continue;
    }

    const ids = byEntityType.get(operation.entityType) ?? new Map();
    ids.set(lookupId, [
      ...(ids.get(lookupId) ?? []),
      syncOperationReadableIdKey(operation)
    ]);
    byEntityType.set(operation.entityType, ids);
  }

  if (byEntityType.size === 0) return {};

  const results = await Promise.all(
    Array.from(byEntityType.entries()).map(async ([entityType, ids]) => {
      const source = SYNC_ENTITY_READABLE_ID_SOURCES[entityType]!;
      // The table and column are chosen from the const map above, never from
      // request input — but they are values, so the select string can't be
      // typed. Cast, the same way the tie-out read in the route does.
      const { data, error } = (await (client.from(source.table as any) as any)
        .select(`id, ${source.column}`)
        .eq("companyId", companyId)
        .in("id", Array.from(ids.keys()))) as {
        data: { id: string }[] | null;
        error: unknown;
      };

      if (error || !data)
        return [] as [string, { label: string; recordId: string }][];

      return data.flatMap((row) => {
        const value = (row as Record<string, unknown>)[source.column];
        if (typeof value !== "string" || value.length === 0) return [];
        return (ids.get(row.id) ?? []).map(
          (key): [string, { label: string; recordId: string }] => [
            key,
            {
              label: key.endsWith(JOURNAL_REVERSAL_SUFFIX)
                ? `${value} (reversal)`
                : value,
              recordId: row.id
            }
          ]
        );
      });
    })
  );

  return Object.fromEntries(results.flat());
}

// ─── Operations (`defineServiceFn`) ─────────────────────────────────────────
// What the routes, the API and MCP all run. A settings page has ONE update
// operation: it takes the page's fields, all optional, and writes the ones
// sent. An absent field keeps its stored value, so one form never blanks a
// neighbouring setting.

type CompanySettingsUpdate =
  Database["public"]["Tables"]["companySettings"]["Update"];

const notificationGroup = z.array(z.string().min(1));

const billingAddressInput = z.object({
  name: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional(),
  email: z.string().email().nullable().optional()
});

/** The fields the caller sent: an absent (undefined) one is left out. */
function sentFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function nothingSent(ctx: ServiceContext, input: object): CarbonError | null {
  return Object.keys(sentFields(input)).length === 0
    ? ctx.error("validation", "Send at least one setting to change")
    : null;
}

/** Writes the sent fields to the company's settings row, as the caller. */
async function saveCompanySettings(
  ctx: ServiceContext,
  fields: CompanySettingsUpdate,
  failure: string
): Promise<CarbonError | null> {
  const changes = sentFields(fields);
  if (Object.keys(changes).length === 0) return null;
  const { error } = await ctx.asCaller.supabase
    .from("companySettings")
    .update(changes)
    .eq("id", ctx.company.id);
  return error ? ctx.error("internal", failure, error) : null;
}

/** A server function's refusal as this function's error: its status picks
 *  the category, and an empty message (a data-layer failure) is `fallback`. */
function fromServerFn(
  ctx: ServiceContext,
  error: { status: number; message: string },
  fallback: string
): CarbonError {
  const category: ErrorCategory =
    error.status === 400
      ? "validation"
      : error.status === 403
        ? "forbidden"
        : error.status === 404
          ? "notFound"
          : error.status === 409
            ? "conflict"
            : error.status < 500
              ? "rule"
              : "internal";
  return ctx.error(category, error.message || fallback, error);
}

/**
 * Update the accounting settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether money shows its
 * trailing zeros, the fixed-asset tax depreciation (on or off, its rate, and
 * the deferred tax liability and expense accounts on the company's account
 * defaults), and the ASC 842 lease policy (the classification thresholds,
 * the default lessor discount rate and lessee incremental borrowing rate in
 * percentage points, the short-term lease expedient, and how many days ahead
 * a lease's owner is reminded). The lease policy applies to later lease
 * activations only.
 *
 * @mcp
 */
export const updateAccountingSettings = defineServiceFn({
  input: z.object({
    showCurrencyTrailingZeros: z.boolean().optional(),
    assetTaxDepreciationEnabled: z.boolean().optional(),
    assetTaxRate: z.number().min(0).max(100).nullable().optional(),
    deferredTaxLiabilityAccountId: z.string().min(1).optional(),
    deferredTaxExpenseAccountId: z.string().min(1).optional(),
    leaseMajorPartThresholdPercent: z.number().gt(0).max(100).optional(),
    leaseSubstantiallyAllThresholdPercent: z.number().gt(0).max(100).optional(),
    leaseDefaultDiscountRate: z.number().min(0).optional(),
    leaseIncrementalBorrowingRate: z.number().min(0).optional(),
    leaseShortTermExpedient: z.boolean().optional(),
    leaseReminderDays: z.number().int().min(0).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const {
      deferredTaxLiabilityAccountId,
      deferredTaxExpenseAccountId,
      ...settings
    } = input;

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update accounting settings"
    );
    if (saved) return saved;

    const accounts = sentFields({
      deferredTaxLiabilityAccountId,
      deferredTaxExpenseAccountId
    });
    if (Object.keys(accounts).length > 0) {
      const { error } = await ctx.asCaller.supabase
        .from("accountDefault")
        .update({ ...accounts, updatedBy: ctx.auditUserId })
        .eq("companyId", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the deferred tax accounts",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Write the journals the accounting cutover would have written for documents posted without one.
 *
 * @remarks
 * A company that enabled accounting before the enable wrote journals has
 * documents posted on or after its cutover with no journal. This runs the
 * `journal-legacy-documents` server function, which journals each of them,
 * and returns how many documents it journaled.
 *
 * @mcp
 */
export const writeMissingJournals = defineServiceFn({
  input: z.object({}),
  permission: { update: ["settings", "accounting"] },
  async run(ctx) {
    const result = await serverFns
      .as({
        client: ctx.asCaller.supabase,
        db: ctx.asSystem.pg,
        companyId: ctx.company.id,
        userId: ctx.auditUserId
      })
      .invoke("journal-legacy-documents", {});
    if (result.error) {
      return fromServerFn(
        ctx,
        result.error,
        "Failed to write the missing journals"
      );
    }
    const { movementCostRows: _, ...families } = result.data.legacyJournals;
    return {
      documents: Object.values(families).reduce((sum, count) => sum + count, 0)
    };
  }
});

/**
 * Update the inventory settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: what a kanban card prints
 * (label, QR code or URL), the shelf-life and expiry policy (the near-expiry
 * warning in days, null to turn the badges off; the default shelf life of a
 * new item; which inputs a calculated expiry reads; and what consuming an
 * expired entity does), whether finishing a picking list with unpicked
 * material warns or refuses, and when unconsumed picked material is returned
 * (when the job completes, or when each operation is done).
 *
 * @mcp
 */
export const updateInventorySettings = defineServiceFn({
  input: z.object({
    kanbanOutput: z.enum(kanbanOutputTypes).optional(),
    inventoryShelfLife: z
      .object({
        nearExpiryWarningDays: z.number().int().min(0).max(365).nullable(),
        defaultShelfLifeDays: z.number().int().min(1).max(3650),
        calculatedInputScope: z.enum(calculatedShelfLifeInputScopes),
        expiredEntityPolicy: z.enum(expiredEntityPolicies)
      })
      .optional(),
    incompletePickingListPolicy: z
      .enum(incompletePickingListPolicies)
      .optional(),
    returnPickedMaterialTiming: z.enum(returnPickedMaterialTimings).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await saveCompanySettings(
      ctx,
      input,
      "Failed to update inventory settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the invoicing settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: what happens to a recurring
 * invoice when the daily job creates it, the receivables email (the Reply-To
 * and a CC on automated invoice emails), who is also notified about
 * invoices, whether documents print the centralized receivables billing
 * address, that address itself (a null field clears it), and the default CC
 * on customer emails. "Post and Send via Stripe" is refused until Stripe is
 * connected in Integrations, or every recurring invoice would be held.
 *
 * @mcp
 */
export const updateInvoicingSettings = defineServiceFn({
  input: z.object({
    invoiceAutomation: z.enum(invoiceAutomations).optional(),
    accountsReceivableEmail: z.string().email().nullable().optional(),
    invoiceNotificationGroup: notificationGroup.optional(),
    accountsReceivableAddress: z.boolean().optional(),
    accountsReceivableBillingAddress: billingAddressInput.optional(),
    defaultCustomerCc: z.array(z.string().email()).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const { accountsReceivableBillingAddress, ...settings } = input;

    if (
      settings.invoiceAutomation === "Post and Send via Stripe" &&
      !(await getStripeConnectAccountId(ctx.asSystem.supabase, ctx.company.id))
    ) {
      return ctx.error("rule", "Connect Stripe in Integrations first");
    }

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update invoicing settings"
    );
    if (saved) return saved;

    if (accountsReceivableBillingAddress) {
      const { error } = await ctx.asCaller.supabase
        .from("companyAccountsReceivableBillingAddress")
        .upsert({
          id: ctx.company.id,
          ...sentFields(accountsReceivableBillingAddress),
          updatedBy: ctx.auditUserId
        });
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the accounts receivable billing address",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Update the items settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether material ids are
 * generated from their properties, whether material sizes use metric units,
 * whether item ids may contain lowercase letters, whether the BoM explorer
 * shows readable ids, and how strictly a released revision controls changes
 * (off, warn or enforce).
 *
 * @mcp
 */
export const updateItemsSettings = defineServiceFn({
  input: z.object({
    materialGeneratedIds: z.boolean().optional(),
    useMetric: z.boolean().optional(),
    allowLowercaseItemIds: z.boolean().optional(),
    showBomExplorerReadableId: z.boolean().optional(),
    plmReleaseControl: z.enum(plmReleaseControl).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await saveCompanySettings(
      ctx,
      input,
      "Failed to update items settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the production settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: who is notified when an
 * inventory or a sales job completes, whether opening an operation starts its
 * timer, whether the job traveler lists materials and operations, whether
 * tracked material is pre-selected without a picking list, and whether one
 * location requires an assigned operator before the scheduler places work
 * there. The staffing rule lives on the location row and is written for the
 * company's own location only, so a settings admin without the resources
 * permission can still set it.
 *
 * @mcp
 */
export const updateProductionSettings = defineServiceFn({
  input: z.object({
    inventoryJobCompletedNotificationGroup: notificationGroup.optional(),
    salesJobCompletedNotificationGroup: notificationGroup.optional(),
    autoStartOperationTimer: z.boolean().optional(),
    includeMaterialsOnTraveler: z.boolean().optional(),
    includeOperationsOnTraveler: z.boolean().optional(),
    autoSelectMaterialWithoutPickingList: z.boolean().optional(),
    locationStaffing: z
      .object({
        locationId: z.string().min(1),
        requiresStaffing: z.boolean()
      })
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const { locationStaffing, ...settings } = input;

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update production settings"
    );
    if (saved) return saved;

    if (locationStaffing) {
      const { data, error } = await ctx.asSystem.supabase
        .from("location")
        .update({ requiresStaffing: locationStaffing.requiresStaffing })
        .eq("id", locationStaffing.locationId)
        .eq("companyId", ctx.company.id)
        .select("id");
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the staffing requirement",
          error
        );
      }
      if (data.length === 0) return ctx.error("notFound", "Location not found");
    }
    return input;
  }
});

/**
 * Update the purchasing settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether documents print the
 * centralized payables billing address, that address itself (a null field
 * clears it), whether a supplier needs a contact with an email before its
 * documents issue, when a purchase updates the item's price (on invoice post
 * or on order finalize), whether a receipt updates the supplier lead time,
 * whether supplier readable ids show, who is notified about supplier quotes,
 * and the default CC on supplier emails.
 *
 * @mcp
 */
export const updatePurchasingSettings = defineServiceFn({
  input: z.object({
    accountsPayableAddress: z.boolean().optional(),
    accountsPayableBillingAddress: billingAddressInput.optional(),
    requireSupplierContactAndLocation: z.boolean().optional(),
    purchasePriceUpdateTiming: z
      .enum(purchasePriceUpdateTimingTypes)
      .optional(),
    updateLeadTimesOnReceipt: z.boolean().optional(),
    showSupplierReadableId: z.boolean().optional(),
    supplierQuoteNotificationGroup: notificationGroup.optional(),
    defaultSupplierCc: z.array(z.string().email()).optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const { accountsPayableBillingAddress, ...settings } = input;

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update purchasing settings"
    );
    if (saved) return saved;

    if (accountsPayableBillingAddress) {
      const { error } = await ctx.asCaller.supabase
        .from("companyAccountsPayableBillingAddress")
        .update({
          ...sentFields(accountsPayableBillingAddress),
          updatedBy: ctx.auditUserId
        })
        .eq("id", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update the accounts payable billing address",
          error
        );
      }
    }
    return input;
  }
});

/**
 * Update the quality settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether an inspection needs a
 * second person to sign it off, the sampling standard inspection plans use,
 * the open-issue target on the quality dashboard, and who is notified when a
 * gauge goes out of calibration.
 *
 * @mcp
 */
export const updateQualitySettings = defineServiceFn({
  input: z.object({
    enforceInspectionFourEyes: z.boolean().optional(),
    samplingStandard: z.enum(["ANSI_Z1_4", "ISO_2859_1"]).optional(),
    qualityIssueTarget: z.number().int().min(0).optional(),
    gaugeCalibrationExpiredNotificationGroup: notificationGroup.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await saveCompanySettings(
      ctx,
      input,
      "Failed to update quality settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the resources settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: who is notified about a new
 * suggestion, and who is notified about a maintenance, quality, operations or
 * other dispatch.
 *
 * @mcp
 */
export const updateResourcesSettings = defineServiceFn({
  input: z.object({
    suggestionNotificationGroup: notificationGroup.optional(),
    maintenanceDispatchNotificationGroup: notificationGroup.optional(),
    qualityDispatchNotificationGroup: notificationGroup.optional(),
    operationsDispatchNotificationGroup: notificationGroup.optional(),
    otherDispatchNotificationGroup: notificationGroup.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const { suggestionNotificationGroup, ...settings } = input;

    // The suggestion group lives on the company row, not its settings.
    if (suggestionNotificationGroup) {
      const { error } = await ctx.asCaller.supabase
        .from("company")
        .update({ suggestionNotificationGroup })
        .eq("id", ctx.company.id);
      if (error) {
        return ctx.error(
          "internal",
          "Failed to update suggestion notifications",
          error
        );
      }
    }

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update dispatch notifications"
    );
    return saved ?? input;
  }
});

/**
 * Update the sales settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether a customer needs a
 * contact and location, whether customer readable ids show, the digital quote
 * (on or off, who is notified, and whether accepting one asks for a purchase
 * order), who is notified when an RFQ is ready and when a sales rule is
 * broken, and the default markup per cost category on a quote line.
 *
 * @mcp
 */
export const updateSalesSettings = defineServiceFn({
  input: z.object({
    requireCustomerContactAndLocation: z.boolean().optional(),
    showCustomerReadableId: z.boolean().optional(),
    digitalQuoteEnabled: z.boolean().optional(),
    digitalQuoteNotificationGroup: notificationGroup.optional(),
    digitalQuoteIncludesPurchaseOrders: z.boolean().optional(),
    rfqReadyNotificationGroup: notificationGroup.optional(),
    salesRuleNotificationGroup: notificationGroup.optional(),
    quoteLineCategoryMarkups: z
      .object({
        materialCost: z.number().min(0),
        partCost: z.number().min(0),
        toolCost: z.number().min(0),
        consumableCost: z.number().min(0),
        laborCost: z.number().min(0),
        machineCost: z.number().min(0),
        overheadCost: z.number().min(0),
        outsideCost: z.number().min(0)
      })
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const saved = await saveCompanySettings(
      ctx,
      input,
      "Failed to update sales settings"
    );
    return saved ?? input;
  }
});

/**
 * Update the people settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest: whether timecards are on, and
 * whether console (kiosk) mode is on. Console mode is a Business plan
 * feature. Turning it on creates the "Console Operator" employee type, and
 * for a signed-in user who has no console PIN yet it generates one: `pin` is
 * returned once and can never be read back. `pinError` says why that PIN
 * could not be created; console mode is on regardless. A key caller gets no
 * PIN.
 */
export const updatePeopleSettings = defineServiceFn({
  input: z.object({
    timeCardEnabled: z.boolean().optional(),
    consoleEnabled: z.boolean().optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const { consoleEnabled, ...settings } = input;

    const saved = await saveCompanySettings(
      ctx,
      settings,
      "Failed to update timecard settings"
    );
    if (saved) return saved;
    if (consoleEnabled === undefined) {
      return { ...input, pin: null, pinError: null };
    }

    let update: Awaited<ReturnType<typeof updateConsoleSetting>>;
    try {
      update = await updateConsoleSetting(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        ctx.company.id,
        consoleEnabled,
        ctx.actor.type === "user" ? ctx.actor.userId : undefined
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error(
        "entitlement",
        "Console mode requires the Business plan"
      );
    }
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update console mode",
        update.error
      );
    }
    return { ...input, pin: update.pin, pinError: update.pinError };
  }
});

/**
 * Turn the company-wide two-factor requirement on or off.
 *
 * @remarks
 * Requiring two-factor authentication is a Business plan feature; turning it
 * off is always allowed, so a downgraded company is never locked out. When it
 * goes from off to on, every active employee is emailed. It is not announced
 * when the stored value was already on, when the stored value cannot be read,
 * or in a controlled environment, where two-factor is mandatory from the day
 * of deployment.
 *
 * @mcp
 */
export const updateSecuritySettings = defineServiceFn({
  input: z.object({ requireMfa: z.boolean() }),
  permission: { update: "settings" },
  async run(ctx, { requireMfa }) {
    // Read first: the switch re-submits on every flip, and a toggle that
    // lands on the value it already had must not re-announce.
    const previous = await ctx.asCaller.supabase
      .from("companySettings")
      .select("requireMfa")
      .eq("id", ctx.company.id)
      .single();

    let update: Awaited<ReturnType<typeof updateRequireMfaSetting>>;
    try {
      update = await updateRequireMfaSetting(
        ctx.asCaller.supabase,
        ctx.company.id,
        requireMfa
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      return ctx.error(
        "entitlement",
        "Upgrade to Business to require two-factor authentication"
      );
    }
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to update two-factor requirement",
        update.error
      );
    }

    if (
      !CONTROLLED_ENVIRONMENT &&
      requireMfa &&
      previous.data?.requireMfa === false
    ) {
      await sendMfaRequiredEmails(ctx.asSystem.supabase, ctx.company.id);
    }
    return { requireMfa };
  }
});

const employeeOrNone = z.string().min(1).nullable();

/**
 * Update the planning settings.
 *
 * @remarks
 * Writes the fields sent and leaves the rest. The planning action owner
 * ladder: the company default responsible employee, one location's
 * responsible employee, and one item group's at a location (null clears a
 * rung, so it inherits from the one above). Each employee must be an active
 * employee of the company. A location is a resources record: without the
 * resources update permission it is refused. Then whether purchase orders
 * the planning pages raise skip approval, the reschedule tolerance in days,
 * the default planning horizon in days (null for no time fence), the forecast
 * consumption window in weekly periods back and forward, and the time of day
 * scheduled MRP runs on the company's clock ("HH:MM" or "HH:MM:SS"; null runs
 * it every 3 hours).
 *
 * @mcp
 */
export const updatePlanningSettings = defineServiceFn({
  input: z.object({
    defaultResponsibleEmployee: employeeOrNone.optional(),
    locationResponsibleEmployee: z
      .object({
        locationId: z.string().min(1),
        responsibleEmployee: employeeOrNone
      })
      .optional(),
    itemGroupResponsibleEmployee: z
      .object({
        locationId: z.string().min(1),
        itemPostingGroupId: z.string().min(1),
        responsibleEmployee: employeeOrNone
      })
      .optional(),
    skipApprovalForPlanningPurchaseOrders: z.boolean().optional(),
    rescheduleToleranceDays: z.number().int().min(0).max(365).optional(),
    defaultPlanningHorizonDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullable()
      .optional(),
    forecastConsumptionBackwardPeriods: z
      .number()
      .int()
      .min(0)
      .max(52)
      .optional(),
    forecastConsumptionForwardPeriods: z
      .number()
      .int()
      .min(0)
      .max(52)
      .optional(),
    mrpRunTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
        message: "Choose a time for the daily MRP run"
      })
      .nullable()
      .optional()
  }),
  permission: { update: "settings" },
  async run(ctx, input) {
    const refused = nothingSent(ctx, input);
    if (refused) return refused;
    const {
      locationResponsibleEmployee: location,
      itemGroupResponsibleEmployee: itemGroup,
      mrpRunTime,
      ...settings
    } = input;

    const employees = [
      settings.defaultResponsibleEmployee,
      location?.responsibleEmployee,
      itemGroup?.responsibleEmployee
    ].filter((id): id is string => !!id);
    for (const employeeId of new Set(employees)) {
      if (
        !(await isActiveCompanyEmployee(
          ctx.asCaller.supabase,
          ctx.company.id,
          employeeId
        ))
      ) {
        return ctx.error("rule", "Choose an employee of this company");
      }
    }

    const saved = await saveCompanySettings(
      ctx,
      {
        ...settings,
        mrpRunTime:
          mrpRunTime === undefined
            ? undefined
            : mrpRunTime && parseTime(mrpRunTime).toString()
      },
      "Failed to update planning settings"
    );
    if (saved) return saved;

    if (location) {
      const result = await setLocationResponsibleEmployee(
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          locationId: location.locationId,
          employeeId: location.responsibleEmployee,
          userId: ctx.auditUserId
        }
      );
      if (result.error) {
        return ctx.error(
          "internal",
          "Failed to update location ownership",
          result.error
        );
      }
      // No row back: the location is not this company's, or the caller lacks
      // resources_update and row-level security matched nothing.
      if ((result.data?.length ?? 0) === 0) {
        return ctx.error(
          "forbidden",
          "You do not have permission to change this location"
        );
      }
    }

    if (itemGroup) {
      const result = await upsertItemPostingGroupResponsibility(
        ctx.asCaller.supabase,
        {
          companyId: ctx.company.id,
          locationId: itemGroup.locationId,
          itemPostingGroupId: itemGroup.itemPostingGroupId,
          employeeId: itemGroup.responsibleEmployee,
          userId: ctx.auditUserId
        }
      );
      if (result.error) {
        return ctx.error(
          "internal",
          "Failed to update item group ownership",
          result.error
        );
      }
    }
    return input;
  }
});

/** Multi-company management is open to internal (Carbon) users only, for now. */
async function refuseUnlessInternalUser(
  ctx: ServiceContext
): Promise<CarbonError | null> {
  const refused = ctx.error(
    "forbidden",
    "Managing companies is not available to this account"
  );
  if (ctx.actor.type !== "user") return refused;
  const { data } = await ctx.asSystem.supabase
    .from("user")
    .select("email")
    .eq("id", ctx.actor.userId)
    .maybeSingle();
  return isInternalEmail(data?.email ?? "") ? null : refused;
}

/**
 * Update the company's details.
 *
 * @remarks
 * Writes the company's name, address, time zone, base currency, tax and
 * registration numbers and contact details. Changing the base currency also
 * deletes every exchange-rate override, in the same transaction: an override
 * is denominated in the old base and would rate every new document wrong.
 * The company's cached time zone is dropped, so a new one applies at once.
 *
 * @mcp
 */
export const updateCompanyDetails = defineServiceFn({
  input: companyValidator,
  permission: { update: "settings" },
  async run(ctx, company) {
    const existing = await ctx.asCaller.supabase
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", ctx.company.id)
      .single();

    const baseCurrencyChanged =
      !!existing.data?.baseCurrencyCode &&
      existing.data.baseCurrencyCode !== company.baseCurrencyCode;

    if (baseCurrencyChanged) {
      try {
        await updateCompanyWithBaseCurrencyChange(
          ctx.asSystem.pg,
          ctx.company.id,
          { ...company, updatedBy: ctx.auditUserId }
        );
      } catch (err) {
        return ctx.error("internal", "Failed to update company", err);
      }
    } else {
      const update = await updateCompany(
        ctx.asCaller.supabase,
        ctx.company.id,
        { ...company, updatedBy: ctx.auditUserId }
      );
      if (update.error) {
        return ctx.error("internal", "Failed to update company", update.error);
      }
    }

    await invalidateCompanyTimeZone(ctx.company.id);
    return { id: ctx.company.id };
  }
});

/** The headquarters location and the creator's job at it: what a new company starts with. */
async function createHeadquarters(
  ctx: ServiceContext,
  companyId: string,
  location: Omit<z.output<typeof companyValidator>, "baseCurrencyCode">
): Promise<CarbonError | null> {
  const client = ctx.asSystem.supabase;

  // Controlled environments (ITAR/CUI, NIST 800-171 3.3.1) capture audit from
  // day one: enable it at company creation, not just when settings are opened.
  if (CONTROLLED_ENVIRONMENT) {
    await enableAuditLog(client, companyId).catch((err) =>
      logger.error("Failed to enable audit log for new company", {
        companyId,
        error: err
      })
    );
  }

  const headquarters = await upsertLocation(client, {
    ...location,
    name: "Headquarters",
    companyId,
    // The timezone comes with the company's address: HQ shares it.
    createdBy: ctx.auditUserId
  });
  if (headquarters.error || !headquarters.data?.id) {
    return ctx.error(
      "internal",
      "Failed to create headquarters location",
      headquarters.error
    );
  }

  const [job] = await Promise.all([
    insertEmployeeJob(client, {
      id: ctx.auditUserId,
      companyId,
      locationId: headquarters.data.id
    }),
    redis.del(getPermissionCacheKey(ctx.auditUserId))
  ]);
  if (job.error) {
    return ctx.error(
      "internal",
      "Failed to create employee job record",
      job.error
    );
  }
  return null;
}

/**
 * Create a company in a new company group, for the caller.
 *
 * @remarks
 * Inserts the company, seeds it (chart of accounts, sequences, the caller's
 * employee record and permissions), creates its Headquarters location at the
 * company's address and the caller's job there. In a controlled environment
 * audit logging is on from the start. Returns the new company and its group,
 * so the caller can switch to it.
 */
export const createCompany = defineServiceFn({
  input: companyValidator,
  permission: { update: ["settings", "users"] },
  async run(ctx, company) {
    const client = ctx.asSystem.supabase;
    const inserted = await insertCompany(client, company);
    if (inserted.error || !inserted.data?.id) {
      return ctx.error("internal", "Failed to create company", inserted.error);
    }
    const companyId = inserted.data.id;

    const seed = await seedCompany(
      client,
      ctx.asSystem.pg,
      companyId,
      ctx.auditUserId
    );
    if (seed.error) {
      return ctx.error("internal", "Failed to seed company", seed.error);
    }

    const { baseCurrencyCode: _, ...location } = company;
    const headquarters = await createHeadquarters(ctx, companyId, location);
    if (headquarters) return headquarters;

    const { data } = await client
      .from("company")
      .select("companyGroupId")
      .eq("id", companyId)
      .single();
    return { companyId, companyGroupId: data?.companyGroupId ?? "" };
  }
});

/**
 * Create a company in the caller's company group.
 *
 * @remarks
 * Open to internal users only, for now. The parent must be a company of the
 * caller's own group: seeding joins the new company to its parent's group,
 * so a parent from another group would place it inside another tenant. Then
 * as for a new company: insert, seed, the Headquarters location and the
 * caller's job there.
 */
export const createSubsidiary = defineServiceFn({
  input: subsidiaryValidator,
  permission: { create: "settings" },
  async run(ctx, subsidiary) {
    const refused = await refuseUnlessInternalUser(ctx);
    if (refused) return refused;

    const { id: _, parentCompanyId, ...company } = subsidiary;
    const client = ctx.asSystem.supabase;

    if (parentCompanyId) {
      const parent = await client
        .from("company")
        .select("id")
        .eq("id", parentCompanyId)
        .eq("companyGroupId", ctx.company.groupId)
        .maybeSingle();
      if (parent.error || !parent.data) {
        return ctx.error("notFound", "Parent company not found", parent.error);
      }
    }

    const inserted = await insertCompany(client, company);
    if (inserted.error || !inserted.data?.id) {
      return ctx.error("internal", "Failed to create company", inserted.error);
    }
    const companyId = inserted.data.id;

    const seed = await seedCompany(
      client,
      ctx.asSystem.pg,
      companyId,
      ctx.auditUserId,
      { parentCompanyId }
    );
    if (seed.error) {
      return ctx.error("internal", "Failed to seed company", seed.error);
    }

    const { baseCurrencyCode: __, ...location } = company;
    const headquarters = await createHeadquarters(ctx, companyId, location);
    return headquarters ?? { companyId };
  }
});

/**
 * Update a company of the caller's company group.
 *
 * @remarks
 * Open to internal users only, for now. Writes the company's details and its
 * parent, then drops its cached time zone.
 */
export const updateSubsidiaryDetails = defineServiceFn({
  input: subsidiaryValidator.safeExtend({ id: z.string() }),
  permission: { update: "settings" },
  async run(ctx, { id, ...subsidiary }) {
    const refused = await refuseUnlessInternalUser(ctx);
    if (refused) return refused;

    const result = await updateSubsidiary(ctx.asCaller.supabase, id, {
      ...subsidiary,
      updatedBy: ctx.auditUserId
    });
    if (result.error) {
      return ctx.error("internal", "Failed to update subsidiary", result.error);
    }
    await invalidateCompanyTimeZone(id);
    return { id };
  }
});

/** A one-label ZPL test page for the route's media size; null for a PDF route or no size. */
function generateTestLabel(
  format: string,
  mediaSizeId: string | null
): string | null {
  if (format !== "zpl" || !mediaSizeId) return null;
  const labelSize = labelSizes.find((s) => s.id === mediaSizeId);
  if (!labelSize?.zpl) return null;
  const { width, height } = labelSize.zpl;
  const dpi = labelSize.zpl.dpi || 203;
  const widthDots = Math.round(width * dpi);
  const heightDots = Math.round(height * dpi);
  const now = new Date();
  const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  return [
    "^XA",
    `^PW${widthDots}`,
    `^LL${heightDots}`,
    "^MNW",
    "^FO20,20^A0N,30,30^FDTest Print^FS",
    `^FO20,60^A0N,20,20^FD${mediaSizeId} — ${width}x${height}"^FS`,
    `^FO20,90^A0N,16,16^FD${timestamp}^FS`,
    "^XZ"
  ].join("\n");
}

/**
 * Create or update a printer route.
 *
 * @remarks
 * A printer route is a printer the company prints to: its name, format (ZPL
 * labels or PDF documents), media size, URL and optional API key, location
 * and template. With an `id` the company's route is updated, without one a
 * route is created. The cached printer routing is dropped, so the change
 * applies to the next print.
 *
 * @mcp
 */
export const savePrinterRoute = defineServiceFn({
  input: printerRouteValidator,
  permission: { update: "settings" },
  async run(ctx, route) {
    const result = await upsertPrinterRoute(ctx.asCaller.supabase, {
      id: route.id || undefined,
      companyId: ctx.company.id,
      name: route.name,
      format: route.format,
      mediaSizeId: route.mediaSizeId || null,
      printerUrl: route.printerUrl,
      apiKey: route.apiKey || null,
      locationId: route.locationId || null,
      templateId: route.templateId || null
    });
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to save printer route",
        result.error
      );
    }
    await invalidatePrinterCache(ctx.company.id);
    return { created: !route.id };
  }
});

/**
 * Send a test label to a printer route.
 *
 * @remarks
 * Prints one ZPL test label, sized to the route's media, on the company's
 * printer route. Only a ZPL route with a media size can print one. The
 * printer must answer within 10 seconds.
 */
export const testPrinterRoute = defineServiceFn({
  input: z.object({ routeId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { routeId }) {
    const { data: route } = await ctx.asCaller.supabase
      .from("printerRoute")
      .select("printerUrl, format, mediaSizeId, apiKey")
      .eq("id", routeId)
      .eq("companyId", ctx.company.id)
      .single();
    if (!route) return ctx.error("notFound", "Printer route not found");

    const testLabel = generateTestLabel(route.format, route.mediaSizeId);
    if (!testLabel) {
      return ctx.error(
        "rule",
        "Test print is only supported for ZPL label printers with a media size configured."
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream"
    };
    if (route.apiKey) headers["X-API-Key"] = route.apiKey;

    try {
      const response = await fetch(route.printerUrl, {
        method: "POST",
        headers,
        body: testLabel,
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        return ctx.error(
          "unavailable",
          `Print failed (${response.status} ${response.statusText})`
        );
      }
    } catch (err) {
      return ctx.error(
        "unavailable",
        `Print failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        err
      );
    }
    return { routeId };
  }
});

/**
 * Delete a printer route.
 *
 * @remarks
 * Deletes the company's printer route, then clears it from every printer
 * assignment that named it (a location's default, its shipping and receiving
 * printers, and its work centers), so no assignment points at a printer that
 * is gone. The cached printer routing is dropped.
 *
 * @mcp destructive
 */
export const removePrinterRoute = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    const client = ctx.asCaller.supabase;
    const result = await deletePrinterRoute(client, id, ctx.company.id);
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to delete printer route",
        result.error
      );
    }

    const { data: existing } = await getPrintingSettings(
      client,
      ctx.company.id
    );
    const current = existing?.printing as PrintingSettings | null;
    if (current?.assignments) {
      let dirty = false;
      const assignments = { ...current.assignments };
      for (const [locationId, location] of Object.entries(assignments)) {
        if (!location) continue;
        const next = { ...location };
        if (next.defaultPrinterRouteId === id) {
          next.defaultPrinterRouteId = null;
          dirty = true;
        }
        if (next.shipping?.printerRouteId === id) {
          next.shipping = { ...next.shipping, printerRouteId: null };
          dirty = true;
        }
        if (next.receiving?.printerRouteId === id) {
          next.receiving = { ...next.receiving, printerRouteId: null };
          dirty = true;
        }
        if (next.workCenters) {
          const workCenters = { ...next.workCenters };
          for (const [workCenterId, workCenter] of Object.entries(
            workCenters
          )) {
            if (workCenter?.printerRouteId === id) {
              workCenters[workCenterId] = {
                ...workCenter,
                printerRouteId: null
              };
              dirty = true;
            }
          }
          next.workCenters = workCenters;
        }
        assignments[locationId] = next;
      }
      if (dirty) {
        await updatePrintingSettings(client, ctx.company.id, {
          ...current,
          assignments
        });
      }
    }

    await invalidatePrinterCache(ctx.company.id);
    return { id };
  }
});

/**
 * Assign a printer to a location, one of its contexts or a work center.
 *
 * @remarks
 * Sets which printer route a location prints to by default, for shipping,
 * for receiving, or at one of its work centers (`contextId` names the work
 * center), and whether it prints automatically. An empty route clears the
 * assignment, so the context falls back to the location's default. The
 * cached printer routing is dropped.
 *
 * @mcp
 */
export const assignPrinter = defineServiceFn({
  input: updateAssignmentValidator,
  permission: { update: "settings" },
  async run(ctx, assignment) {
    const client = ctx.asCaller.supabase;
    const { data: existing } = await getPrintingSettings(
      client,
      ctx.company.id
    );
    const current = (existing?.printing as PrintingSettings | null) ?? {
      assignments: {}
    };
    const updated = setContextAssignment(
      current,
      assignment.locationId,
      assignment.context,
      {
        printerRouteId: assignment.printerRouteId || null,
        autoPrint: assignment.autoPrint
      },
      assignment.contextId
    );

    const result = await updatePrintingSettings(
      client,
      ctx.company.id,
      updated
    );
    if (result.error) {
      return ctx.error(
        "internal",
        "Failed to update the printer assignment",
        result.error
      );
    }
    await invalidatePrinterCache(ctx.company.id);
    return { locationId: assignment.locationId };
  }
});

/**
 * Print a print job again.
 *
 * @remarks
 * Queues a new print job with the company's original job's content, to its
 * printer or to `printerUrl` when given, and starts its delivery. A job still
 * generating has no content and cannot be reprinted.
 *
 * @mcp
 */
export const reprintPrintJob = defineServiceFn({
  input: reprintValidator,
  permission: { update: "settings" },
  async run(ctx, { printJobId, printerUrl }) {
    const client = ctx.asCaller.supabase;
    const [original, originalMeta] = await Promise.all([
      getPrintJobContent(client, printJobId, ctx.company.id),
      getPrintJob(client, printJobId, ctx.company.id)
    ]);
    if (
      original.error ||
      !original.data ||
      originalMeta.error ||
      !originalMeta.data
    ) {
      return ctx.error(
        "notFound",
        "Failed to load print job",
        original.error ?? originalMeta.error
      );
    }
    if (!original.data.content || !original.data.contentType) {
      return ctx.error("rule", "Cannot reprint a job that is still generating");
    }

    const job = await createPrintJob(client, {
      companyId: ctx.company.id,
      contentType: original.data.contentType as "zpl" | "pdf",
      content: original.data.content,
      printerUrl: printerUrl || originalMeta.data.printerUrl,
      sourceDocument: originalMeta.data.sourceDocument,
      sourceDocumentId: originalMeta.data.sourceDocumentId,
      sourceDocumentReadableId:
        originalMeta.data.sourceDocumentReadableId ?? undefined,
      description: originalMeta.data.description,
      status: "queued",
      origin: "reprint",
      createdBy: ctx.auditUserId
    });
    if (job.error || !job.data) {
      return ctx.error("internal", "Failed to create reprint", job.error);
    }

    try {
      await trigger("print-job-deliver", {
        printJobId: job.data.id,
        companyId: ctx.company.id
      });
    } catch (err) {
      logger.error("Failed to trigger delivery", {
        companyId: ctx.company.id,
        error: err
      });
    }
    return { printJobId: job.data.id };
  }
});

/**
 * Delete a print job.
 *
 * @remarks
 * Deletes the company's print job from the print queue history.
 *
 * @mcp destructive
 */
export const deletePrintJob = defineServiceFn({
  input: z.object({ printJobId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { printJobId }) {
    const { error } = await ctx.asCaller.supabase
      .from("printJob")
      .delete()
      .eq("id", printJobId)
      .eq("companyId", ctx.company.id);
    if (error) return ctx.error("internal", "Failed to delete job", error);
    return { id: printJobId };
  }
});

/** What a print job printed: its ZPL or PDF content. */
export const viewPrintJobContent = defineServiceFn({
  input: z.object({ printJobId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { printJobId }) {
    const content = await getPrintJobContent(
      ctx.asCaller.supabase,
      printJobId,
      ctx.company.id
    );
    if (content.error || !content.data) {
      return ctx.error("notFound", "Failed to load content", content.error);
    }
    return {
      printJobId: content.data.id,
      content: content.data.content,
      contentType: content.data.contentType
    };
  }
});

/**
 * Save a document's layout.
 *
 * @remarks
 * Writes the company's template for one document type: its blocks, theme,
 * settings and the header and footer sections it uses. The logo and header
 * layout (`headerConfig`) is edited with the template but lives on the
 * company-wide header section, so it is saved onto that section first, with
 * the section's name and content kept, and applies wherever the header is
 * used. A built-in header section is forked into the company's own copy.
 *
 * @mcp
 */
export const saveDocumentTemplate = defineServiceFn({
  input: z.object({
    documentType: documentTemplateTypeSchema,
    blocks: z.array(blockSchema),
    theme: themeSchema,
    settings: documentSettingsSchema,
    headerSectionId: z.string().optional(),
    footerSectionId: z.string().optional(),
    headerConfig: sectionConfigSchema.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, template) {
    const client = ctx.asCaller.supabase;
    const { headerConfig, headerSectionId } = template;

    if (headerConfig && headerSectionId) {
      const resolved = await resolveSections(client, ctx.company.id, [
        headerSectionId
      ]);
      const header = resolved[headerSectionId];
      const section = await upsertDocumentSection(client, {
        id: headerSectionId,
        companyId: ctx.company.id,
        name: header?.name ?? "Default Header",
        placement: "header",
        content: (header?.content ?? {
          type: "doc",
          content: []
        }) as JSONContent,
        config: headerConfig as Record<string, unknown>,
        createdBy: ctx.auditUserId,
        updatedBy: ctx.auditUserId
      });
      if (section.error) {
        return ctx.error("internal", "Failed to save header", section.error);
      }
    }

    const upsert = await upsertDocumentTemplate(client, {
      companyId: ctx.company.id,
      documentType: template.documentType,
      blocks: template.blocks as DocumentBlock[],
      theme: template.theme as DocumentTheme,
      settings: template.settings as DocumentSettings,
      headerSectionId: headerSectionId || null,
      footerSectionId: template.footerSectionId || null,
      createdBy: ctx.auditUserId,
      updatedBy: ctx.auditUserId
    });
    if (upsert.error) {
      return ctx.error(
        "internal",
        "Failed to save document layout",
        upsert.error
      );
    }
    return { documentType: template.documentType };
  }
});

/**
 * Create or update a shared document section.
 *
 * @remarks
 * A section is company-wide rich text placed in a document's header, body or
 * footer. With an `id` the section is updated; editing a built-in section
 * forks it into the company's own copy under the same id, which then
 * overrides the built-in everywhere it is used. Without an `id` a section is
 * created.
 *
 * @mcp
 */
export const saveDocumentSection = defineServiceFn({
  input: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    placement: documentSectionPlacementSchema,
    content: z.record(z.string(), z.unknown()),
    config: sectionConfigSchema.optional()
  }),
  permission: { update: "settings" },
  async run(ctx, { id, name, placement, content, config }) {
    const result = await upsertDocumentSection(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      name,
      placement,
      content: content as JSONContent,
      config: config as Record<string, unknown> | undefined,
      ...(id ? { updatedBy: ctx.auditUserId } : { createdBy: ctx.auditUserId })
    });
    if (result.error) {
      return ctx.error("internal", "Failed to save section", result.error);
    }
    return { saved: true };
  }
});

/**
 * Delete a shared document section.
 *
 * @remarks
 * Templates refer to their header and footer sections without a foreign
 * key: a template that used the deleted section renders without it.
 *
 * @mcp destructive
 */
export const removeDocumentSection = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    const result = await deleteDocumentSection(
      ctx.asCaller.supabase,
      id,
      ctx.company.id
    );
    if (result.error) {
      return ctx.error("internal", "Failed to delete section", result.error);
    }
    return { id };
  }
});

const apiKeyFields = {
  name: apiKeyValidator.shape.name,
  expiresAt: apiKeyValidator.shape.expiresAt,
  /** Per module, the actions the key may run: `{ "sales": ["view"] }`. */
  scopes: z.record(z.string(), z.array(z.string()))
};

/** An API key action on a company without the plan. */
function apiKeysEntitlement(ctx: ServiceContext, err: unknown) {
  if (!(err instanceof EntitlementError)) throw err;
  return ctx.error("entitlement", "API keys require the Business plan");
}

/**
 * Create an API key.
 *
 * @remarks
 * Generates the key, stores only its hash and last five characters, and
 * returns the raw key once: it can never be read back. API keys are a
 * Business plan feature.
 */
export const createApiKey = defineServiceFn({
  input: z.object(apiKeyFields),
  permission: { update: "users" },
  async run(ctx, { name, scopes, expiresAt }) {
    const rawKey = `crbn_${nanoid()}`;
    let created: Awaited<ReturnType<typeof upsertApiKey>>;
    try {
      created = await upsertApiKey(ctx.asCaller.supabase, {
        name,
        scopes,
        expiresAt: expiresAt || undefined,
        rawKey,
        keyHash: hashApiKey(rawKey),
        keyPreview: rawKey.slice(-5),
        companyId: ctx.company.id,
        createdBy: ctx.auditUserId
      });
    } catch (err) {
      return apiKeysEntitlement(ctx, err);
    }
    const key = created.data && "key" in created.data ? created.data.key : null;
    if (created.error || !key) {
      return ctx.error("internal", "Failed to create API key", created.error);
    }
    return { key };
  }
});

/**
 * Update an API key's name, scopes and expiry.
 *
 * @remarks
 * The key itself never changes. Its cached authentication is dropped, so a
 * narrower scope or an earlier expiry applies at once.
 */
export const updateApiKey = defineServiceFn({
  input: z.object({ id: z.string().min(1), ...apiKeyFields }),
  permission: { update: "users" },
  async run(ctx, { id, name, scopes, expiresAt }) {
    let updated: Awaited<ReturnType<typeof upsertApiKey>>;
    try {
      updated = await upsertApiKey(ctx.asCaller.supabase, {
        id,
        name,
        scopes,
        expiresAt: expiresAt || undefined
      });
    } catch (err) {
      return apiKeysEntitlement(ctx, err);
    }
    if (updated.error) {
      return ctx.error("internal", "Failed to update API key", updated.error);
    }
    // A scope or expiry edit must not keep authenticating from the 30s cache.
    await invalidateApiKeyCache(id, ctx.company.id);
    return { id };
  }
});

/**
 * Delete an API key.
 *
 * @remarks
 * The key stops authenticating: its cached authentication is dropped before
 * the delete (the key's hash cannot be read once the row is gone) and again
 * after it, in case a request re-cached the live row in between.
 */
export const revokeApiKey = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "users" },
  async run(ctx, { id }) {
    const keyHash = await invalidateApiKeyCache(id, ctx.company.id);
    let deleted: Awaited<ReturnType<typeof deleteApiKey>>;
    try {
      deleted = await deleteApiKey(ctx.asCaller.supabase, id);
    } catch (err) {
      return apiKeysEntitlement(ctx, err);
    }
    if (deleted.error) {
      return ctx.error("internal", "Failed to delete API key", deleted.error);
    }
    if (keyHash) await bustApiKeyCache(keyHash);
    return { id };
  }
});

/**
 * Disconnect an integration.
 *
 * @remarks
 * Marks the company's integration inactive, runs the integration's own
 * uninstall step (removing its webhooks, for example) and drops its cached
 * health. Integrations outside the always-available set need the plan's
 * integrations feature.
 *
 * @mcp
 */
export const deactivateCompanyIntegration = defineServiceFn({
  input: z.object({ id: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { id }) {
    if (
      !isIntegrationWhitelisted(id) &&
      !(await companyHasFeature(ctx.asCaller.supabase, ctx.company.id, {
        feature: "INTEGRATIONS"
      }))
    ) {
      return ctx.error("entitlement", "Integrations require an upgraded plan");
    }

    const integration = availableIntegrations.find((i) => i.id === id);
    if (!integration) return ctx.error("notFound", "Integration not found");

    const update = await deactivateIntegration(ctx.asCaller.supabase, {
      id,
      companyId: ctx.company.id,
      updatedBy: ctx.auditUserId
    });
    if (update.error) {
      return ctx.error(
        "internal",
        "Failed to disconnect integration",
        update.error
      );
    }

    const hooks = getIntegrationServerHooks(id);
    if (hooks?.onUninstall) await hooks.onUninstall(ctx.company.id);

    await invalidateIntegrationHealthCache(id, ctx.company.id);
    return { id, name: integration.name };
  }
});

/**
 * Turn audit logging on.
 *
 * @remarks
 * Records every change to the company's audited tables from now on. Audit
 * logging is a Business plan feature.
 *
 * @mcp
 */
export const enableCompanyAuditLog = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    try {
      await enableAuditLog(ctx.asCaller.supabase, ctx.company.id);
    } catch (err) {
      if (err instanceof EntitlementError) {
        return ctx.error(
          "entitlement",
          "Upgrade to Business to enable audit logging"
        );
      }
      return ctx.error("internal", "Failed to enable audit logging", err);
    }
    return { auditLogEnabled: true };
  }
});

/**
 * Turn audit logging off.
 *
 * @remarks
 * Stops recording changes; the log written so far is kept. A controlled
 * environment cannot turn audit logging off.
 *
 * @mcp
 */
export const disableCompanyAuditLog = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    if (CONTROLLED_ENVIRONMENT) {
      return ctx.error(
        "rule",
        "Audit logging cannot be disabled in a controlled environment"
      );
    }
    try {
      await disableAuditLog(ctx.asCaller.supabase, ctx.company.id);
    } catch (err) {
      return ctx.error("internal", "Failed to disable audit logging", err);
    }
    return { auditLogEnabled: false };
  }
});

/** A signed URL that downloads one of the company's audit log archives. */
export const auditArchiveDownloadUrl = defineServiceFn({
  input: z.object({ archiveId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { archiveId }) {
    try {
      const url = await getArchiveDownloadUrl(
        ctx.asSystem.supabase,
        archiveId,
        ctx.company.id
      );
      return { url };
    } catch (err) {
      return ctx.error("internal", "Failed to generate download URL", err);
    }
  }
});

/** A Stripe billing portal session for the company, for its subscription. */
export const billingPortalUrl = defineServiceFn({
  input: z.object({}),
  permission: { update: "settings" },
  async run(ctx) {
    try {
      const plans = await ctx.asCaller.supabase
        .from("plan")
        .select("stripePriceId")
        .eq("userBasedPricing", true);
      const priceIds = plans.data?.map((plan) => plan.stripePriceId);
      const url = await getBillingPortalRedirectUrl({
        companyId: ctx.company.id,
        priceIds
      });
      return { url };
    } catch (err) {
      return ctx.error("internal", "Failed to access billing portal", err);
    }
  }
});

/**
 * Transfer ownership of the company group to another user.
 *
 * @remarks
 * The owner holds billing and the group's administrative settings.
 */
export const transferCompanyOwnership = defineServiceFn({
  input: z.object({ newOwnerId: z.string().min(1) }),
  permission: { update: "settings" },
  async run(ctx, { newOwnerId }) {
    const { error } = await ctx.asCaller.supabase
      .from("companyGroup")
      .update({ ownerId: newOwnerId })
      .eq("id", ctx.company.groupId);
    if (error) {
      return ctx.error("internal", "Failed to transfer ownership", error);
    }
    return { ownerId: newOwnerId };
  }
});

/**
 * Set the tags of some records of one table.
 *
 * @remarks
 * Replaces the `tags` of each record. Row-level security decides which
 * records the caller may change.
 */
export const setRecordTags = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    ids: z.array(z.string()),
    tags: z.array(z.string())
  }),
  permission: {},
  async run(ctx, { table, ids, tags }) {
    const { error } = await ctx.asCaller.supabase
      // @ts-expect-error: the table is the caller's, for any taggable record
      .from(table)
      .update(
        unchecked({
          tags,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in(unchecked("id"), ids);
    if (error) return ctx.error("internal", "Failed to update tags", error);
    return { ids };
  }
});

/**
 * Set the custom field values of some records of one table.
 *
 * @remarks
 * Replaces the `customFields` of each record. Row-level security decides
 * which records the caller may change.
 */
export const setRecordCustomFields = defineServiceFn({
  input: z.object({
    table: z.string().min(1),
    ids: z.array(z.string()),
    customFields: z.record(z.string(), z.unknown())
  }),
  permission: {},
  async run(ctx, { table, ids, customFields }) {
    const { error } = await ctx.asCaller.supabase
      // @ts-expect-error: the table is the caller's, for any record with custom fields
      .from(table)
      .update(
        unchecked({
          customFields,
          updatedBy: ctx.auditUserId,
          updatedAt: datetime.timestamp()
        })
      )
      .in(unchecked("id"), ids);
    if (error) {
      return ctx.error("internal", "Failed to update custom fields", error);
    }
    return { ids };
  }
});
