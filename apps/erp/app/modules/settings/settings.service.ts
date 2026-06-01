import { SUPABASE_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { interpolateSequenceDate } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import type {
  accountsPayableBillingAddressValidator,
  accountsReceivableBillingAddressValidator,
  apiKeyValidator,
  companyValidator,
  kanbanOutputTypes,
  purchasePriceUpdateTimingTypes,
  sequenceValidator,
  subsidiaryValidator,
  webhookValidator
} from "./settings.models";

const PUBLIC_STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/public/`;

export async function getAccountsPayableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyAccountsPayableBillingAddress")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function getAccountsReceivableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyAccountsReceivableBillingAddress")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function updateAccountsPayableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string,
  data: z.infer<typeof accountsPayableBillingAddressValidator>,
  updatedBy: string
) {
  return client
    .from("companyAccountsPayableBillingAddress")
    .update(sanitize({ ...data, updatedBy }))
    .eq("id", companyId);
}

export async function updateAccountsReceivableBillingAddress(
  client: SupabaseClient<Database>,
  companyId: string,
  data: z.infer<typeof accountsReceivableBillingAddressValidator>,
  updatedBy: string
) {
  return client
    .from("companyAccountsReceivableBillingAddress")
    .upsert(sanitize({ id: companyId, ...data, updatedBy }));
}

export async function deactivateWebhooks(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("webhook")
    .update({ active: false })
    .eq("companyId", companyId);
}

export async function deleteApiKey(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("apiKey").delete().eq("id", id);
}

export async function deleteSubsidiary(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("company").delete().eq("id", companyId);
}

export async function deleteWebhook(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("webhook").delete().eq("id", id);
}

export async function getApiKeys(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("apiKey")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true }
    ]);
  }

  return query;
}

export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*, companyGroup(name)")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return {
    data: companies.data.map(({ companyGroup, ...company }) => ({
      ...company,
      companyGroupName: (companyGroup as { name: string } | null)?.name ?? null,
      logoLight: company.logoLight
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.logoLight}`
        : null,
      logoDark: company.logoDark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.logoDark}`
        : null,
      logoLightIcon: company.logoLightIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.logoLightIcon}`
        : null,
      logoDarkIcon: company.logoDarkIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.logoDarkIcon}`
        : null,
      logoWatermark: company.logoWatermark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.logoWatermark}`
        : null
    })),
    error: null
  };
}

export async function getCompany(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error) {
    return company;
  }

  return {
    data: {
      ...company.data,
      logoLight: company.data.logoLight
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoLight}`
        : null,
      logoDark: company.data.logoDark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoDark}`
        : null,
      logoLightIcon: company.data.logoLightIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoLightIcon}`
        : null,
      logoDarkIcon: company.data.logoDarkIcon
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoDarkIcon}`
        : null,
      logoWatermark: company.data.logoWatermark
        ? `${PUBLIC_STORAGE_URL_PREFIX}${company.data.logoWatermark}`
        : null
    },
    error: null
  };
}

export async function getCompanyIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);
}

export async function getCompanyPlan(
  client: SupabaseClient,
  companyId: string
) {
  return client.from("companyPlan").select("*").eq("id", companyId).single();
}

export async function getCompanySettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("*")
    .eq("id", companyId)
    .single();
}

export async function getConfig(client: SupabaseClient<Database>) {
  return client.from("config").select("*").single();
}

export async function getCurrentSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  const sequence = await getSequence(client, table, companyId);
  if (sequence.error) {
    return sequence;
  }

  const { prefix, suffix, next, size } = sequence.data;

  const currentSequence = next.toString().padStart(size, "0");
  const derivedPrefix = interpolateSequenceDate(prefix);
  const derivedSuffix = interpolateSequenceDate(suffix);

  return {
    data: `${derivedPrefix}${currentSequence}${derivedSuffix}`,
    error: null
  };
}

export async function getCustomField(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("customField").select("*").eq("id", id).single();
}

export async function getCustomFields(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("customFieldTables")
    .select("*")
    .eq("table", table)
    .eq("companyId", companyId)
    .single();
}

export async function getCustomFieldsTables(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("customFieldTables")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getIntegration(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function getIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("integrations").select("*").eq("companyId", companyId);
}

export async function getKanbanOutputSetting(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("kanbanOutput")
    .eq("id", companyId)
    .single();
}

export async function getNextSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client.rpc("get_next_sequence", {
    sequence_name: table,
    company_id: companyId
  });
}

export async function getPlanById(client: SupabaseClient, planId: string) {
  return client.from("plan").select("*").eq("id", planId).single();
}

export async function getPlans(client: SupabaseClient) {
  return client.from("plan").select("*");
}

export async function getSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("sequence")
    .select("*")
    .eq("table", table)
    .eq("companyId", companyId)
    .single();
}

export async function getSequences(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
  }
) {
  let query = client
    .from("sequence")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getSequencesList(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client
    .from("sequence")
    .select("id")
    .eq("table", table)
    .eq("companyId", companyId)
    .order("table");
}

export async function getSubsidiaries(
  client: SupabaseClient<Database>,
  companyGroupId: string
) {
  return client
    .from("company")
    .select(
      "id, name, baseCurrencyCode, countryCode, parentCompanyId, isEliminationEntity, active"
    )
    .eq("companyGroupId", companyGroupId)
    .order("name");
}

export async function getSubsidiary(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("company").select("*").eq("id", companyId).single();
}

export async function getTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("terms").select("*").eq("id", companyId).single();
}

export async function getWebhook(client: SupabaseClient<Database>, id: string) {
  return client.from("webhook").select("*").eq("id", id).single();
}

export async function getWebhooks(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("webhook")
    .select("*", {
      count: "exact"
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true }
    ]);
  }

  return query;
}

export async function getWebhookTables(client: SupabaseClient<Database>) {
  return client.from("webhookTable").select("*").order("name");
}

export async function insertCompany(
  client: SupabaseClient<Database>,
  company: z.infer<typeof companyValidator>,
  companyGroupId?: string
) {
  return client
    .from("company")
    .insert({ ...company, companyGroupId })
    .select("id")
    .single();
}

export async function insertSubsidiary(
  client: SupabaseClient<Database>,
  subsidiary: z.infer<typeof subsidiaryValidator> & {
    companyGroupId: string;
    createdBy: string;
    isEliminationEntity?: boolean;
  }
) {
  const { id: _, ...data } = subsidiary;
  return client.from("company").insert(data).select("id").single();
}

export async function updateSubsidiary(
  client: SupabaseClient<Database>,
  id: string,
  subsidiary: Partial<z.infer<typeof subsidiaryValidator>> & {
    updatedBy: string;
  }
) {
  const { id: _, ...data } = subsidiary;
  return client.from("company").update(data).eq("id", id);
}

export async function seedCompany(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  parentCompanyId?: string
) {
  return client.functions.invoke("seed-company", {
    body: {
      companyId,
      userId,
      parentCompanyId
    }
  });
}

export async function updateCompanyPlan(
  client: SupabaseClient<Database>,
  data: {
    companyId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionStatus: string;
    subscriptionStartDate: string;
  }
) {
  // Extract companyId and build the update data without it
  const { companyId, ...updateData } = data;

  return client.from("companyPlan").update(updateData).eq("id", companyId);
}

export async function updateDefaultCustomerCc(
  client: SupabaseClient<Database>,
  companyId: string,
  defaultCustomerCc: string[]
) {
  return client
    .from("companySettings")
    .update({ defaultCustomerCc })
    .eq("companyId", companyId);
}

export async function updateCompany(
  client: SupabaseClient<Database>,
  companyId: string,
  company: Partial<z.infer<typeof companyValidator>> & {
    updatedBy: string;
  }
) {
  return client.from("company").update(sanitize(company)).eq("id", companyId);
}

export async function updateShelfLifeSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  settings: {
    /** undefined disables expiry badges company-wide. */
    nearExpiryWarningDays: number | undefined;
    /** Seed for the "Shelf-life (days)" input on new items. */
    defaultShelfLifeDays: number;
    /** MIN expiry scope for Calculated-mode finished products. */
    calculatedInputScope: "AllInputs" | "ManagedInputsOnly";
    /** Policy enforced when an operator consumes an expired entity. */
    expiredEntityPolicy: "Warn" | "Block" | "BlockWithOverride";
  }
) {
  return client
    .from("companySettings")
    .update({
      inventoryShelfLife: {
        nearExpiryWarningDays: settings.nearExpiryWarningDays ?? null,
        defaultShelfLifeDays: settings.defaultShelfLifeDays,
        calculatedInputScope: settings.calculatedInputScope,
        expiredEntityPolicy: settings.expiredEntityPolicy
      }
    })
    .eq("id", companyId);
}

export async function updateDigitalQuoteSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  digitalQuoteEnabled: boolean,
  digitalQuoteNotificationGroup: string[],
  digitalQuoteIncludesPurchaseOrders: boolean
) {
  return client
    .from("companySettings")
    .update(
      sanitize({
        digitalQuoteEnabled,
        digitalQuoteNotificationGroup,
        digitalQuoteIncludesPurchaseOrders
      })
    )
    .eq("id", companyId);
}

export async function updateIntegrationMetadata(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: string,
  metadata: any,
  updatedBy?: string
) {
  return client
    .from("companyIntegration")
    .update(
      sanitize({
        metadata,
        updatedAt: new Date().toISOString(),
        updatedBy
      })
    )
    .eq("companyId", companyId)
    .eq("id", integrationId);
}

export async function updateJobTravelerWorkInstructions(
  client: SupabaseClient<Database>,
  companyId: string,
  jobTravelerIncludeWorkInstructions: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ jobTravelerIncludeWorkInstructions }))
    .eq("id", companyId);
}

export async function updateAccountingEnabledSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  accountingEnabled: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ accountingEnabled }))
    .eq("id", companyId);
}

export async function updateAssetTaxDepreciationSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  settings: {
    assetTaxDepreciationEnabled: boolean;
    assetTaxRate: number | null;
  }
) {
  return client
    .from("companySettings")
    .update(sanitize(settings))
    .eq("id", companyId);
}

export async function updateTimeCardSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  timeCardEnabled: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ timeCardEnabled }))
    .eq("id", companyId);
}

export async function updateKanbanOutputSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  kanbanOutput: (typeof kanbanOutputTypes)[number]
) {
  return client
    .from("companySettings")
    .update(sanitize({ kanbanOutput }))
    .eq("id", companyId);
}

export async function updateLogoDark(
  client: SupabaseClient<Database>,
  companyId: string,
  logoDark: string | null
) {
  return client
    .from("company")
    .update(
      sanitize({
        logoDark
      })
    )
    .eq("id", companyId);
}

export async function updateLogoDarkIcon(
  client: SupabaseClient<Database>,
  companyId: string,
  logoDarkIcon: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoDarkIcon }))
    .eq("id", companyId);
}

export async function updateLogoLight(
  client: SupabaseClient<Database>,
  companyId: string,
  logoLight: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoLight }))
    .eq("id", companyId);
}

export async function updateLogoLightIcon(
  client: SupabaseClient<Database>,
  companyId: string,
  logoLightIcon: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoLightIcon }))
    .eq("id", companyId);
}

export async function updateLogoWatermark(
  client: SupabaseClient<Database>,
  companyId: string,
  logoWatermark: string | null
) {
  return client
    .from("company")
    .update(sanitize({ logoWatermark }))
    .eq("id", companyId);
}

export async function updateMaintenanceDispatchNotificationSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  settings: {
    maintenanceDispatchNotificationGroup?: string[];
    qualityDispatchNotificationGroup?: string[];
    operationsDispatchNotificationGroup?: string[];
    otherDispatchNotificationGroup?: string[];
  }
) {
  return client
    .from("companySettings")
    .update(sanitize(settings))
    .eq("id", companyId);
}

export async function updateMaterialGeneratedIdsSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  materialGeneratedIds: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ materialGeneratedIds }))
    .eq("id", companyId);
}

export async function updateMetricSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  useMetric: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ useMetric }))
    .eq("id", companyId);
}

export async function updateProductLabelSize(
  client: SupabaseClient<Database>,
  companyId: string,
  productLabelSize: string
) {
  return client
    .from("companySettings")
    .update(sanitize({ productLabelSize }))
    .eq("id", companyId);
}

export async function updatePurchasePriceUpdateTimingSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  purchasePriceUpdateTiming: (typeof purchasePriceUpdateTimingTypes)[number]
) {
  return client
    .from("companySettings")
    .update(sanitize({ purchasePriceUpdateTiming }))
    .eq("id", companyId);
}

export async function updateLeadTimesOnReceiptSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  updateLeadTimesOnReceipt: boolean
) {
  return (client.from("companySettings") as any)
    .update(sanitize({ updateLeadTimesOnReceipt }))
    .eq("id", companyId);
}

export async function updateAccountsPayableAddressSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  accountsPayableAddress: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ accountsPayableAddress }))
    .eq("id", companyId);
}

export async function updateAccountsReceivableAddressSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  accountsReceivableAddress: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ accountsReceivableAddress }))
    .eq("id", companyId);
}

export async function updateAccountsPayableEmail(
  client: SupabaseClient<Database>,
  companyId: string,
  accountsPayableEmail: string | undefined
) {
  return client
    .from("companySettings")
    .update(sanitize({ accountsPayableEmail: accountsPayableEmail ?? null }))
    .eq("id", companyId);
}

export async function updateAccountsReceivableEmail(
  client: SupabaseClient<Database>,
  companyId: string,
  accountsReceivableEmail: string | undefined
) {
  return client
    .from("companySettings")
    .update(
      sanitize({ accountsReceivableEmail: accountsReceivableEmail ?? null })
    )
    .eq("id", companyId);
}

export async function updateQuoteLineCategoryMarkups(
  client: SupabaseClient<Database>,
  companyId: string,
  quoteLineCategoryMarkups: Record<string, number>
) {
  return client
    .from("companySettings")
    .update(sanitize({ quoteLineCategoryMarkups }))
    .eq("id", companyId);
}

export async function updatePurchasingPdfThumbnails(
  client: SupabaseClient<Database>,
  companyId: string,
  includeThumbnailsOnPurchasingPdfs: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ includeThumbnailsOnPurchasingPdfs }))
    .eq("id", companyId);
}

export async function updateRfqReadySetting(
  client: SupabaseClient<Database>,
  companyId: string,
  rfqReadyNotificationGroup: string[]
) {
  return client
    .from("companySettings")
    .update(sanitize({ rfqReadyNotificationGroup }))
    .eq("id", companyId);
}

export async function updateSalesPdfThumbnails(
  client: SupabaseClient<Database>,
  companyId: string,
  includeThumbnailsOnSalesPdfs: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ includeThumbnailsOnSalesPdfs }))
    .eq("id", companyId);
}

export async function updateSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string,
  sequence: Partial<z.infer<typeof sequenceValidator>> & {
    updatedBy: string;
  }
) {
  return client
    .from("sequence")
    .update(sanitize(sequence))
    .eq("companyId", companyId)
    .eq("table", table);
}

export async function updateSuggestionNotificationSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  suggestionNotificationGroup: string[]
) {
  return client
    .from("company")
    .update(sanitize({ suggestionNotificationGroup }))
    .eq("id", companyId);
}

export async function updateSupplierQuoteNotificationSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierQuoteNotificationGroup: string[]
) {
  return client
    .from("companySettings")
    .update(sanitize({ supplierQuoteNotificationGroup }))
    .eq("id", companyId);
}

export async function upsertApiKey(
  client: SupabaseClient<Database>,
  apiKey:
    | (Omit<z.infer<typeof apiKeyValidator>, "id" | "scopes" | "expiresAt"> & {
        createdBy: string;
        companyId: string;
        scopes: Record<string, string[]>;
        expiresAt?: string;
        rawKey: string;
        keyHash: string;
        keyPreview: string;
      })
    | (Omit<z.infer<typeof apiKeyValidator>, "id" | "scopes" | "expiresAt"> & {
        id: string;
        scopes: Record<string, string[]>;
        expiresAt?: string;
      })
) {
  if ("createdBy" in apiKey) {
    // Create: store the hash, return the raw key (caller generates both)
    // Strip rateLimit/rateLimitWindow — these are platform-controlled, not user-configurable
    const {
      scopes,
      expiresAt,
      rawKey,
      keyHash,
      rateLimit: _rl,
      rateLimitWindow: _rlw,
      ...rest
    } = apiKey as any;

    const result = await client
      .from("apiKey")
      .insert(
        sanitize({
          ...rest,
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

  // Update: update name, scopes, expiration (never the key itself)
  // Strip rateLimit/rateLimitWindow — these are platform-controlled, not user-configurable
  const {
    scopes,
    expiresAt,
    rateLimit: _rl,
    rateLimitWindow: _rlw,
    ...rest
  } = apiKey as any;
  return client
    .from("apiKey")
    .update(
      sanitize({
        ...rest,
        scopes: scopes as any,
        expiresAt: expiresAt || null
      }) as any
    )
    .eq("id", apiKey.id);
}

export async function updateConsoleSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  consoleEnabled: boolean,
  userId?: string
) {
  const update = await client
    .from("companySettings")
    .update(sanitize({ consoleEnabled }) as any)
    .eq("id", companyId);

  // When enabling, create "Console Operator" employee type if it doesn't exist
  if (consoleEnabled) {
    const existing = await client
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Console Operator")
      .maybeSingle();

    if (!existing.data) {
      const newType = await client
        .from("employeeType")
        .insert({
          name: "Console Operator",
          companyId,
          protected: true,
          systemType: "Console Operator"
        })
        .select("id")
        .single();

      // Create default permissions for the Console Operator type.
      // Only grant what's needed for MES operations — not ERP modules.
      if (newType.data) {
        const mesModules = [
          {
            module: "Production",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "Inventory",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "Resources",
            create: false,
            update: false,
            delete: false,
            view: true
          },
          {
            module: "Items",
            create: false,
            update: false,
            delete: false,
            view: true
          },
          {
            module: "Quality",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "People",
            create: false,
            update: false,
            delete: false,
            view: true
          }
        ];

        const permissions = mesModules.map((m) => ({
          employeeTypeId: newType.data.id,
          module: m.module as "Accounting",
          create: m.create ? [companyId] : [],
          update: m.update ? [companyId] : [],
          delete: m.delete ? [companyId] : [],
          view: m.view ? [companyId] : []
        }));

        await client.from("employeeTypePermission").insert(permissions);
      }
    }

    // Auto-generate a PIN for the enabling user if they don't have one
    let generatedPin: string | null = null;
    if (userId) {
      const userEmployee = await client
        .from("employee")
        .select("id, pin" as any)
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (userEmployee.data && !(userEmployee.data as any).pin) {
        generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
        await client
          .from("employee")
          .update({ pin: generatedPin } as any)
          .eq("id", userId)
          .eq("companyId", companyId);
      }
    }
  }

  return update;
}

export async function updateDefaultSupplierCc(
  client: SupabaseClient<Database>,
  companyId: string,
  defaultSupplierCc: string[]
) {
  return client
    .from("companySettings")
    .update(sanitize({ defaultSupplierCc }))
    .eq("id", companyId);
}

export async function updateShowSupplierReadableIdSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  showSupplierReadableId: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ showSupplierReadableId }))
    .eq("id", companyId);
}

export async function updateShowCustomerReadableIdSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  showCustomerReadableId: boolean
) {
  return client
    .from("companySettings")
    .update(sanitize({ showCustomerReadableId }))
    .eq("id", companyId);
}

export async function upsertWebhook(
  client: SupabaseClient<Database>,
  webhook:
    | (Omit<z.infer<typeof webhookValidator>, "id"> & {
        createdBy: string;
        companyId: string;
      })
    | (Omit<z.infer<typeof apiKeyValidator>, "id"> & {
        id: string;
      })
) {
  if ("createdBy" in webhook) {
    return client.from("webhook").insert(webhook).select("id").single();
  }
  return client.from("webhook").update(sanitize(webhook)).eq("id", webhook.id);
}
