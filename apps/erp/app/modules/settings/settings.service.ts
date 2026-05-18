import { SUPABASE_URL } from "@carbon/auth";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { AuthContextHolder, getAuthClient, mcpTool } from "~/services/mcp";
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

export const getAccountsPayableBillingAddress = mcpTool(
  {
    classification: "READ"
  },
  async function getAccountsPayableBillingAddress() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyAccountsPayableBillingAddress")
      .select("*")
      .eq("id", companyId)
      .single();
  }
);

export const getAccountsReceivableBillingAddress = mcpTool(
  {
    classification: "READ"
  },
  async function getAccountsReceivableBillingAddress() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyAccountsReceivableBillingAddress")
      .select("*")
      .eq("id", companyId)
      .single();
  }
);

export const updateAccountsPayableBillingAddress = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsPayableBillingAddress(
    data: z.infer<typeof accountsPayableBillingAddressValidator>,
    updatedBy: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyAccountsPayableBillingAddress")
      .update(sanitize({ ...data, updatedBy }))
      .eq("id", companyId);
  }
);

export const updateAccountsReceivableBillingAddress = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsReceivableBillingAddress(
    data: z.infer<typeof accountsReceivableBillingAddressValidator>,
    updatedBy: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyAccountsReceivableBillingAddress")
      .update(sanitize({ ...data, updatedBy }))
      .eq("id", companyId);
  }
);

export const deactivateWebhooks = mcpTool(
  {
    classification: "WRITE"
  },
  async function deactivateWebhooks() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("webhook")
      .update({ active: false })
      .eq("companyId", companyId);
  }
);

export const deleteApiKey = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteApiKey(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("apiKey").delete().eq("id", id);
  }
);

export const deleteSubsidiary = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteSubsidiary() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("company").delete().eq("id", companyId);
  }
);

export const deleteWebhook = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteWebhook(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("webhook").delete().eq("id", id);
  }
);

export const getApiKeys = mcpTool(
  {
    classification: "READ"
  },
  async function getApiKeys(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getCompanies = mcpTool(
  {
    classification: "READ"
  },
  async function getCompanies() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
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
        companyGroupName:
          (companyGroup as { name: string } | null)?.name ?? null,
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
);

export const getCompany = mcpTool(
  {
    classification: "READ"
  },
  async function getCompany() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getCompanyIntegrations = mcpTool(
  {
    classification: "READ"
  },
  async function getCompanyIntegrations() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyIntegration")
      .select("*")
      .eq("companyId", companyId);
  }
);

export const getCompanyPlan = mcpTool(
  {
    classification: "READ"
  },
  async function getCompanyPlan() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("companyPlan").select("*").eq("id", companyId).single();
  }
);

export const getCompanySettings = mcpTool(
  {
    classification: "READ"
  },
  async function getCompanySettings() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .select("*")
      .eq("id", companyId)
      .single();
  }
);

export const getConfig = mcpTool(
  {
    classification: "READ"
  },
  async function getConfig() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("config").select("*").single();
  }
);

export const getCurrentSequence = mcpTool(
  {
    classification: "READ"
  },
  async function getCurrentSequence(table: string) {
    const sequence = await getSequence(table);
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
);

export const getCustomField = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomField(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("customField").select("*").eq("id", id).single();
  }
);

export const getCustomFields = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomFields(table: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("customFieldTables")
      .select("*")
      .eq("table", table)
      .eq("companyId", companyId)
      .single();
  }
);

export const getCustomFieldsTables = mcpTool(
  {
    classification: "READ"
  },
  async function getCustomFieldsTables(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getIntegration = mcpTool(
  {
    classification: "READ"
  },
  async function getIntegration(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companyIntegration")
      .select("*")
      .eq("id", id)
      .eq("companyId", companyId)
      .maybeSingle();
  }
);

export const getIntegrations = mcpTool(
  {
    classification: "READ"
  },
  async function getIntegrations() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("integrations").select("*").eq("companyId", companyId);
  }
);

export const getKanbanOutputSetting = mcpTool(
  {
    classification: "READ"
  },
  async function getKanbanOutputSetting() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .select("kanbanOutput")
      .eq("id", companyId)
      .single();
  }
);

export const getNextSequence = mcpTool(
  {
    classification: "READ"
  },
  async function getNextSequence(table: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.rpc("get_next_sequence", {
      sequence_name: table,
      company_id: companyId
    });
  }
);

export const getPlanById = mcpTool(
  {
    classification: "READ"
  },
  async function getPlanById(planId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("plan").select("*").eq("id", planId).single();
  }
);

export const getPlans = mcpTool(
  {
    classification: "READ"
  },
  async function getPlans() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("plan").select("*");
  }
);

export const getSequence = mcpTool(
  {
    classification: "READ"
  },
  async function getSequence(table: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("sequence")
      .select("*")
      .eq("table", table)
      .eq("companyId", companyId)
      .single();
  }
);

export const getSequences = mcpTool(
  {
    classification: "READ"
  },
  async function getSequences(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getSequencesList = mcpTool(
  {
    classification: "READ"
  },
  async function getSequencesList(table: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("sequence")
      .select("id")
      .eq("table", table)
      .eq("companyId", companyId)
      .order("table");
  }
);

export const getSubsidiaries = mcpTool(
  {
    classification: "READ"
  },
  async function getSubsidiaries(companyGroupId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("company")
      .select(
        "id, name, baseCurrencyCode, countryCode, parentCompanyId, isEliminationEntity, active"
      )
      .eq("companyGroupId", companyGroupId)
      .order("name");
  }
);

export const getSubsidiary = mcpTool(
  {
    classification: "READ"
  },
  async function getSubsidiary() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("company").select("*").eq("id", companyId).single();
  }
);

export const getTerms = mcpTool(
  {
    classification: "READ"
  },
  async function getTerms() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("terms").select("*").eq("id", companyId).single();
  }
);

export const getWebhook = mcpTool(
  {
    classification: "READ"
  },
  async function getWebhook(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("webhook").select("*").eq("id", id).single();
  }
);

export const getWebhooks = mcpTool(
  {
    classification: "READ"
  },
  async function getWebhooks(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const getWebhookTables = mcpTool(
  {
    classification: "READ"
  },
  async function getWebhookTables() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("webhookTable").select("*").order("name");
  }
);

export const insertCompany = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertCompany(
    company: z.infer<typeof companyValidator>,
    companyGroupId?: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("company")
      .insert({ ...company, companyGroupId })
      .select("id")
      .single();
  }
);

export const insertSubsidiary = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertSubsidiary(
    subsidiary: z.infer<typeof subsidiaryValidator> & {
      companyGroupId: string;
      createdBy: string;
      isEliminationEntity?: boolean;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { id: _, ...data } = subsidiary;
    return client.from("company").insert(data).select("id").single();
  }
);

export const updateSubsidiary = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSubsidiary(
    id: string,
    subsidiary: Partial<z.infer<typeof subsidiaryValidator>> & {
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { id: _, ...data } = subsidiary;
    return client.from("company").update(data).eq("id", id);
  }
);

export async function seedCompany(parentCompanyId?: string) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { userId, companyId } = AuthContextHolder.get();
  return client.functions.invoke("seed-company", {
    body: {
      companyId,
      userId,
      parentCompanyId
    }
  });
}

export const updateCompanyPlan = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateCompanyPlan(data: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    stripeSubscriptionStatus: string;
    subscriptionStartDate: string;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // Extract companyId and build the update data without it
    const { companyId, ...updateData } = data;

    return client.from("companyPlan").update(updateData).eq("id", companyId);
  }
);

export const updateDefaultCustomerCc = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateDefaultCustomerCc(defaultCustomerCc: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update({ defaultCustomerCc })
      .eq("companyId", companyId);
  }
);

export const updateCompany = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateCompany(
    company: Partial<z.infer<typeof companyValidator>> & {
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client.from("company").update(sanitize(company)).eq("id", companyId);
  }
);

export async function updateShelfLifeSettings(settings: {
  /** undefined disables expiry badges company-wide. */
  nearExpiryWarningDays: number | undefined;
  /** Seed for the "Shelf-life (days)" input on new items. */
  defaultShelfLifeDays: number;
  /** MIN expiry scope for Calculated-mode finished products. */
  calculatedInputScope: "AllInputs" | "ManagedInputsOnly";
  /** Policy enforced when an operator consumes an expired entity. */
  expiredEntityPolicy: "Warn" | "Block" | "BlockWithOverride";
}) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
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

export const updateDigitalQuoteSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateDigitalQuoteSetting(
    digitalQuoteEnabled: boolean,
    digitalQuoteNotificationGroup: string[],
    digitalQuoteIncludesPurchaseOrders: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const updateIntegrationMetadata = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateIntegrationMetadata(
    integrationId: string,
    metadata: any,
    updatedBy?: string
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
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
);

export const updateJobTravelerWorkInstructions = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateJobTravelerWorkInstructions(
    jobTravelerIncludeWorkInstructions: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ jobTravelerIncludeWorkInstructions }))
      .eq("id", companyId);
  }
);

export async function updateAccountingEnabledSetting(
  accountingEnabled: boolean
) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client
    .from("companySettings")
    .update(sanitize({ accountingEnabled }))
    .eq("id", companyId);
}

export const updateTimeCardSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateTimeCardSetting(timeCardEnabled: boolean) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ timeCardEnabled }))
      .eq("id", companyId);
  }
);

export const updateKanbanOutputSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateKanbanOutputSetting(
    kanbanOutput: (typeof kanbanOutputTypes)[number]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ kanbanOutput }))
      .eq("id", companyId);
  }
);

export const updateLogoDark = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLogoDark(logoDark: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(
        sanitize({
          logoDark
        })
      )
      .eq("id", companyId);
  }
);

export const updateLogoDarkIcon = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLogoDarkIcon(logoDarkIcon: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(sanitize({ logoDarkIcon }))
      .eq("id", companyId);
  }
);

export const updateLogoLight = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLogoLight(logoLight: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(sanitize({ logoLight }))
      .eq("id", companyId);
  }
);

export const updateLogoLightIcon = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLogoLightIcon(logoLightIcon: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(sanitize({ logoLightIcon }))
      .eq("id", companyId);
  }
);

export const updateLogoWatermark = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLogoWatermark(logoWatermark: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(sanitize({ logoWatermark }))
      .eq("id", companyId);
  }
);

export const updateMaintenanceDispatchNotificationSettings = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateMaintenanceDispatchNotificationSettings(settings: {
    maintenanceDispatchNotificationGroup?: string[];
    qualityDispatchNotificationGroup?: string[];
    operationsDispatchNotificationGroup?: string[];
    otherDispatchNotificationGroup?: string[];
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize(settings))
      .eq("id", companyId);
  }
);

export const updateMaterialGeneratedIdsSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateMaterialGeneratedIdsSetting(
    materialGeneratedIds: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ materialGeneratedIds }))
      .eq("id", companyId);
  }
);

export const updateMetricSettings = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateMetricSettings(useMetric: boolean) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ useMetric }))
      .eq("id", companyId);
  }
);

export const updateProductLabelSize = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateProductLabelSize(productLabelSize: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ productLabelSize }))
      .eq("id", companyId);
  }
);

export const updatePurchasePriceUpdateTimingSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchasePriceUpdateTimingSetting(
    purchasePriceUpdateTiming: (typeof purchasePriceUpdateTimingTypes)[number]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ purchasePriceUpdateTiming }))
      .eq("id", companyId);
  }
);

export const updateLeadTimesOnReceiptSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateLeadTimesOnReceiptSetting(
    updateLeadTimesOnReceipt: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return (client.from("companySettings") as any)
      .update(sanitize({ updateLeadTimesOnReceipt }))
      .eq("id", companyId);
  }
);

export const updateAccountsPayableAddressSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsPayableAddressSetting(
    accountsPayableAddress: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ accountsPayableAddress }))
      .eq("id", companyId);
  }
);

export const updateAccountsReceivableAddressSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsReceivableAddressSetting(
    accountsReceivableAddress: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ accountsReceivableAddress }))
      .eq("id", companyId);
  }
);

export const updateAccountsPayableEmail = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsPayableEmail(
    accountsPayableEmail: string | undefined
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ accountsPayableEmail: accountsPayableEmail ?? null }))
      .eq("id", companyId);
  }
);

export const updateAccountsReceivableEmail = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAccountsReceivableEmail(
    accountsReceivableEmail: string | undefined
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(
        sanitize({ accountsReceivableEmail: accountsReceivableEmail ?? null })
      )
      .eq("id", companyId);
  }
);

export const updateQuoteLineCategoryMarkups = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateQuoteLineCategoryMarkups(
    quoteLineCategoryMarkups: Record<string, number>
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ quoteLineCategoryMarkups }))
      .eq("id", companyId);
  }
);

export const updatePurchasingPdfThumbnails = mcpTool(
  {
    classification: "WRITE"
  },
  async function updatePurchasingPdfThumbnails(
    includeThumbnailsOnPurchasingPdfs: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ includeThumbnailsOnPurchasingPdfs }))
      .eq("id", companyId);
  }
);

export const updateRfqReadySetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateRfqReadySetting(rfqReadyNotificationGroup: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ rfqReadyNotificationGroup }))
      .eq("id", companyId);
  }
);

export const updateSalesPdfThumbnails = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSalesPdfThumbnails(
    includeThumbnailsOnSalesPdfs: boolean
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ includeThumbnailsOnSalesPdfs }))
      .eq("id", companyId);
  }
);

export const updateSequence = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSequence(
    table: string,
    sequence: Partial<z.infer<typeof sequenceValidator>> & {
      updatedBy: string;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("sequence")
      .update(sanitize(sequence))
      .eq("companyId", companyId)
      .eq("table", table);
  }
);

export const updateSuggestionNotificationSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSuggestionNotificationSetting(
    suggestionNotificationGroup: string[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("company")
      .update(sanitize({ suggestionNotificationGroup }))
      .eq("id", companyId);
  }
);

export const updateSupplierQuoteNotificationSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateSupplierQuoteNotificationSetting(
    supplierQuoteNotificationGroup: string[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ supplierQuoteNotificationGroup }))
      .eq("id", companyId);
  }
);

export const upsertApiKey = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertApiKey(
    apiKey:
      | (Omit<
          z.infer<typeof apiKeyValidator>,
          "id" | "scopes" | "expiresAt"
        > & {
          createdBy: string;
          companyId: string;
          scopes: Record<string, string[]>;
          expiresAt?: string;
          rawKey: string;
          keyHash: string;
          keyPreview: string;
        })
      | (Omit<
          z.infer<typeof apiKeyValidator>,
          "id" | "scopes" | "expiresAt"
        > & {
          id: string;
          scopes: Record<string, string[]>;
          expiresAt?: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
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
);

export const updateConsoleSetting = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateConsoleSetting(consoleEnabled: boolean) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId, companyId } = AuthContextHolder.get();
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
);

export const updateDefaultSupplierCc = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateDefaultSupplierCc(defaultSupplierCc: string[]) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("companySettings")
      .update(sanitize({ defaultSupplierCc }))
      .eq("id", companyId);
  }
);

export const upsertWebhook = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertWebhook(
    webhook:
      | (Omit<z.infer<typeof webhookValidator>, "id"> & {
          createdBy: string;
          companyId: string;
        })
      | (Omit<z.infer<typeof apiKeyValidator>, "id"> & {
          id: string;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in webhook) {
      return client.from("webhook").insert(webhook).select("id").single();
    }
    return client
      .from("webhook")
      .update(sanitize(webhook))
      .eq("id", webhook.id);
  }
);
