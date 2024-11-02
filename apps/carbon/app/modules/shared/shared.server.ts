import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomFieldsTableType } from "../settings";

export async function assign(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    table: string;
    assignee: string;
  }
) {
  const { id, table, assignee } = args;

  return (
    client
      // @ts-ignore
      .from(table)
      .update({ assignee: assignee ? assignee : null })
      .eq("id", id)
  );
}

export async function getCustomFieldsCacheKey(args?: {
  companyId?: string;
  module?: string;
  table?: string;
}) {
  return `customFields:${args?.companyId}:${args?.module ?? ""}:${
    args?.table ?? ""
  }`;
}

export async function getCustomFieldsSchemas(
  client: SupabaseClient<Database>,
  args?: {
    companyId: string;
    module?: string;
    table?: string;
  }
) {
  const key = await getCustomFieldsCacheKey(args);
  let schema: CustomFieldsTableType[] | null = null;

  try {
    schema = (await redis.get(key)) as CustomFieldsTableType[] | null;
  } finally {
    if (schema) {
      return {
        data: schema as CustomFieldsTableType[],
        error: null,
      };
    }

    const query = client.from("customFieldTables").select("*");

    if (args?.companyId) {
      query.eq("companyId", args.companyId);
    }

    if (args?.module) {
      query.eq("module", args.module);
    }

    if (args?.table) {
      query.eq("table", args.table);
    }

    const result = await query;
    if (result.data) {
      await redis.set(key, JSON.stringify(result.data));
    }

    return result;
  }
}
