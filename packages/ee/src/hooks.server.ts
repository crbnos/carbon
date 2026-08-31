import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { emailHealthcheck } from "./email/hooks.server";
import {
  connectionsHealthy,
  readConnections,
  revokeConnectionsForPiece
} from "./integrations/connections";
import { jiraHealthcheck } from "./jira/hooks.server";
import { linearHealthcheck } from "./linear/hooks.server";
import { onshapeOnUninstall } from "./onshape/hooks.server";
import {
  quickbooksOnInstall,
  quickbooksOnUninstall
} from "./quickbooks/hooks.server";
import {
  rilletHealthcheck,
  rilletOnInstall,
  rilletOnUninstall
} from "./rillet/hooks.server";
import {
  stripeConnectHealthcheck,
  stripeConnectOnInstall,
  stripeConnectOnUninstall
} from "./stripe-connect/hooks.server";
import type { IntegrationServerHooks } from "./types";

// Onshape keeps its release webhook subscription in lockstep with the asset-sync
// toggle; the integration settings save calls this. onshapeConnectionHasWriteScope
// lets the save tell a read-only connection to reconnect before enabling sync.
export {
  ensureOnshapeReleaseWebhook,
  onshapeConnectionHasWriteScope
} from "./onshape/hooks.server";

import {
  xeroHealthcheck,
  xeroOnInstall,
  xeroOnUninstall
} from "./xero/hooks.server";

/**
 * A workflow integration is healthy when it has at least one usable account.
 *
 * Its credentials live per CONNECTION rather than on the integration row, so the
 * secret-based check the other integrations use cannot see them — and without a
 * check of its own the card reports "Healthy" unconditionally (`resolveHealth`
 * defaults to healthy when none is declared), so a revoked account read as fine
 * while every workflow step using it failed.
 *
 * Shared rather than written per vendor: nothing here is Google-specific.
 */
async function pieceConnectionsHealthy(
  companyId: string,
  pieceName: string
): Promise<boolean> {
  const connections = await readConnections(
    getCarbonServiceRole(),
    companyId,
    pieceName
  );
  return connectionsHealthy(connections);
}

/**
 * Server-side hooks registry for integrations.
 *
 * Hooks that depend on server-only modules (like getCarbonServiceRole)
 * cannot live in the integration config files because those are bundled
 * for both client and server. This registry maps integration IDs to
 * their server-only lifecycle hooks.
 */
const serverHooks: Record<string, IntegrationServerHooks> = {
  email: {
    onHealthcheck: emailHealthcheck
  },
  jira: {
    onHealthcheck: jiraHealthcheck
  },
  linear: {
    onHealthcheck: linearHealthcheck
  },
  // A workflow-integration card's whole uninstall behaviour is "revoke the accounts
  // it connected", and its `id` IS the piece name — so a new piece is this one line,
  // not a hooks file of its own.
  "google-calendar": {
    // Without this the card reports "Healthy" unconditionally — `resolveHealth`
    // defaults to healthy when an integration declares no check — so a revoked
    // account read as fine while every workflow step using it failed.
    onHealthcheck: (companyId) =>
      pieceConnectionsHealthy(companyId, "google-calendar"),
    onUninstall: (companyId) =>
      revokeConnectionsForPiece(
        getCarbonServiceRole(),
        "google-calendar",
        companyId
      )
  },
  onshape: {
    onUninstall: onshapeOnUninstall
  },
  // The accounting providers' onUpdate re-runs the same subscription
  // convergence as onInstall: a settings save on an existing install
  // self-heals the company's `${provider}-sync` subscription rows whenever
  // REQUIRED_SYNC_SUBSCRIPTIONS grows.
  quickbooks: {
    onInstall: quickbooksOnInstall,
    onUpdate: quickbooksOnInstall,
    onUninstall: quickbooksOnUninstall
  },
  rillet: {
    onHealthcheck: rilletHealthcheck,
    onInstall: rilletOnInstall,
    onUpdate: rilletOnInstall,
    onUninstall: rilletOnUninstall
  },
  xero: {
    onHealthcheck: xeroHealthcheck,
    onInstall: xeroOnInstall,
    onUpdate: xeroOnInstall,
    onUninstall: xeroOnUninstall
  },
  "stripe-connect": {
    onHealthcheck: stripeConnectHealthcheck,
    onInstall: stripeConnectOnInstall,
    onUninstall: stripeConnectOnUninstall
  }
};

export function getIntegrationServerHooks(
  integrationId: string
): IntegrationServerHooks | undefined {
  return serverHooks[integrationId];
}
