import { Email } from "./email/config";
import { ExchangeRates } from "./exchange-rates/config";
import { Jira } from "./jira/config";
import { Linear } from "./linear/config";
import { Onshape } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
// import { Radan } from "./radan/config";
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

export const integrations = [
  // Radan,
  Email,
  ExchangeRates,
  Jira,
  Linear,
  Onshape,
  PaperlessParts,
  QuickBooks,
  Rillet,
  Sage,
  Slack,
  Xero,
  StripeConnect
];

export type IntegrationID = (typeof integrations)[number]["id"];

export { Jira } from "./jira/config";
export { openOAuthPopup } from "./oauth-popup";
export { Logo as OnshapeLogo, Onshape } from "./onshape/config";
export type { OnshapeDocument } from "./onshape/lib";
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
