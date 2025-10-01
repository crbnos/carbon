import { SUPABASE_URL } from "@carbon/auth";

import type { Database } from "@carbon/database";
import { FunctionRegion, type SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { interpolateSequenceDate } from "~/utils/string";
import { sanitize } from "~/utils/supabase";
import type {
  apiKeyValidator,
  companyValidator,
  kanbanOutputTypes,
  sequenceValidator,
  webhookValidator,
} from "./settings.models";

export async function deleteApiKey(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("apiKey").delete().eq("id", id);
}

export async function deleteWebhook(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("webhook").delete().eq("id", id);
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

export async function getApiKeys(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("apiKey")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true },
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
    .select("*")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return {
    data: companies.data.map((company) => ({
      ...company,
      logoLightIcon: company.logoLightIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoLightIcon}`
        : null,
      logoDarkIcon: company.logoDarkIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoDarkIcon}`
        : null,
      logoDark: company.logoDark
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoDark}`
        : null,
      logoLight: company.logoLight
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.logoLight}`
        : null,
    })),
    error: null,
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
      logoLightIcon: company.data.logoLightIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.data.logoLightIcon}`
        : null,
      logoDarkIcon: company.data.logoDarkIcon
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.data.logoDarkIcon}`
        : null,
      logoDark: company.data.logoDark
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.data.logoDark}`
        : null,
      logoLight: company.data.logoLight
        ? `${SUPABASE_URL}/storage/v1/object/public/public/${company.data.logoLight}`
        : null,
    },
    error: null,
  };
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

export async function getCompanyIntegrations(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);
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
    error: null,
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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

export async function getPlanById(client: SupabaseClient, planId: string) {
  return client.from("plan").select("*").eq("id", planId).single();
}

export async function getPlans(client: SupabaseClient) {
  return client.from("plan").select("*");
}

export async function getNextSequence(
  client: SupabaseClient<Database>,
  table: string,
  companyId: string
) {
  return client.rpc("get_next_sequence", {
    sequence_name: table,
    company_id: companyId,
  });
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
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "name", ascending: true },
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

export async function getTerms(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client.from("terms").select("*").eq("id", companyId).single();
}

export async function getWebhook(client: SupabaseClient<Database>, id: string) {
  return client.from("webhook").select("*").eq("id", id).single();
}

export async function getWebhookTables(client: SupabaseClient<Database>) {
  return client.from("webhookTable").select("*").order("name");
}

export async function getWebhooks(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("webhook")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: true },
    ]);
  }

  return query;
}

export async function insertCompany(
  client: SupabaseClient<Database>,
  company: z.infer<typeof companyValidator>,
  ownerId?: string
) {
  console.log("inserting company", company);
  return client
    .from("company")
    .insert({ ...company, ownerId })
    .select("id")
    .single();
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

export async function seedCompany(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  return client.functions.invoke("seed-company", {
    body: {
      companyId,
      userId,
    },
    region: FunctionRegion.UsEast1,
  });
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

export async function upsertApiKey(
  client: SupabaseClient<Database>,
  apiKey:
    | (Omit<z.infer<typeof apiKeyValidator>, "id"> & {
        createdBy: string;
        companyId: string;
      })
    | (Omit<z.infer<typeof apiKeyValidator>, "id"> & {
        id: string;
      })
) {
  if ("createdBy" in apiKey) {
    const key = `crbn_${nanoid()}`;
    return client
      .from("apiKey")
      .insert({ ...apiKey, key })
      .select("key")
      .single();
  }
  return client.from("apiKey").update(sanitize(apiKey)).eq("id", apiKey.id);
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
        digitalQuoteIncludesPurchaseOrders,
      })
    )
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
        logoDark,
      })
    )
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

export async function updateMaterialUnitsSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  useMetric: boolean
) {
  return (client.from("companySettings") as any)
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
