// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  CarbonEdition,
  error,
  INTEGRATION_EARLY_ACCESS_USER_IDS,
  STRIPE_BYPASS_COMPANY_IDS
} from "@carbon/auth";
import {
  getCompanyPlanId,
  isCarbonOwnedCompany
} from "@carbon/auth/company.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { flags } from "@carbon/env/flags.server";
import { getLogger } from "@carbon/logger";
import { Edition, normalizePlanId, Plan, redirect } from "@carbon/utils";
import { now } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enforcesWithoutLicence,
  type LicenceNotice,
  licenceAllows,
  pickLicenceNotice
} from "./license/entitlement";
import { LICENCE_ENFORCED, resolveLicence } from "./license/resolve.server";

export type { LicenceNotice } from "./license/entitlement";

import {
  defaultUpgradeMessage,
  FEATURE_PLANS,
  type Feature,
  type GateSpec,
  isListedUserId,
  planMeetsRequirement,
  resolveRequirement
} from "./plan";

const logger = getLogger("ee", "licence");
const loggedPreview = new Set<string>();

/**
 * The Enterprise answer from the verified licence. While
 * LICENCE_ENFORCED is false it logs what the licence would refuse and
 * keeps today's answer, which is to allow.
 */
async function enterpriseAllows(
  spec: GateSpec,
  purpose: "author" | "run"
): Promise<boolean> {
  const licensed = licenceAllows(await resolveLicence(), spec, purpose);
  if (LICENCE_ENFORCED) return licensed;
  const key = `${purpose}:${spec.feature ?? String(spec.plan)}`;
  if (!licensed && !loggedPreview.has(key)) {
    loggedPreview.add(key);
    logger.info("licence preview: the licence would refuse this", {
      purpose,
      feature: spec.feature,
      plan: spec.plan
    });
  }
  return true;
}

/**
 * The one licence notice for settings viewers on Enterprise, or null.
 * Reads the cached resolution only.
 */
export async function getLicenceNotice(): Promise<LicenceNotice | null> {
  if (CarbonEdition !== Edition.Enterprise) return null;
  return pickLicenceNotice(await resolveLicence(), {
    now: now("UTC"),
    enforced: LICENCE_ENFORCED
  });
}

/** Whether the Enterprise licence allows authoring `feature`. */
export function licenceAllowsAuthoring(spec: GateSpec): Promise<boolean> {
  return enterpriseAllows(spec, "author");
}

function isBypassCompany(companyId: string): boolean {
  if (!STRIPE_BYPASS_COMPANY_IDS) return false;
  return STRIPE_BYPASS_COMPANY_IDS.split(",")
    .map((id) => id.trim())
    .includes(companyId);
}

/**
 * Whether this user may install an `internalOnly` integration on Carbon Cloud
 * without a Carbon email (`isIntegrationComingSoon`): the
 * `integration-early-access` flag is on for their email in this company, or their id
 * is listed in `INTEGRATION_EARLY_ACCESS_USER_IDS`. The flag's rules name the
 * users and their company, because each user also needs access to the app on
 * the provider's side (the Onshape app, in Onshape). The env list stays as a
 * fallback until a flags source is live; remove it once the users it lists
 * have flag rules.
 */
export async function hasIntegrationEarlyAccess({
  companyId,
  userId,
  email
}: {
  companyId: string;
  userId: string;
  email: string;
}): Promise<boolean> {
  return (
    isListedUserId(INTEGRATION_EARLY_ACCESS_USER_IDS, userId) ||
    flags.bool("integration-early-access", { companyId, email })
  );
}

// The plan read is `getCompanyPlanId` (`@carbon/auth`): service role, cached, and
// shared with the API-key plan gate in `requirePermissions`. A failed read
// normalizes to the lowest plan, which turns plan-gated ENFORCEMENT (storage/sales
// rules) off — fail-open. Callers are UI gates and evaluators that should not 500
// on a transient blip.
//
// The `_client` param is kept for call-site compatibility; the read never goes
// through the caller's client, whose RLS scope can hide the plan row.
async function getCompanyPlan(
  _client: SupabaseClient<Database>,
  companyId: string
): Promise<Plan> {
  return normalizePlanId(await getCompanyPlanId(companyId));
}

/**
 * The plan id to feed CLIENT-SIDE gating (`usePlanGate` / `usePlan`). It reads
 * the SAME durable source the server enforces here — `companyPlan` — plus the
 * bypass/carbon-owned grants, so the UI can never disagree with enforcement.
 *
 * The old `/x` loader sourced this from the Stripe/Redis customer cache
 * (`getStripeCustomerByCompanyId().planId`), which can go stale and gate a
 * customer whose real plan is correct — e.g. a live Partner shown an "Upgrade to
 * Business" overlay with their API keys hidden, while their keys still worked
 * because the API auth path reads `companyPlan` directly.
 *
 * Precedence mirrors `companyHasPlan`: bypass → companyPlan → carbon-owned.
 * Returns `null` off Cloud (the client neutralizes gating there anyway).
 */
export async function getPlan(
  _client: SupabaseClient<Database>,
  companyId: string
): Promise<string | null> {
  if (CarbonEdition === Edition.Enterprise) {
    return (await resolveLicence()).plan;
  }
  if (CarbonEdition !== Edition.Cloud) return null;
  if (isBypassCompany(companyId)) return Plan.Partner;

  // Reads via service role for the same reason as `getCompanyPlan` — the read
  // must not depend on the caller's RLS scope.
  const planId = await getCompanyPlanId(companyId);
  if (planId) return planId;

  // No durable plan row (never subscribed). Carbon-owned companies still get
  // Business-tier access; everyone else resolves to Unknown → gated.
  if (await isCarbonOwnedCompany(companyId)) return Plan.Business;
  return null;
}

/** Enterprise reads its licence; other self-hosted editions and bypass-listed companies pass. */
export async function companyHasPlan(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: GateSpec
): Promise<boolean> {
  if (CarbonEdition === Edition.Enterprise) {
    return enterpriseAllows(spec, "run");
  }
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
  const requirement = resolveRequirement(spec as GateSpec);
  let allowed: boolean;
  if (CarbonEdition === Edition.Enterprise) {
    allowed = await enterpriseAllows(spec as GateSpec, "run");
  } else if (CarbonEdition !== Edition.Cloud || isBypassCompany(companyId)) {
    allowed = true;
  } else {
    allowed =
      planMeetsRequirement(
        await getCompanyPlan(client, companyId),
        requirement
      ) || (await isCarbonOwnedCompany(companyId));
  }

  if (!allowed) {
    throw redirect(
      redirectTo,
      await flash(
        request,
        error(null, message ?? defaultUpgradeMessage(requirement))
      )
    );
  }
}

/**
 * The runtime entitlement check. Community is ALWAYS gated (it has no
 * licence); Enterprise reads its verified licence (`CARBON_LICENSE`);
 * Test passes; Cloud is plan-based, with bypass/carbon-owned as in
 * `companyHasPlan`. Expired licences still pass here during the grace period.
 */
export async function companyHasFeature(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: GateSpec
): Promise<boolean> {
  if (CarbonEdition === Edition.Community) return false;
  return companyHasPlan(client, companyId, spec);
}

/**
 * Whether an access-control rule is ENFORCED at runtime. On Enterprise and
 * Test an access-control feature always enforces, licence or not; every
 * other case is `companyHasFeature`. Use it where a `false` lifts a
 * restriction, never to decide whether a feature may be authored.
 */
export async function companyEnforcesFeature(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: { feature: Feature }
): Promise<boolean> {
  if (enforcesWithoutLicence(CarbonEdition, spec.feature)) return true;
  return companyHasFeature(client, companyId, spec);
}

/**
 * Every feature's runtime answer, for the client gate (`usePlanGate`). The
 * checks share one cached licence resolution on Enterprise.
 */
export async function getEntitledFeatures(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Record<Feature, boolean>> {
  const features = Object.keys(FEATURE_PLANS) as Feature[];
  let allows = (feature: Feature): Promise<boolean> =>
    companyHasFeature(client, companyId, { feature });
  if (CarbonEdition === Edition.Cloud && !isBypassCompany(companyId)) {
    // companyHasPlan's Cloud answer, with the plan read once: on a save the
    // per-request memo is off, and 16 calls would read it 16 times.
    const current = await getCompanyPlan(client, companyId);
    let owned: Promise<boolean> | undefined;
    allows = async (feature) =>
      planMeetsRequirement(current, resolveRequirement({ feature })) ||
      (owned ??= isCarbonOwnedCompany(companyId));
  }
  const answers = await Promise.all(features.map(allows));
  return Object.fromEntries(
    features.map((feature, i) => [feature, answers[i]])
  ) as Record<Feature, boolean>;
}

/** Throws a redirect with flash when `companyHasFeature` is false. */
export async function requireFeature({
  request,
  client,
  companyId,
  redirectTo,
  message,
  ...spec
}: RequirePlanArgs): Promise<void> {
  if (await companyHasFeature(client, companyId, spec as GateSpec)) return;

  throw redirect(
    redirectTo,
    await flash(
      request,
      error(
        null,
        message ?? defaultUpgradeMessage(resolveRequirement(spec as GateSpec))
      )
    )
  );
}
