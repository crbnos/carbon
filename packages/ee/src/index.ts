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
export { buildPartStatuses, externalIdForPart } from "./onshape/panel/status";
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
