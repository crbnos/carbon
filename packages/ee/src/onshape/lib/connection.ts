// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onshape ships as two integrations that share one runtime:
 *
 * - `onshape` — Carbon's public app from the Onshape App Store, on
 *   cad.onshape.com (or a commercial Enterprise domain), authorized with the
 *   OAuth client configured on this Carbon instance (`ONSHAPE_CLIENT_*`).
 * - `onshape-government` — Onshape Government (ITAR / FedRAMP) has no public
 *   App Store, so each customer creates a PRIVATE OAuth app inside their own
 *   Enterprise and gives Carbon its client id and secret. Every tenant has its
 *   own URL, and the private app's API calls count toward the customer's own
 *   yearly API limits.
 *
 * Everything past authorization — the REST client, BOM import, asset sync, the
 * release webhook — is identical, so it asks `getOnshapeIntegration` for the
 * company's connection instead of naming an id. External-id mappings stay under
 * the `onshape` namespace for both: they identify the source system, not the
 * way it was connected.
 */
export const ONSHAPE_INTEGRATION_ID = "onshape";
export const ONSHAPE_GOVERNMENT_INTEGRATION_ID = "onshape-government";

export const ONSHAPE_INTEGRATION_IDS = [
  ONSHAPE_INTEGRATION_ID,
  ONSHAPE_GOVERNMENT_INTEGRATION_ID
] as const;

export type OnshapeIntegrationId = (typeof ONSHAPE_INTEGRATION_IDS)[number];

/** The callback a Government customer registers on their private OAuth app. */
export const ONSHAPE_GOVERNMENT_OAUTH_CALLBACK_PATH =
  "/api/integrations/onshape-government/oauth";

export const ONSHAPE_DEFAULT_BASE_URL = "https://cad.onshape.com";
export const ONSHAPE_DEFAULT_OAUTH_URL = "https://oauth.onshape.com";

export function isOnshapeIntegrationId(
  id: string | null | undefined
): id is OnshapeIntegrationId {
  return (ONSHAPE_INTEGRATION_IDS as readonly string[]).includes(id ?? "");
}

/** Is any Onshape connection among a company's installed integration ids? */
export function hasOnshapeIntegration(installed: {
  has: (id: string) => boolean;
}): boolean {
  return ONSHAPE_INTEGRATION_IDS.some((id) => installed.has(id));
}

type CompanyIntegrationRow =
  Database["public"]["Tables"]["companyIntegration"]["Row"];

/**
 * The company's Onshape connection, whichever of the two it is. Prefers the
 * ACTIVE row; a company holds at most one active Onshape connection (the
 * settings save and both OAuth callbacks refuse a second), so the order only
 * decides which INACTIVE row a caller sees when neither is active.
 */
export async function getOnshapeIntegration(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<
  | { data: CompanyIntegrationRow & { id: OnshapeIntegrationId }; error: null }
  | { data: null; error: string | null }
> {
  const result = await client
    .from("companyIntegration")
    .select("*")
    .in("id", [...ONSHAPE_INTEGRATION_IDS])
    .eq("companyId", companyId)
    .order("active", { ascending: false })
    .order("updatedAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) return { data: null, error: result.error.message };
  if (!result.data || !isOnshapeIntegrationId(result.data.id)) {
    return { data: null, error: null };
  }
  return {
    data: result.data as CompanyIntegrationRow & { id: OnshapeIntegrationId },
    error: null
  };
}

/**
 * The OTHER Onshape connection, if it is active — the one that must be
 * uninstalled before `integrationId` can be connected. Two live connections
 * would make every background job's choice of tenant arbitrary.
 */
export async function getConflictingOnshapeIntegration(
  client: SupabaseClient<Database>,
  companyId: string,
  integrationId: OnshapeIntegrationId
): Promise<OnshapeIntegrationId | null> {
  const result = await client
    .from("companyIntegration")
    .select("id")
    .in(
      "id",
      ONSHAPE_INTEGRATION_IDS.filter((id) => id !== integrationId)
    )
    .eq("companyId", companyId)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  return result.data && isOnshapeIntegrationId(result.data.id)
    ? result.data.id
    : null;
}

/**
 * Normalize a tenant URL typed by an admin (`acme.onshape.com`,
 * `https://acme.onshape.com/documents`) to its origin. Returns null when it is
 * not an https URL — tokens are only ever sent over TLS.
 */
export function normalizeOnshapeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
