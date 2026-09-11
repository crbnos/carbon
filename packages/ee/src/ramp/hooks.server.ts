import { getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  clearRampConnectionMetadata,
  ensureRampConnection,
  ensureRampWebhook,
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters
} from "./lib/service";

/**
 * Ramp integration lifecycle hooks (server-only). Registered in
 * `packages/ee/src/hooks.server.ts` and exported via `@carbon/ee/ramp/hooks.server`.
 * Cloned from the Rillet hook shape.
 */

/**
 * Converge the company's Ramp integration: validate credentials, ensure the
 * accounting connection, push CoA + cost centers, and register the webhook
 * (idempotent — `ensureRampWebhook` skips when a webhookId is already set).
 */
async function convergeRamp(
  companyId: string,
  opts: { syncReason: "install" | "settings-update" }
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return;

  const { client, metadata } = integration;

  // Validate credentials up front so a bad clientId/secret fails the install
  // with a clear message rather than deep inside a push.
  try {
    await client.getBusiness();
  } catch (err) {
    throw new Error(
      `Could not reach the Ramp API with the provided credentials — check the client id and secret. ${
        (err as Error).message
      }`
    );
  }

  await ensureRampConnection(serviceRole, companyId);
  // The webhook is latency, not correctness — the hourly `ramp-sweep` is the
  // correctness guarantee. Ramp can't reach a non-public dev host
  // (erp.<branch>.dev), so webhook registration will fail locally; that must not
  // block the connect. Log and continue.
  try {
    await ensureRampWebhook(serviceRole, companyId, getAppUrl());
  } catch (err) {
    console.warn(
      `[ramp] webhook registration failed for company ${companyId}; continuing install (hourly sweep covers correctness)`,
      err
    );
  }

  // OAuth creates the credential-bearing integration row before the user maps
  // the two accounts required by the card families. Establish connectivity,
  // but do not push master data or launch finance until that setup is complete.
  if (!metadata.cardLiabilityAccountId || !metadata.statementBankAccountId) {
    return;
  }

  if (metadata.entityId) {
    let response: unknown;
    try {
      response = await client.getEntities();
    } catch (error) {
      throw new Error(`Could not validate Ramp entity ${metadata.entityId}`, {
        cause: error
      });
    }

    if (!extractEntityIds(response).has(metadata.entityId)) {
      throw new Error(
        `Ramp entity ${metadata.entityId} is not available to this connection`
      );
    }
  }

  await pushChartOfAccounts(serviceRole, companyId);
  // Converge the cost-center ("project") field + its options. It re-runs on
  // every ramp-sync too, so a Ramp-side rejection here must not abort a valid
  // connection — log and continue so the hourly sweep can retry it.
  try {
    await pushCostCenters(serviceRole, companyId);
  } catch (err) {
    console.warn(
      `[ramp] cost-center push failed for company ${companyId}; continuing convergence`,
      err
    );
  }

  // `@carbon/jobs` is deliberately NOT an `@carbon/ee` dependency (jobs -> ee,
  // never the reverse), so the `ramp-sync` task — registered in
  // packages/jobs/src/inngest/index.ts + packages/lib/src/trigger.ts — is
  // reached via a lazy runtime import resolved through the app that owns both
  // packages. The non-literal specifier keeps TS from resolving/type-checking a
  // module ee cannot see.
  // A failure to enqueue the initial sync must not fail the connect — the
  // hourly `ramp-sweep` fires `ramp-sync` for every active company regardless.
  try {
    const jobsModule = "@carbon/jobs";
    const jobs = (await import(/* @vite-ignore */ jobsModule)) as {
      trigger: (
        task: string,
        payload: { companyId: string; reason: string }
      ) => Promise<unknown>;
    };
    await jobs.trigger("ramp-sync", {
      companyId,
      reason: opts.syncReason
    });
  } catch (err) {
    console.warn(
      `[ramp] initial sync enqueue failed for company ${companyId}; the hourly sweep will cover it`,
      err
    );
  }
}

export async function rampOnInstall(companyId: string): Promise<void> {
  await convergeRamp(companyId, { syncReason: "install" });
}

/**
 * Settings-save on an already-installed integration: re-converge and launch a
 * sync only after the required account and optional entity settings validate.
 */
export async function rampOnUpdate(companyId: string): Promise<void> {
  await convergeRamp(companyId, { syncReason: "settings-update" });
}

export async function rampOnUninstall(companyId: string): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);

  if (integration) {
    const { client, metadata } = integration;

    if (metadata.webhookId) {
      try {
        await client.deleteWebhook(metadata.webhookId);
      } catch (err) {
        // Tolerate a missing webhook (already deleted).
        console.error(
          `[ramp] failed to delete webhook on uninstall (company ${companyId}): ${
            (err as Error).message
          }`
        );
      }
    }

    try {
      await client.deleteAccountingConnection();
    } catch (err) {
      // Tolerate — the connection may already be gone.
      console.error(
        `[ramp] failed to delete accounting connection on uninstall (company ${companyId}): ${
          (err as Error).message
        }`
      );
    }
  }

  // Clear the stored `webhookId`/`connectionId` so a later reinstall re-creates
  // both at Ramp instead of trusting ids that were torn down here. Runs even
  // when the integration row is already deactivated (the read above returns null
  // then, since it gates on `active`) — `clearRampConnectionMetadata` reads the
  // row directly, so a deactivated-but-present row is still cleared.
  try {
    await clearRampConnectionMetadata(serviceRole, companyId);
  } catch (err) {
    console.error(
      `[ramp] failed to clear stored webhook/connection metadata on uninstall (company ${companyId}): ${
        (err as Error).message
      }`
    );
  }
}

/** Ramp connection statuses that count as healthy/linked. */
function isConnectionLinked(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === "linked" ||
    normalized === "active" ||
    normalized === "connected"
  );
}

/** Extract a connection list from `{ connections: [...] }` (Ramp), `{ data: [...] }`, or a bare array. */
function extractConnections(response: unknown): Array<{ status?: string }> {
  if (Array.isArray(response)) return response as Array<{ status?: string }>;
  if (response && typeof response === "object") {
    // Ramp's GET /accounting/connections returns `{ connections: [...] }`.
    // Tolerate `{ data: [...] }` too for resilience.
    const obj = response as { connections?: unknown; data?: unknown };
    if (Array.isArray(obj.connections))
      return obj.connections as Array<{ status?: string }>;
    if (Array.isArray(obj.data)) return obj.data as Array<{ status?: string }>;
  }
  return [];
}

/** Extract entity ids from Ramp's `{ data }`, `{ entities }`, or bare-array shape. */
function extractEntityIds(response: unknown): Set<string> {
  let rows: unknown[] = [];
  if (Array.isArray(response)) {
    rows = response;
  } else if (response && typeof response === "object") {
    const value = response as { data?: unknown; entities?: unknown };
    if (Array.isArray(value.data)) rows = value.data;
    else if (Array.isArray(value.entities)) rows = value.entities;
  }

  return new Set(
    rows.flatMap((row) =>
      row &&
      typeof row === "object" &&
      typeof (row as { id?: unknown }).id === "string"
        ? [(row as { id: string }).id]
        : []
    )
  );
}

export async function rampHealthcheck(
  companyId: string,
  _metadata: Record<string, unknown>
): Promise<boolean> {
  // Build the client via getRampIntegration so it carries the OAuth app creds
  // and token-refresh. The health framework's passed metadata builds a client
  // with no `oauthApp`, which cannot refresh an expired oauth2 access token and
  // would report a healthy connection as unhealthy after ~1h.
  const integration = await getRampIntegration(
    getCarbonServiceRole(),
    companyId
  );
  if (!integration) return false;

  try {
    await integration.client.getBusiness();
    const connections = extractConnections(
      await integration.client.getAccountingConnections()
    );
    return connections.some((connection) =>
      isConnectionLinked(connection.status)
    );
  } catch {
    return false;
  }
}
