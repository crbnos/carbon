import { getAppUrl } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { RampClient } from "./lib/client";
import { RampIntegrationMetadataSchema } from "./lib/models";
import {
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
  opts: { fireInitialSync: boolean }
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return;

  const { client } = integration;

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
  await pushChartOfAccounts(serviceRole, companyId);
  // Cost-center coding is a secondary convenience — a Ramp-side rejection here
  // must NOT abort the OAuth connect. Log and continue so the integration installs.
  try {
    await pushCostCenters(serviceRole, companyId);
  } catch (err) {
    console.warn(
      `[ramp] cost-center push failed for company ${companyId}; continuing install`,
      err
    );
  }
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

  if (opts.fireInitialSync) {
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
      await jobs.trigger("ramp-sync", { companyId, reason: "install" });
    } catch (err) {
      console.warn(
        `[ramp] initial sync enqueue failed for company ${companyId}; the hourly sweep will cover it`,
        err
      );
    }
  }
}

export async function rampOnInstall(companyId: string): Promise<void> {
  await convergeRamp(companyId, { fireInitialSync: true });
}

/**
 * Settings-save on an already-installed integration: re-converge without a fresh
 * initial sync. `ensureRampWebhook` skips the webhook re-create when one exists.
 */
export async function rampOnUpdate(companyId: string): Promise<void> {
  await convergeRamp(companyId, { fireInitialSync: false });
}

export async function rampOnUninstall(companyId: string): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) return;

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

/** Extract a connection list from either `[...]` or `{ data: [...] }`. */
function extractConnections(response: unknown): Array<{ status?: string }> {
  if (Array.isArray(response)) return response as Array<{ status?: string }>;
  if (
    response &&
    typeof response === "object" &&
    Array.isArray((response as { data?: unknown }).data)
  ) {
    return (response as { data: Array<{ status?: string }> }).data;
  }
  return [];
}

export async function rampHealthcheck(
  _companyId: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const parsed = RampIntegrationMetadataSchema.safeParse(metadata);
  if (!parsed.success) return false;

  const client = new RampClient(parsed.data.credentials);
  try {
    await client.getBusiness();
    const connections = extractConnections(
      await client.getAccountingConnections()
    );
    return connections.some((connection) =>
      isConnectionLinked(connection.status)
    );
  } catch {
    return false;
  }
}
