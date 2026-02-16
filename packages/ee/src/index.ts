import { ExchangeRates } from "./exchange-rates/config";
import { Jira } from "./jira/config";
import { Linear } from "./linear/config";
import { Onshape } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
// import { Radan } from "./radan/config";
import { Resend } from "./resend/config";
import { Sage } from "./sage/config";
import { Slack } from "./slack/config";

import { Xero } from "./xero/config";
import { Zapier } from "./zapier/config";

export { defineIntegration } from "./fns";
export { Resend } from "./resend/config";
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
  ExchangeRates,
  Jira,
  Linear,
  Onshape,
  PaperlessParts,
  QuickBooks,
  Resend,
  Sage,
  Slack,
  Xero,
  Zapier
];

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
export const getIntegrationConfigById = (id: string) => {
  return integrations.find((integration) => integration.id === id);
};
