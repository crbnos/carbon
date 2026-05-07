import { CarbonEdition, error, STRIPE_BYPASS_COMPANY_IDS } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { Edition, Plan } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";
import {
  DEFAULT_ALLOWED_PLANS,
  defaultUpgradeMessage,
  type PlanRequirement,
  planMeetsRequirement
} from "./planGate";

function isBypassCompany(companyId: string): boolean {
  if (!STRIPE_BYPASS_COMPANY_IDS) return false;
  return STRIPE_BYPASS_COMPANY_IDS.split(",")
    .map((id) => id.trim())
    .includes(companyId);
}

type RequirePlanArgs = {
  request: Request;
  client: SupabaseClient<Database>;
  companyId: string;
  redirectTo: string;
  plan?: PlanRequirement;
  message?: string;
};

/**
 * Boolean variant of {@link requirePlan}. Returns `true` when the company is
 * allowed to use a plan-gated feature, `false` otherwise. Self-hosted (non-
 * Cloud) editions and bypass-listed companies always pass. Use from server
 * code paths that need to skip a feature silently rather than redirect — e.g.
 * conditional eval inside an action.
 */
export async function companyHasPlan(
  client: SupabaseClient<Database>,
  companyId: string,
  plan: PlanRequirement = DEFAULT_ALLOWED_PLANS
): Promise<boolean> {
  if (CarbonEdition !== Edition.Cloud) return true;
  if (isBypassCompany(companyId)) return true;

  const { data } = await client
    .from("companyPlan")
    .select("planId")
    .eq("id", companyId)
    .single();

  const current = (data?.planId as Plan | undefined) ?? Plan.Unknown;
  return planMeetsRequirement(current, plan);
}

/**
 * Guard for action handlers gated behind a paid plan. Self-hosted
 * Community/Enterprise installs and bypass-listed companies are never gated.
 * Throws a redirect with a flash error if the company's plan doesn't meet
 * the requirement.
 */
export async function requirePlan({
  request,
  client,
  companyId,
  redirectTo,
  plan = DEFAULT_ALLOWED_PLANS,
  message
}: RequirePlanArgs): Promise<void> {
  if (CarbonEdition !== Edition.Cloud) return;
  if (isBypassCompany(companyId)) return;

  const { data } = await client
    .from("companyPlan")
    .select("planId")
    .eq("id", companyId)
    .single();

  const current = (data?.planId as Plan | undefined) ?? Plan.Unknown;

  if (!planMeetsRequirement(current, plan)) {
    throw redirect(
      redirectTo,
      await flash(request, error(null, message ?? defaultUpgradeMessage(plan)))
    );
  }
}
