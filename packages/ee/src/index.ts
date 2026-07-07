import { ClaudeMCP } from "./claude-mcp/config";

export type { QuickInstallConnector } from "./claude-mcp/config";

import { Email } from "./email/config";
import { ExchangeRates } from "./exchange-rates/config";
import { Jira } from "./jira/config";
import { Linear } from "./linear/config";
import { Onshape } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
// import { Radan } from "./radan/config";
import { Sage } from "./sage/config";
import { Slack } from "./slack/config";

import { Xero } from "./xero/config";
import { Zapier } from "./zapier/config";

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
  OAuthConfig
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
  Sage,
  Slack,
  Xero,
  Zapier
];

export type IntegrationID = (typeof integrations)[number]["id"];

export { Jira } from "./jira/config";
export { Logo as OnshapeLogo, Onshape } from "./onshape/config";
// TODO: export as @carbon/ee/paperless
export { PaperlessPartsClient } from "./paperless-parts/lib/client";
export { QuickBooks } from "./quickbooks/config";
export { Slack } from "./slack/config";
export * from "./slack/lib/messages";
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
 * Quick-install connectors are external link-outs with no DB state.
 * Each user connects individually (e.g. Claude MCP).
 */
export const quickInstallConnectors = [ClaudeMCP];
