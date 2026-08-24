import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import z from "zod";
import {
  persistIntegrationSecrets,
  resolveIntegrationSecrets
} from "../../integrations/secrets";
import type { AccountingProvider } from "../providers";
import { QboProvider } from "../providers/quickbooks-online";
import { RilletProvider } from "../providers/rillet";
import { XeroProvider } from "../providers/xero";
import type { ProviderID } from "./models";
import {
  DEFAULT_SYNC_CONFIG,
  ProviderIntegrationMetadataSchema,
  parseStoredCredentials,
  SyncDirectionSchema
} from "./models";
import type {
  AccountingEntityType,
  GlobalSyncConfig,
  ProviderCredentials,
  ProviderIntegrationMetadata
} from "./types";

/**
 * Stored per-entity sync-config fragment. Deliberately has no defaults —
 * only the keys a company actually stored may override the defaults.
 */
const storedEntityConfigSchema = z.object({
  enabled: z.boolean().optional(),
  direction: SyncDirectionSchema.optional(),
  owner: z.enum(["carbon", "accounting"]).optional(),
  syncFromDate: z.string().datetime().optional()
});

/**
 * Resolve the effective sync config for a company by deep-merging the
 * per-entity fragments stored on `companyIntegration.metadata.syncConfig`
 * over `DEFAULT_SYNC_CONFIG`. Only `enabled`, `direction`, `owner` and
 * `syncFromDate` can be overridden; invalid fragments are ignored with a
 * warning — a bad stored config must never break sync.
 */
export function resolveSyncConfig(metadata: unknown): GlobalSyncConfig {
  const resolved: GlobalSyncConfig = {
    entities: Object.fromEntries(
      Object.entries(DEFAULT_SYNC_CONFIG.entities).map(
        ([entityType, entityConfig]) => [entityType, { ...entityConfig }]
      )
    ) as GlobalSyncConfig["entities"]
  };

  const storedEntities =
    metadata && typeof metadata === "object"
      ? (metadata as { syncConfig?: { entities?: unknown } }).syncConfig
          ?.entities
      : undefined;

  if (!storedEntities || typeof storedEntities !== "object") {
    return resolved;
  }

  for (const entityType of Object.keys(
    resolved.entities
  ) as AccountingEntityType[]) {
    const fragment = (storedEntities as Record<string, unknown>)[entityType];
    if (fragment === undefined) continue;

    const parsed = storedEntityConfigSchema.safeParse(fragment);
    if (!parsed.success) {
      logger.warning("Ignoring invalid stored sync config for entity", {
        entityType,
        issues: parsed.error.issues
      });
      continue;
    }

    resolved.entities[entityType] = {
      ...resolved.entities[entityType],
      ...parsed.data
    };
  }

  return resolved;
}

const logger = getLogger("ee", "accounting");

export const getAccountingIntegration = async <T extends ProviderID>(
  client: SupabaseClient<Database>,
  companyOrTenantId: string,
  provider: T
) => {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("id", provider)
    .or(
      // Credentials written before the providerMetadata shape kept tenantId
      // at the top level — match both paths so legacy rows stay resolvable
      `companyId.eq.${companyOrTenantId},metadata->credentials->>tenantId.eq.${companyOrTenantId},metadata->credentials->providerMetadata->>tenantId.eq.${companyOrTenantId}`
    )
    .single();

  logger.info("Fetched integration", {
    provider,
    companyOrTenantId,
    integration
  });

  if (integration.error || !integration.data) {
    throw new Error(
      `No ${provider} integration found for company or tenant ${companyOrTenantId}`
    );
  }

  // Merge vaulted secret material (accessToken/refreshToken) back into the
  // metadata before parsing, so provider construction reads credentials the same
  // as before. The tenantId/realmId used by the `.or(...)` filter above are NOT
  // secret and remain in the plaintext column, so that lookup is unaffected.
  // Vault RPCs require the service-role client.
  const { getCarbonServiceRole } = await import("@carbon/auth/client.server");
  const resolvedMetadata = await resolveIntegrationSecrets(
    getCarbonServiceRole(),
    integration.data.companyId,
    provider,
    integration.data.metadata,
    integration.data.secretRef
  );

  const config = ProviderIntegrationMetadataSchema.safeParse(resolvedMetadata);

  if (!config.success) {
    logger.error("Invalid provider config", { error: config.error });
    throw new Error("Invalid provider config");
  }

  return {
    ...integration.data,
    id: provider as T,
    metadata: config.data
  } as const;
};

export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.XERO,
  config?: ProviderIntegrationMetadata
): XeroProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.QUICKBOOKS,
  config?: ProviderIntegrationMetadata
): QboProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID.RILLET,
  config?: ProviderIntegrationMetadata
): RilletProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderIntegrationMetadata
): AccountingProvider;
export function getProviderIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderIntegrationMetadata
): AccountingProvider {
  // Reads go through the stored-credentials shim so legacy flat oauth2 rows
  // (top-level tenantId/tenantName) resolve the same as the new shape
  let credentials: ProviderCredentials | undefined;
  if (config?.credentials) {
    try {
      credentials = parseStoredCredentials(config.credentials);
    } catch (error) {
      logger.error("Invalid stored provider credentials", { provider, error });
    }
  }

  const oauthCredentials =
    credentials?.type === "oauth2" ? credentials : undefined;
  const { accessToken, refreshToken } = oauthCredentials ?? {};
  const tenantId =
    typeof oauthCredentials?.providerMetadata?.tenantId === "string"
      ? oauthCredentials.providerMetadata.tenantId
      : undefined;
  const realmId =
    typeof oauthCredentials?.providerMetadata?.realmId === "string"
      ? oauthCredentials.providerMetadata.realmId
      : undefined;

  const syncConfig = resolveSyncConfig(config);

  // Create a callback function to update the integration metadata when tokens are refreshed
  const onTokenRefresh = async (auth: ProviderCredentials) => {
    try {
      if (auth.type !== "oauth2") {
        logger.error("Unexpected credentials in provider token refresh", {
          provider,
          type: auth.type
        });
        return;
      }

      logger.info("Refreshing tokens for integration", { provider });
      // Writes always use the new shape: provider-specific fields live under
      // providerMetadata (carried over from the stored credentials)
      const update: ProviderCredentials = {
        ...auth,
        expiresAt:
          auth.expiresAt || new Date(Date.now() + 3600000).toISOString(), // Default to 1 hour if not provided
        providerMetadata: {
          ...oauthCredentials?.providerMetadata,
          ...auth.providerMetadata
        }
      };

      // Secret material is split out to Supabase Vault; only the non-secret
      // config is written back to the metadata column. Vault RPCs require the
      // service-role client.
      const { getCarbonServiceRole } = await import(
        "@carbon/auth/client.server"
      );
      await persistIntegrationSecrets(
        getCarbonServiceRole(),
        companyId,
        provider,
        {
          ...config,
          credentials: update
        }
      );
    } catch (error) {
      logger.error("Failed to update integration metadata", {
        provider,
        error
      });
    }
  };

  switch (provider) {
    case "rillet": {
      // API-key provider: no OAuth client and no token refresh — the apiKey
      // credentials variant is the whole connection
      return new RilletProvider({
        companyId,
        credentials,
        syncConfig
      });
    }
    case "quickbooks": {
      // Hosts default to production; sandbox is an explicit opt-in
      const environment =
        process.env.QUICKBOOKS_ENVIRONMENT === "sandbox"
          ? "sandbox"
          : "production";
      return new QboProvider({
        companyId,
        realmId,
        environment,
        accessToken,
        refreshToken,
        clientId: process.env.QUICKBOOKS_CLIENT_ID!,
        clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
        redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
        syncConfig,
        onTokenRefresh
      });
    }
    case "xero": {
      logger.info("Creating XeroProvider", { config });
      return new XeroProvider({
        companyId,
        tenantId,
        accessToken,
        refreshToken,
        clientId: process.env.XERO_CLIENT_ID!,
        clientSecret: process.env.XERO_CLIENT_SECRET!,
        redirectUri: process.env.XERO_REDIRECT_URI,
        syncConfig,
        onTokenRefresh
      });
    }
    // Add other providers as needed
    // case "sage":
    //   return new SageProvider(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
