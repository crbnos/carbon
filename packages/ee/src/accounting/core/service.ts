import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Accounting, TablesWithExternalId } from "../entities";
import { XeroProvider } from "../providers";
import {
  ExternalIdSchema,
  ProviderCredentials,
  ProviderCredentialsSchema,
  ProviderID
} from "./models";
import { AccountingSyncPayload } from "./sync";

export const getAccountingIntegration = async <T extends ProviderID>(
  client: SupabaseClient<Database>,
  companyId: string,
  provider: T
) => {
  const integration = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId)
    .eq("id", provider)
    .single();

  if (integration.error || !integration.data) {
    throw new Error(
      `No ${provider} integration found for company ${companyId}`
    );
  }

  const config = ProviderCredentialsSchema.safeParse(integration.data.metadata);

  if (!config.success) {
    console.error(integration.error);
    throw new Error("Invalid provider config");
  }

  return {
    id: provider as T,
    config: config.data
  } as const;
};

export const getProviderIntegration = (
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  config?: ProviderCredentials
) => {
  const { accessToken, refreshToken, tenantId } = config ?? {};

  // Create a callback function to update the integration metadata when tokens are refreshed
  const onTokenRefresh = async (auth: ProviderCredentials) => {
    try {
      console.log("Refreshing tokens for", provider, "integration");
      const update: ProviderCredentials = {
        ...auth,
        expiresAt:
          auth.expiresAt || new Date(Date.now() + 3600000).toISOString(), // Default to 1 hour if not provided
        tenantId: auth.tenantId || tenantId
      };

      await client
        .from("companyIntegration")
        .update({ metadata: update })
        .eq("companyId", companyId)
        .eq("id", provider);

      console.log(
        `Updated ${provider} integration metadata for company ${companyId}`,
        config
      );
    } catch (error) {
      console.error(
        `Failed to update ${provider} integration metadata:`,
        error
      );
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
    case "xero":
      return new XeroProvider({
        companyId,
        tenantId,
        accessToken,
        refreshToken,
        clientId: process.env.XERO_CLIENT_ID!,
        clientSecret: process.env.XERO_CLIENT_SECRET!,
        redirectUri: process.env.XERO_REDIRECT_URI,
        onTokenRefresh
      });
    // Add other providers as needed
    // case "sage":
    //   return new SageProvider(config);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
};

export const getContactFromExternalId = async (
  client: SupabaseClient<Database>,
  companyId: string,
  provider: ProviderID,
  id: string
) => {
  const contact = await client
    .from("contact")
    .select("*")
    .eq("companyId", companyId)
    .eq("externalId->>provider", provider)
    .eq("externalId->>id", id)
    .single();

  if (contact.error || !contact.data) {
    return null;
  }

  const externalId = await ExternalIdSchema.safeParseAsync(
    contact.data.externalId
  );

  if (!externalId.success) {
    throw new Error("Invalid external ID format");
  }

  return {
    ...contact.data,
    externalId
  };
};

export const getEntityWithExternalId = async <T extends TablesWithExternalId>(
  client: SupabaseClient<Database>,
  table: T,
  companyId: string,
  provider: ProviderID,
  select: { externalId: string } | { id: string }
) => {
  let query = client
    .from(table as any) // Supabase typing issue
    .select("*")
    .eq("companyId", companyId)
    .eq(`externalId->${provider}->>provider`, provider);

  if ("id" in select) {
    query = query.eq("id", select.id);
  }

  if ("externalId" in select) {
    query = query.eq(`externalId->${provider}->>id`, select.externalId);
  }

  const entry = await query.maybeSingle();

  if (!entry.data) {
    return null;
  }

  const externalId = await ExternalIdSchema.safeParseAsync(
    // @ts-expect-error Supabase typing issue
    entry.data.externalId
  );

  if (!externalId.success) {
    throw new Error("Invalid external ID format");
  }

  return {
    ...(entry.data as unknown as Omit<
      Database["public"]["Tables"][T]["Row"],
      "externalId"
    >),
    externalId: externalId.data
  };
};

export const upsertAccountingCustomer = async (
  client: SupabaseClient<Database>,
  remote: Accounting.Contact,
  payload: AccountingSyncPayload
) => {};

export const upsertAccountingContact = async (
  tx: KyselyTx,
  remote: Accounting.Contact,
  customerId: string,
  payload: AccountingSyncPayload
) => {};
