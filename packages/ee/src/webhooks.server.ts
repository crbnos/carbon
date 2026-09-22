import type { Database } from "@carbon/database";
import { sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Business) webhook AUTHORING — creating, editing, deleting, and
 * bulk-deactivating a company's outbound webhook subscriptions, gated to the
 * Business plan via the `WEBHOOKS` feature. The runtime DELIVERY path (the
 * `@carbon/jobs` `event-handler-webhook` inngest function) is a separate
 * concern; it degrades to a no-op for an unentitled company rather than being
 * gated here.
 *
 * The entitlement LOCK lives INSIDE these commercial functions (see
 * `entitlements.server`) so it cannot be stripped from open-licensed app code.
 *
 * The input shape is redefined locally so `@carbon/ee` never imports the app's
 * `~/modules/settings` `webhookValidator`.
 */

// Minimal input shape — mirrors `webhookValidator` (`~/modules/settings`) minus
// the optional `id`, redefined here so `@carbon/ee` never imports `~/`.
type WebhookInput = {
  name: string;
  table: string;
  url: string;
  onInsert: boolean;
  onUpdate: boolean;
  onDelete: boolean;
  active: boolean;
};

export async function upsertWebhook(
  client: SupabaseClient<Database>,
  webhook:
    | (WebhookInput & {
        createdBy: string;
        companyId: string;
      })
    | (WebhookInput & {
        id: string;
      })
) {
  if ("createdBy" in webhook) {
    await requireEntitlement(client, webhook.companyId, "WEBHOOKS");
    return client.from("webhook").insert(webhook).select("id").single();
  }

  // The update input carries no companyId — read it from the row so the
  // entitlement check (the lock) can run before the write.
  const existing = await client
    .from("webhook")
    .select("companyId")
    .eq("id", webhook.id)
    .single();

  if (existing.error || !existing.data) {
    return {
      data: null,
      error: existing.error || { message: "Webhook not found" }
    };
  }

  await requireEntitlement(client, existing.data.companyId, "WEBHOOKS");
  return client.from("webhook").update(sanitize(webhook)).eq("id", webhook.id);
}

export async function deleteWebhook(
  client: SupabaseClient<Database>,
  id: string
) {
  // The input carries no companyId — read it from the row so the entitlement
  // check (the lock) can run before the delete.
  const existing = await client
    .from("webhook")
    .select("companyId")
    .eq("id", id)
    .single();

  if (existing.error || !existing.data) {
    return {
      data: null,
      error: existing.error || { message: "Webhook not found" }
    };
  }

  await requireEntitlement(client, existing.data.companyId, "WEBHOOKS");
  return client.from("webhook").delete().eq("id", id);
}

export async function deactivateWebhooks(
  client: SupabaseClient<Database>,
  companyId: string
) {
  await requireEntitlement(client, companyId, "WEBHOOKS");
  return client
    .from("webhook")
    .update({ active: false })
    .eq("companyId", companyId);
}
