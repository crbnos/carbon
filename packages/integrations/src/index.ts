import { ExchangeRates } from "./exchange-rates/config";
import { Onshape } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
import { Resend } from "./resend/config";
import { Sage } from "./sage/config";
import { Slack } from "./slack/config";
import { Xero } from "./xero/config";
import { Zapier } from "./zapier/config";

export { Resend } from "./resend/config";
export type { IntegrationConfig } from "./types";

export const integrations = [
  ExchangeRates,
  Resend,
  PaperlessParts,
  Onshape,
  Slack,
  Sage,
  QuickBooks,
  Xero,
  Zapier,
];

export { Onshape, Logo as OnshapeLogo } from "./onshape/config";
export { Slack } from "./slack/config";

// TODO: export as @carbon/integrations/paperless
export { PaperlessPartsClient } from "./paperless-parts/lib/client";
