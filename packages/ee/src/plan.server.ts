import { CarbonEdition, error, STRIPE_BYPASS_COMPANY_IDS } from "@carbon/auth";
import { isCarbonOwnedCompany } from "@carbon/auth/company.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { Edition, normalizePlanId, type Plan } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";
import {
  defaultUpgradeMessage,
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "./plan";

function isBypassCompany(companyId: string): boolean {
  if (!STRIPE_BYPASS_COMPANY_IDS) return false;
  return STRIPE_BYPASS_COMPANY_IDS.split(",")
    .map((id) => id.trim())
    .includes(companyId);
}

async function getCompanyPlan(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Plan> {
  const { data } = await client
    .from("companyPlan")
    .select("planId")
    .eq("id", companyId)
    .single();

  return normalizePlanId(data?.planId);
}

/** Self-hosted and bypass-listed companies always pass. */
export async function companyHasPlan(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: GateSpec
): Promise<boolean> {
  if (CarbonEdition !== Edition.Cloud) return true;
  if (isBypassCompany(companyId)) return true;

  const current = await getCompanyPlan(client, companyId);
  if (planMeetsRequirement(current, resolveRequirement(spec))) return true;
  return isCarbonOwnedCompany(companyId);
}

type RequirePlanArgs = {
  request: Request;
  client: SupabaseClient<Database>;
  companyId: string;
  redirectTo: string;
  message?: string;
} & GateSpec;

/** Throws a redirect with flash error when the plan check fails. */
export async function requirePlan({
  request,
  client,
  companyId,
  redirectTo,
  message,
  ...spec
}: RequirePlanArgs): Promise<void> {
  if (CarbonEdition !== Edition.Cloud) return;
  if (isBypassCompany(companyId)) return;

  const requirement = resolveRequirement(spec as GateSpec);
  const current = await getCompanyPlan(client, companyId);

  if (
    !planMeetsRequirement(current, requirement) &&
    !(await isCarbonOwnedCompany(companyId))
  ) {
    throw redirect(
      redirectTo,
      await flash(
        request,
        error(null, message ?? defaultUpgradeMessage(requirement))
      )
    );
  }
}
