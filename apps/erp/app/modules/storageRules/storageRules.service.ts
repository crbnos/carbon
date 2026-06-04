// ERP-only admin CRUD for the Inventory → Storage Rules page.
// Cross-app queries (assignment loaders, list fetch for tab data, polymorphic
// assign/unassign) live in `@carbon/ee/storage-rules`.

import type { Database, Json } from "@carbon/database";
import type {
  ConditionAst,
  Severity,
  TargetType,
  TransactionSurface
} from "@carbon/utils";
import { getLocalTimeZone, now } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";

type StorageRuleFilters = {
  appliesToAll: boolean;
  filteredItemTypes?: string[];
  filteredItemGroupIds?: string[];
  filteredItemMatchAll?: boolean;
};

type StorageRuleInsert = StorageRuleFilters & {
  name: string;
  description?: string | null;
  message: string;
  severity: Severity;
  conditionAst: ConditionAst;
  surfaces: TransactionSurface[];
  targetType: TargetType;
  active: boolean;
  companyId: string;
  createdBy: string;
  customFields?: Json;
};

type StorageRuleUpdate = StorageRuleFilters & {
  id: string;
  name: string;
  description?: string | null;
  message: string;
  severity: Severity;
  conditionAst: ConditionAst;
  surfaces: TransactionSurface[];
  active: boolean;
  updatedBy: string;
  customFields?: Json;
};

export async function getStorageRules(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & {
    search: string | null;
    targetType?: TargetType | null;
  }
) {
  let query = client
    .from("storageRule")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }
  if (args?.targetType) {
    query = query.eq("targetType", args.targetType);
  }

  query = setGenericQueryFilters(query, args ?? {}, [
    { column: "name", ascending: true }
  ]);
  return query;
}

export async function getStorageRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("storageRule").select("*").eq("id", id).single();
}

export async function upsertStorageRule(
  client: SupabaseClient<Database>,
  rule: StorageRuleInsert | StorageRuleUpdate
) {
  if ("createdBy" in rule) {
    return client
      .from("storageRule")
      .insert({ ...rule, conditionAst: rule.conditionAst as unknown as Json })
      .select("id")
      .single();
  }
  return client
    .from("storageRule")
    .update({
      ...sanitize(rule),
      conditionAst: rule.conditionAst as unknown as Json,
      updatedAt: now(getLocalTimeZone()).toAbsoluteString()
    })
    .eq("id", rule.id)
    .select("id")
    .single();
}

export async function deleteStorageRule(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("storageRule").delete().eq("id", id);
}

export async function getRuleAssignmentCounts(
  client: SupabaseClient<Database>,
  ruleIds: string[]
) {
  // Counts span both assignment tables. Each rule lives in exactly one
  // (rule.targetType drives the table); union of single-table counts is correct.
  if (ruleIds.length === 0) return { data: {}, error: null };

  const counts: Record<string, number> = {};
  const tables: Array<
    "storageRuleItemAssignment" | "storageRuleWorkCenterAssignment"
  > = ["storageRuleItemAssignment", "storageRuleWorkCenterAssignment"];

  const results = await Promise.all(
    tables.map((table) =>
      (client as SupabaseClient<Database>)
        .from(table)
        .select("ruleId")
        .in("ruleId", ruleIds)
    )
  );

  for (const { data, error } of results) {
    if (error) return { data: {}, error };
    for (const row of (data ?? []) as Array<{ ruleId: string }>) {
      counts[row.ruleId] = (counts[row.ruleId] ?? 0) + 1;
    }
  }

  return { data: counts, error: null };
}
