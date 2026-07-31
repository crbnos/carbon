import { getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getOnshapeClient } from "./lib/client";

// The release webhook's callback path for a company. We match/deregister by this
// PATH (not the full URL) so a host change — localhost, a tunnel, or the prod
// domain — still resolves this company's webhook(s).
function callbackPath(companyId: string): string {
  return `/api/webhook/onshape/${companyId}`;
}

// Build an Onshape client for background webhook management. Reads the installer
// (updatedBy) for token refresh/audit; falls back to "system".
async function onshapeClientForCompany(companyId: string) {
  const client = getCarbonServiceRole();
  const integration = await client
    .from("companyIntegration")
    .select("updatedBy")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();
  const userId = integration.data?.updatedBy ?? "system";
  return getOnshapeClient(client, companyId, userId);
}

// Resolve the Onshape company id to register the webhook under. Prefer the id
// stored on the integration (written here at first resolve) so every path — this
// webhook registration and the sync/backfill jobs (resolveOnshapeCompanyId in
// @carbon/jobs) — targets the SAME Onshape tenant. Fall back to the first company
// the token can see, persisting it for consistency. Returns null if none.
async function resolveAndStoreOnshapeCompanyId(
  companyId: string,
  client: Awaited<ReturnType<typeof getOnshapeClient>>["client"]
): Promise<string | null> {
  const carbon = getCarbonServiceRole();
  const integration = await carbon
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "onshape")
    .eq("companyId", companyId)
    .maybeSingle();
  const metadata = (integration.data?.metadata ?? {}) as Record<
    string,
    unknown
  >;
  const stored = metadata.onshapeCompanyId;
  if (typeof stored === "string" && stored.length > 0) return stored;

  const companies = (await client?.getCompanies()) ?? [];
  const resolved = companies[0]?.id;
  if (!resolved) return null;

  const update = await carbon
    .from("companyIntegration")
    .update({ metadata: { ...metadata, onshapeCompanyId: resolved } })
    .eq("id", "onshape")
    .eq("companyId", companyId);
  if (update.error) {
    // Non-fatal: we can still register with the resolved id; the jobs just fall
    // back to their own getCompanies() resolve if the store didn't stick.
    console.error(
      "onshape: failed to persist resolved Onshape company id",
      update.error
    );
  }
  return resolved;
}

// Onshape's write scope — needed to create translation (export) jobs and manage
// the release webhook. A connection authorized before this scope was requested
// holds a read-only token, and a refresh can't widen it (the refresh grant sends
// no scope), so the only remedy is a reconnect.
const ONSHAPE_WRITE_SCOPE = "OAuth2Write";

// Does the stored connection have write access? Read from the scope captured at
// the OAuth callback. Legacy installs predate that field (no `scope`) — treat
// them as read-only so we prompt for a reconnect rather than silently failing.
export function onshapeConnectionHasWriteScope(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  const scope = metadata?.scope;
  if (typeof scope !== "string") return false;
  return scope.split(/\s+/).includes(ONSHAPE_WRITE_SCOPE);
}

export type OnshapeWebhookResult = { ok: true } | { ok: false; error: string };

function webhookFailure(error: unknown): OnshapeWebhookResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

// Register the go-forward release webhook (onshape.revision.created). Idempotent:
// no-op if a subscription for this company's callback already exists. Never
// throws — failures are logged and returned so the caller can surface them (the
// common causes: a callback that isn't publicly reachable, or an OAuth token
// granted before OAuth2Write was requested, which can't manage webhooks until
// the user reconnects Onshape).
export async function registerOnshapeWebhook(
  companyId: string
): Promise<OnshapeWebhookResult> {
  const onshape = await onshapeClientForCompany(companyId);
  if (onshape.error || !onshape.client) {
    console.error(
      "onshape: could not build client; skipping webhook registration",
      onshape.error
    );
    return { ok: false, error: onshape.error ?? "no client" };
  }
  const path = callbackPath(companyId);
  try {
    const existing = await onshape.client.getWebhooks();
    const alreadyRegistered = (existing.items ?? []).some(
      (webhook) => typeof webhook.url === "string" && webhook.url.includes(path)
    );
    if (alreadyRegistered) return { ok: true };

    const onshapeCompanyId = await resolveAndStoreOnshapeCompanyId(
      companyId,
      onshape.client
    );
    if (!onshapeCompanyId) {
      console.error(
        "onshape: could not resolve Onshape company id; skipping webhook registration"
      );
      return { ok: false, error: "could not resolve Onshape company id" };
    }
    await onshape.client.createWebhook({
      url: `${getAppUrl()}${path}`,
      events: ["onshape.revision.created"],
      companyId: onshapeCompanyId
    });
    console.log(`onshape: registered release webhook for company ${companyId}`);
    return { ok: true };
  } catch (error) {
    console.error("onshape: webhook registration failed", error);
    return webhookFailure(error);
  }
}

// Delete Carbon's release webhook(s) for this company. Idempotent; never throws.
export async function deregisterOnshapeWebhooks(
  companyId: string
): Promise<OnshapeWebhookResult> {
  const onshape = await onshapeClientForCompany(companyId);
  if (onshape.error || !onshape.client) {
    console.error(
      "onshape: could not build client; skipping webhook cleanup",
      onshape.error
    );
    return { ok: false, error: onshape.error ?? "no client" };
  }
  const path = callbackPath(companyId);
  try {
    const webhooks = await onshape.client.getWebhooks();
    const ours = (webhooks.items ?? []).filter(
      (webhook) => typeof webhook.url === "string" && webhook.url.includes(path)
    );
    for (const webhook of ours) {
      await onshape.client.deleteWebhook(webhook.id);
    }
    console.log(
      `onshape: deregistered ${ours.length} webhook(s) for company ${companyId}`
    );
    return { ok: true };
  } catch (error) {
    console.error("onshape: webhook deregistration failed", error);
    return webhookFailure(error);
  }
}

// Keep the subscription in lockstep with the asset-sync toggle: it should exist
// iff asset sync is enabled. Called from the integration settings save — the
// universal hook point, since asset sync is off by default and every company
// (new or already-connected) must enable it there. NOTE: connections authorized
// before the OAuth2Write scope was requested hold Read-only tokens and will fail
// here until the user reconnects Onshape — the settings save surfaces that
// failure rather than swallowing it.
export async function ensureOnshapeReleaseWebhook(
  companyId: string,
  assetSyncEnabled: boolean
): Promise<OnshapeWebhookResult> {
  if (assetSyncEnabled) {
    return registerOnshapeWebhook(companyId);
  }
  return deregisterOnshapeWebhooks(companyId);
}

// Disconnect: remove the subscription so it doesn't keep firing at a dead callback.
export async function onshapeOnUninstall(companyId: string): Promise<void> {
  await deregisterOnshapeWebhooks(companyId);
}
