// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Email } from "./email/config";
import { Jira } from "./jira/config";
import { Linear } from "./linear/config";
import { Mount } from "./mount/config";
import { Onshape, OnshapeGovernment } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
// import { Radan } from "./radan/config";
import { Ramp } from "./ramp/config";
import { Rillet } from "./rillet/config";
import { Sage } from "./sage/config";
import { Slack } from "./slack/config";
import { StripeConnect } from "./stripe-connect/config";
import type { QuickInstallConnector } from "./types";
import { Xero } from "./xero/config";

export { Email } from "./email/config";
export { defineIntegration } from "./fns";
export type {
  Integration,
  IntegrationAction,
  IntegrationClientHooks,
  IntegrationConfig,
  IntegrationOptions,
  IntegrationServerHooks,
  IntegrationSetting,
  IntegrationSettingGroup,
  IntegrationSettingOption,
  OAuthConfig,
  QuickInstallConnector
} from "./types";

import type { SyncProviderCapabilities } from "./sync/capabilities";

// Re-exported for the settings form, which resolves THIS install's capabilities to
// decide whether a setting is reachable (`IntegrationSetting.availableWhen`).
// Both are pure — no server env is touched by importing them.
export {
  CAPABILITY_DEFAULTS,
  type ResolvedCapabilities,
  resolveCapabilities,
  type SyncProviderCapabilities
} from "./sync/capabilities";

import {
  buildIntegrationTopology,
  type CompanyIntegrationRow,
  type ProviderDescriptor
} from "./sync/topology";

export const integrations = [
  // Radan,
  Email,
  Jira,
  Linear,
  Mount,
  Onshape,
  OnshapeGovernment,
  PaperlessParts,
  QuickBooks,
  Ramp,
  Rillet,
  Sage,
  Slack,
  Xero,
  StripeConnect
];

export type IntegrationID = (typeof integrations)[number]["id"];

export { Jira } from "./jira/config";
export { Mount } from "./mount/config";
export { openOAuthPopup } from "./oauth-popup";
export {
  Logo as OnshapeLogo,
  Onshape,
  OnshapeGovernment
} from "./onshape/config";
export type { OnshapeDocument } from "./onshape/lib";
// Client-safe (no client or env imports): lets UI ask "is Onshape connected?"
// without naming either integration id.
export {
  hasOnshapeIntegration,
  isOnshapeIntegrationId,
  ONSHAPE_INTEGRATION_IDS
} from "./onshape/lib/connection";
export type { OnshapeBomNode } from "./onshape/panel/bom";
export {
  flattenBomTree,
  metadataProperty,
  parseBomTree
} from "./onshape/panel/bom";
export type { OnshapePanelContext } from "./onshape/panel/messages";
export {
  PANEL_SESSION_MESSAGE,
  parsePanelContext
} from "./onshape/panel/messages";
export type { OnshapePanelMe, OnshapePanelPaths } from "./onshape/panel/Panel";
export { OnshapePanel } from "./onshape/panel/Panel";
export type { PartPushPlan } from "./onshape/panel/push-plan";
export { planPartPush } from "./onshape/panel/push-plan";
export type {
  PanelItemRow,
  PanelMappingRow,
  PanelPartStatus
} from "./onshape/panel/status";
export {
  buildPartStatuses,
  externalIdForAssembly,
  externalIdForPart
} from "./onshape/panel/status";
// TODO: export as @carbon/ee/paperless
export { PaperlessPartsClient } from "./paperless-parts/lib/client";
export { QuickBooks } from "./quickbooks/config";
export { Ramp } from "./ramp/config";
export { Rillet } from "./rillet/config";
export { Slack } from "./slack/config";
export * from "./slack/lib/messages";
export { StripeConnect } from "./stripe-connect/config";
export { Xero } from "./xero/config";

/**
 * Retrieves an integration configuration by its unique ID.
 * @param id - The unique identifier of the integration
 * @returns The integration configuration if found, undefined otherwise
 */
export const getIntegrationConfigById = (id: IntegrationID) => {
  return integrations.find((integration) => integration.id === id);
};

/**
 * Every integration declaring a behavioural role (see `IntegrationConfig`).
 *
 * This is the replacement for the four hard-coded provider-id lists —
 * `Object.values(ProviderID)` in the accounting sweeps,
 * `ACCOUNTING_SYNC_INTEGRATION_IDS`, the inline `["xero","quickbooks","rillet"]`
 * in the accounting layout, and `.eq("id","ramp")` in the Ramp sweep. A new
 * provider joins by declaring its role, not by being added to a list.
 */
export type ProviderRole = "accounting" | "spend";

/**
 * `integrations` is a union of concrete descriptor types, and only the four
 * providers that declare a role carry the property at all — so reading it off
 * the union needs this widening rather than an `any`.
 */
const roleOf = (
  integration: (typeof integrations)[number]
): ProviderRole | undefined =>
  (integration as { providerRole?: ProviderRole }).providerRole;

export const getIntegrationsByRole = (role: ProviderRole) =>
  integrations.filter((integration) => roleOf(integration) === role);

/**
 * The registry slice `buildIntegrationTopology` needs. Lives here because this
 * is where the descriptors are; the topology core stays free of this import so
 * it does not boot the server env.
 */
export const getProviderDescriptors = (): ProviderDescriptor[] =>
  integrations.flatMap((integration) => {
    const role = roleOf(integration);
    return role
      ? [
          {
            integrationId: integration.id,
            role,
            capabilities: (
              integration as { capabilities?: SyncProviderCapabilities }
            ).capabilities,
            resolveInstallCapabilities: (
              integration as {
                resolveInstallCapabilities?: (
                  metadata: unknown
                ) => SyncProviderCapabilities | undefined;
              }
            ).resolveInstallCapabilities
          }
        ]
      : [];
  });

/** Resolve a company's integration topology from its `companyIntegration` rows. */
export const resolveIntegrationTopology = (
  rows: readonly CompanyIntegrationRow[]
) => buildIntegrationTopology(rows, getProviderDescriptors());

/** The ids of every integration declaring `role`, for `.in("id", …)` filters. */
export const getIntegrationIdsByRole = (role: ProviderRole) =>
  getIntegrationsByRole(role).map((integration) => integration.id);

export {
  IntegrationSecretUnavailableError,
  persistIntegrationSecrets,
  resolveIntegrationSecrets,
  SECRET_KEYS,
  splitSecrets
} from "./integrations/secrets";

/**
 * Quick-install connectors are external link-outs with no DB state.
 * Each user connects individually. Currently empty — the section is hidden
 * until a connector is added.
 */
export const quickInstallConnectors: QuickInstallConnector[] = [];
