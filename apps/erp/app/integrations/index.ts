import { ExchangeRates } from "./exchange-rates/config";
import { Onshape } from "./onshape/config";
import { PaperlessParts } from "./paperless-parts/config";
import { QuickBooks } from "./quickbooks/config";
import { Resend } from "./resend/config";
import { Slack } from "./slack/config";
import { Xero } from "./xero/config";
import { Zapier } from "./zapier/config";

export const integrations = [
  ExchangeRates,
  Onshape,
  PaperlessParts,
  Resend,
  Slack,
  QuickBooks,
  Xero,
  Zapier,
];
