// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Email } from "./email/config";
import { Jira } from "./jira/config";
import { Linear } from "./linear/config";
import { Mount } from "./mount/config";
import { Onshape, OnshapeGovernment } from "./onshape/config";
import { OnshapeV2 } from "./onshape/config-v2";
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
  OnshapeV2,
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
export { beginOAuthPopup, openOAuthPopup } from "./oauth-popup";
export {
  Logo as OnshapeLogo,
  Onshape,
  OnshapeGovernment
} from "./onshape/config";
export { OnshapeV2 } from "./onshape/config-v2";
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
export type {
  AssemblyPlan,
  AssemblyPlanItem,
  AssemblyPlanMethod,
  AssemblyPlanMethodStatus,
  AssemblyPlanRoot,
  ChangeNoticeEdit,
  ItemEdit,
  ItemMethodType,
  ItemReplenishmentSystem,
  ItemTrackingType,
  MergeResult,
  PartPlan,
  PartPlanAction,
  PartPlanRow,
  PlanItemRow,
  PlanLine,
  PlanMappingRow,
  PlanMethodRow,
  PlanOptions,
  PlanUnitOfMeasure,
  ProposedItem,
  ReleasePlan,
  ReleasePlanChild,
  ReleasePlanItem,
  ReleasePlanItemAction
} from "./onshape/panel/plan";
export {
  BOM_LINE_ITEM_TYPES,
  bomLineItemType,
  buildAssemblyPlan,
  buildPartPlan,
  buildReleasePlan,
  CHANGE_NOTICE_DESCRIPTION_MAX_LENGTH,
  CHANGE_NOTICE_NAME_MAX_LENGTH,
  changeNoticeDescriptionJson,
  defaultUnitOfMeasureCode,
  EDITABLE_ITEM_FIELDS,
  flattenNodes,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_METHOD_TYPES,
  ITEM_NAME_MAX_LENGTH,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  mergeChangeNoticeEdit,
  mergeEditsForCreates,
  mergeItemEdits,
  pickAdoptTarget,
  pickLatestRow,
  proposeItem,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./onshape/panel/plan";
export type {
  OnshapePropertyValue,
  PlanCustomField,
  PlanCustomFieldDefinition,
  PropertyMapEntry,
  UnmappedProperty
} from "./onshape/panel/properties";
export {
  CUSTOM_FIELD_DATA_TYPES,
  coerceOnshapeValue,
  MAPPABLE_VALUE_TYPES,
  mergeCustomFieldEdits,
  mergeCustomFieldValues,
  missingListOptions,
  parseProperties,
  parsePropertyMap,
  partPropertiesFromElementMetadata,
  propertyDisplayValue,
  resolveMappedFields
} from "./onshape/panel/properties";
export type { PartPushPlan } from "./onshape/panel/push-plan";
export { planPartPush } from "./onshape/panel/push-plan";
export type {
  PanelRelease,
  PanelReleaseItem,
  ReleaseCarbonItemRow,
  ReleaseRevisionLike
} from "./onshape/panel/releases";
export {
  groupRevisionsIntoReleases,
  isModelReleaseItem,
  releaseKeyFor,
  resolveReleaseStates
} from "./onshape/panel/releases";
export type {
  PanelAssemblyLineInput,
  PanelAssemblyLineStatus,
  PanelItemRow,
  PanelMappingRow,
  PanelPartStatus
} from "./onshape/panel/status";
export {
  buildAssemblyLineStatuses,
  buildPartStatuses,
  externalIdForAssembly,
  externalIdForBomLine,
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
