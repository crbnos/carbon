import type { Database, Json } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { sanitize } from "~/utils/supabase";
import type { customFieldValidator } from "./settings.models";

const INTEGRATION_CACHE_TTL = 3600;

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
    await redis.del(cacheKey);
  } catch (error) {
    console.error("Redis cache invalidation error:", error);
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
      updatedAt: new Date().toISOString(),
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
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached as string);
    }
  } catch (error) {
    console.error("Redis cache read error:", error);
  }

  const { data, error } = await client
    .from("companyIntegration")
    .select("*")
    .eq("companyId", companyId);

  if (error) {
    throw error;
  }

  const integrations = data || [];

  try {
    await redis.setex(
      cacheKey,
      INTEGRATION_CACHE_TTL,
      JSON.stringify(integrations)
    );
  } catch (error) {
    console.error("Redis cache write error:", error);
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
  const integration = await getCompanyIntegration(client, companyId, "slack");

  if (!integration?.metadata) {
    return null;
  }

  const metadata = integration.metadata as any;

  if (!metadata.access_token) {
    return null;
  }

  return {
    token: metadata.access_token,
    channelId: metadata.channel_id || metadata.default_channel_id,
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
  const result = await client
    .from("companyIntegration")
    .upsert([update])
    .select()
    .single();

  if (result.error) {
    return result;
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
          updatedBy: customField.updatedBy,
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
