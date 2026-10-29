// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
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

/**
 * A webhook's signing secret (`whsec_…`), created on first use and kept in
 * Supabase Vault. Null when the webhook does not exist in the company. Runtime:
 * the delivery job signs with it, so this is not gated (delivery is). The vault
 * functions refuse API roles, so `db` is the direct connection.
 */
export async function getWebhookSigningSecret(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  webhookId: string
): Promise<string | null> {
  const { rows } = await sql<{ secret: string | null }>`
    SELECT get_webhook_signing_secret(${companyId}, ${webhookId}) AS secret
  `.execute(db);
  return rows[0]?.secret ?? null;
}

// The secret functions run over the direct connection, outside RLS: reading the
// webhook through the caller's client is what proves they may see it.
async function requireVisibleWebhook(
  client: SupabaseClient<Database>,
  companyId: string,
  webhookId: string
) {
  const webhook = await client
    .from("webhook")
    .select("id")
    .eq("id", webhookId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (webhook.error) return webhook.error;
  if (!webhook.data) return { message: "Webhook not found" };
  return null;
}

export async function revealWebhookSigningSecret(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  { companyId, webhookId }: { companyId: string; webhookId: string }
): Promise<
  { data: string; error: null } | { data: null; error: { message: string } }
> {
  await requireEntitlement(client, companyId, "WEBHOOKS");
  const notVisible = await requireVisibleWebhook(client, companyId, webhookId);
  if (notVisible) return { data: null, error: notVisible };
  const secret = await getWebhookSigningSecret(db, companyId, webhookId);
  if (!secret) return { data: null, error: { message: "Webhook not found" } };
  return { data: secret, error: null };
}

/**
 * Replace a webhook's signing secret. Deliveries are signed with the new secret
 * at once, so the receiving endpoint must be updated with it.
 */
export async function rotateWebhookSigningSecret(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  { companyId, webhookId }: { companyId: string; webhookId: string }
): Promise<
  { data: string; error: null } | { data: null; error: { message: string } }
> {
  await requireEntitlement(client, companyId, "WEBHOOKS");
  const notVisible = await requireVisibleWebhook(client, companyId, webhookId);
  if (notVisible) return { data: null, error: notVisible };
  const { rows } = await sql<{ secret: string | null }>`
    SELECT rotate_webhook_signing_secret(${companyId}, ${webhookId}) AS secret
  `.execute(db);
  const secret = rows[0]?.secret;
  if (!secret) return { data: null, error: { message: "Webhook not found" } };
  return { data: secret, error: null };
}
