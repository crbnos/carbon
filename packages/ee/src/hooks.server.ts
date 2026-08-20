import { emailHealthcheck } from "./email/hooks.server";
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
  }
};

export function getIntegrationServerHooks(
  integrationId: string
): IntegrationServerHooks | undefined {
  return serverHooks[integrationId];
}
