import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Feature } from "./plan";
import { companyHasFeature } from "./plan.server";

/**
 * The commercial-feature LOCK. Call `requireEntitlement` at the top of every
 * commercial (`packages/ee`) feature function whose execution should require a
 * license — role authoring, approval rules, console mode, etc.
 *
 * Why this lives in `@carbon/ee` and not in an app route: the entitlement
 * decision must sit on the COMMERCIAL side of the license boundary. A gate in
 * open (community-licensed) app code is a deletable `if` — removing it is not a
 * license breach and routes around the paywall. A gate inside `@carbon/ee` can
 * only be stripped by editing commercial code, which is a breach, and the
 * feature body it guards is commercial too, so there is nothing to route around.
 * (Same design as Twenty CRM's in-service `hasFeatureOrThrow` checks.)
 *
 * `companyHasFeature` is the single source of truth for "is this company
 * entitled" — Community edition is blocked, Enterprise/Test self-hosted pass,
 * Cloud is plan-based. It is also the ONE place the future license-key server
 * plugs in (a signed, server-bound validity token), so every feature inherits
 * that enforcement without touching a call site.
 *
 * Use `requireEntitlement` (throws) at AUTHORING entry points. Use the boolean
 * `companyHasFeature` directly on RUNTIME paths that must DEGRADE rather than
 * throw when a company is not entitled (e.g. "no approval rule applies" instead
 * of crashing document creation).
 *
 * The open route may ALSO call `requireFeature` (`plan.server`) for a friendly
 * upgrade redirect — that is UX only; this is the enforcement.
 */
export class EntitlementError extends Error {
  readonly feature: Feature;

  constructor(feature: Feature, message?: string) {
    super(message ?? `${feature} requires an upgraded plan`);
    this.name = "EntitlementError";
    this.feature = feature;
  }
}

export async function requireEntitlement(
  client: SupabaseClient<Database>,
  companyId: string,
  feature: Feature
): Promise<void> {
  if (await companyHasFeature(client, companyId, { feature })) return;
  throw new EntitlementError(feature);
}
