import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { XeroProvider } from "../providers/xero";
import type { ProviderID } from "./models";
import {
  DEFAULT_SYNC_CONFIG,
  ProviderIntegrationMetadataSchema
} from "./models";
import type { ProviderCredentials, ProviderIntegrationMetadata } from "./types";

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
      `companyId.eq.${companyOrTenantId},metadata->credentials->>tenantId.eq.${companyOrTenantId}`
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

  const config = ProviderIntegrationMetadataSchema.safeParse(
    integration.data.metadata
  );

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

export const getProviderIntegration = (
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderIntegrationMetadata
) => {
  const { accessToken, refreshToken, tenantId } = config?.credentials || {};

  // For now don't use the company level sync config
  const syncConfig = DEFAULT_SYNC_CONFIG;

  // Create a callback function to update the integration metadata when tokens are refreshed
  const onTokenRefresh = async (auth: ProviderCredentials) => {
    try {
      logger.info("Refreshing tokens for integration", { provider });
      const update: ProviderCredentials = {
        ...auth,
        expiresAt:
          auth.expiresAt || new Date(Date.now() + 3600000).toISOString(), // Default to 1 hour if not provided
        tenantId: auth.tenantId || tenantId
      };

      await client
        .from("companyIntegration")
        .update({ metadata: { ...config, credentials: update } })
        .eq("companyId", companyId)
        .eq("id", provider);
    } catch (error) {
      logger.error("Failed to update integration metadata", {
        provider,
        error
      });
    }
  };

  switch (provider) {
    // case "quickbooks": {
    //   const environment = process.env.QUICKBOOKS_ENVIRONMENT as
    //     | "production"
    //     | "sandbox";
    //   return new QuickBooksProvider({
    //     companyId,
    //     tenantId,
    //     environment: environment || "sandbox",
    //     clientId: process.env.QUICKBOOKS_CLIENT_ID!,
    //     clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
    //     redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
    //     onTokenRefresh
    //   });
    // }
    case "xero": {
      const settings = {
        defaultSalesAccountCode: config?.defaultSalesAccountCode,
        defaultPurchaseAccountCode: config?.defaultPurchaseAccountCode
      };
      logger.info("Creating XeroProvider", { settings, config });
      return new XeroProvider({
        companyId,
        tenantId,
        accessToken,
        refreshToken,
        clientId: process.env.XERO_CLIENT_ID!,
        clientSecret: process.env.XERO_CLIENT_SECRET!,
        redirectUri: process.env.XERO_REDIRECT_URI,
        syncConfig,
        onTokenRefresh,
        settings
      });
    }
    // Add other providers as needed
    // case "sage":
    //   return new SageProvider(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};
