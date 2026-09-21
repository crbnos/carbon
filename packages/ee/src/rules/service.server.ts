// Server-only enforcement-rule AUTHORING (storage + sales families).
//
// The commercial LOCK for both rule families: every write here calls
// `requireEntitlement` before touching the DB, so the gate sits on the
// commercial side of the license boundary and cannot be stripped from open
// route code. Community edition → blocked (`STORAGE_RULES` / `SALES_RULES`).
//
// This file is server-only (`requireEntitlement` → `entitlements.server` →
// `plan.server`) and is therefore reached ONLY through `@carbon/ee/rules.server`
// (`./server.ts`), never the client-safe `@carbon/ee/rules` barrel. The
// client-safe cross-app QUERIES stay in `./sales/service.ts` / `./storage/service.ts`.

import type { Database, Json } from "@carbon/database";
import type { ConditionAst, Severity, TargetType } from "@carbon/utils";
import { datetime, sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "../entitlements.server";
import type { Feature } from "../plan";

// -----------------------------------------------------------------------------
// Enforcement Rules (storage + sales families)
// -----------------------------------------------------------------------------
// Both rule families live in ONE `enforcementRule` table discriminated by
// `family`. The admin CRUD is written once here; callers pass their family
// explicitly. The `family` discriminator also chooses the commercial feature to
// require — sales → `SALES_RULES`, storage → `STORAGE_RULES`.

export type EnforcementRuleFamily =
  Database["public"]["Enums"]["enforcementRuleFamily"];

const featureForFamily = (family: EnforcementRuleFamily): Feature =>
  family === "sales" ? "SALES_RULES" : "STORAGE_RULES";

/** Item-scoping columns shared by both families (empty arrays = every item). */
type RuleItemFilterFields = {
  filteredItemTypes?: string[];
  filteredItemGroupIds?: string[];
  filteredItemMatchAll?: boolean;
};

/**
 * Storage-family-only shape. The DB pins sales rows to `targetType: 'item'` /
 * `appliesToAll: false` via the `enforcementRule_sales_shape` CHECK, so these
 * stay optional here and simply go unset for sales.
 */
type RuleTargetFields = {
  targetType?: Database["public"]["Enums"]["enforcementRuleTargetType"];
  appliesToAll?: boolean;
};

type RuleSurfaces = Database["public"]["Enums"]["enforcementRuleSurface"][];

export type EnforcementRuleInsert = RuleItemFilterFields &
  RuleTargetFields & {
    name: string;
    description?: string | null;
    message: string;
    severity: Severity;
    conditionAst: ConditionAst;
    surfaces: RuleSurfaces;
    active: boolean;
    createdBy: string;
    customFields?: Json;
  };

export type EnforcementRuleUpdate = RuleItemFilterFields &
  RuleTargetFields & {
    id: string;
    name: string;
    description?: string | null;
    message: string;
    severity: Severity;
    conditionAst: ConditionAst;
    surfaces: RuleSurfaces;
    active: boolean;
    updatedBy: string;
    customFields?: Json;
  };

export async function upsertEnforcementRule(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  companyId: string,
  rule: EnforcementRuleInsert | EnforcementRuleUpdate
) {
  await requireEntitlement(client, companyId, featureForFamily(family));

  if ("createdBy" in rule) {
    return client
      .from("enforcementRule")
      .insert({
        ...rule,
        companyId,
        family,
        conditionAst: rule.conditionAst as unknown as Json
      })
      .select("id")
      .single();
  }
  return client
    .from("enforcementRule")
    .update({
      ...sanitize(rule),
      conditionAst: rule.conditionAst as unknown as Json,
      updatedAt: datetime.timestamp()
    })
    .eq("id", rule.id)
    .eq("family", family)
    .eq("companyId", companyId)
    .select("id")
    .single();
}

export async function deleteEnforcementRule(
  client: SupabaseClient<Database>,
  family: EnforcementRuleFamily,
  id: string,
  companyId: string
) {
  await requireEntitlement(client, companyId, featureForFamily(family));

  return client
    .from("enforcementRule")
    .delete()
    .eq("id", id)
    .eq("family", family)
    .eq("companyId", companyId);
}

// -----------------------------------------------------------------------------
// Sales-rule item assignments (SALES_RULES)
// -----------------------------------------------------------------------------

export async function assignSalesRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string; createdBy: string }
) {
  await requireEntitlement(client, args.companyId, "SALES_RULES");

  // Preflight: rule must exist in this company. Without this, callers could
  // insert a foreign rule id; the evaluator filters defensively but the
  // orphan row still inflates assignment counts.
  const ruleRes = await client
    .from("enforcementRule")
    .select("id")
    .eq("id", args.ruleId)
    .eq("companyId", args.companyId)
    .eq("family", "sales")
    .single();
  if (ruleRes.error || !ruleRes.data) {
    return {
      data: null,
      error: ruleRes.error ?? new Error("Rule not found")
    };
  }

  return client
    .from("enforcementRuleItemAssignment")
    .insert({
      itemId: args.itemId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.createdBy
    })
    .select("itemId, ruleId")
    .single();
}

export async function unassignSalesRule(
  client: SupabaseClient<Database>,
  args: { itemId: string; ruleId: string; companyId: string }
) {
  await requireEntitlement(client, args.companyId, "SALES_RULES");

  return client
    .from("enforcementRuleItemAssignment")
    .delete()
    .eq("itemId", args.itemId)
    .eq("ruleId", args.ruleId)
    .eq("companyId", args.companyId);
}

// -----------------------------------------------------------------------------
// Storage-rule target assignments (STORAGE_RULES)
// -----------------------------------------------------------------------------

const assignmentTableFor = (
  targetType: TargetType
): "enforcementRuleItemAssignment" | "enforcementRuleWorkCenterAssignment" => {
  switch (targetType) {
    case "item":
      return "enforcementRuleItemAssignment";
    case "workCenter":
      return "enforcementRuleWorkCenterAssignment";
  }
};

const targetIdColumnFor = (
  targetType: TargetType
): "itemId" | "workCenterId" => {
  switch (targetType) {
    case "item":
      return "itemId";
    case "workCenter":
      return "workCenterId";
  }
};

export async function assignStorageRule(
  client: SupabaseClient<Database>,
  args: {
    targetType: TargetType;
    targetId: string;
    ruleId: string;
    companyId: string;
    userId: string;
  }
) {
  await requireEntitlement(client, args.companyId, "STORAGE_RULES");

  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  // Preflight: rule must exist in this company, belong to the storage family,
  // and its targetType must match the assignment table. Without this, callers
  // could pin a sales rule (or a work-center rule) through the item-assignment
  // table; the evaluator filters defensively but the orphan row still inflates
  // getRuleAssignmentCounts.
  const ruleRes = await client
    .from("enforcementRule")
    .select("id, targetType")
    .eq("id", args.ruleId)
    .eq("companyId", args.companyId)
    .eq("family", "storage")
    .single();
  if (ruleRes.error || !ruleRes.data) {
    return {
      data: null,
      error: ruleRes.error ?? new Error("Rule not found")
    };
  }
  if (ruleRes.data.targetType !== args.targetType) {
    return {
      data: null,
      error: new Error(
        `Rule targetType "${ruleRes.data.targetType}" does not match "${args.targetType}"`
      )
    };
  }

  return (client as SupabaseClient<Database>)
    .from(table)
    .insert({
      [idCol]: args.targetId,
      ruleId: args.ruleId,
      companyId: args.companyId,
      createdBy: args.userId
    } as never)
    .select(`${idCol}, ruleId`)
    .single();
}

export async function unassignStorageRule(
  client: SupabaseClient<Database>,
  // `companyId` added over the original arg shape purely to scope the
  // entitlement check — the delete query itself is unchanged (RLS-scoped).
  args: {
    targetType: TargetType;
    targetId: string;
    ruleId: string;
    companyId: string;
  }
) {
  await requireEntitlement(client, args.companyId, "STORAGE_RULES");

  const table = assignmentTableFor(args.targetType);
  const idCol = targetIdColumnFor(args.targetType);

  return (client as SupabaseClient<Database>)
    .from(table)
    .delete()
    .eq(idCol, args.targetId)
    .eq("ruleId", args.ruleId);
}
