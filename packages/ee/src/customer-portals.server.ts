import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial customer-portal AUTHORING — creating, editing, and deleting a
 * company's customer portals, gated via the `CUSTOMER_PORTALS` feature. A
 * customer portal is an `externalLink` row with `documentType: "Customer"`.
 *
 * These functions are DEDICATED to customer portals and do NOT touch the shared
 * `upsertExternalLink` in `shared.service.ts`, which ALSO mints quote / RFQ /
 * supplier-quote share links for community users — gating that shared function
 * would break quote finalization. The public share page and the portal reads
 * (`getCustomerPortals` / `getCustomerPortal`) DEGRADE via `companyHasFeature`
 * and stay in the community module; only the write body is commercial.
 *
 * The entitlement LOCK lives INSIDE these commercial functions (see
 * `entitlements.server`) so it cannot be stripped from open-licensed app code.
 * Keeping the delete here also removes it as an ungated `shared_deleteCustomerPortal`
 * MCP tool — an ungated MCP write path would otherwise route around the gate.
 */

export async function upsertCustomerPortal(
  client: SupabaseClient<Database>,
  companyId: string,
  portal:
    | Omit<Database["public"]["Tables"]["externalLink"]["Insert"], "companyId">
    | (Database["public"]["Tables"]["externalLink"]["Update"] & {
        id: string;
      })
) {
  await requireEntitlement(client, companyId, "CUSTOMER_PORTALS");

  if ("id" in portal && portal.id) {
    return client
      .from("externalLink")
      .update({ ...portal, documentType: "Customer" })
      .eq("id", portal.id)
      .eq("companyId", companyId)
      .select("id")
      .single();
  }

  return client
    .from("externalLink")
    .insert({
      ...portal,
      documentType: "Customer",
      companyId
    } as Database["public"]["Tables"]["externalLink"]["Insert"])
    .select("id")
    .single();
}

export async function deleteCustomerPortal(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  await requireEntitlement(client, companyId, "CUSTOMER_PORTALS");

  return client
    .from("externalLink")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}
