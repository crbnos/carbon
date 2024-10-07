import { ExchangeRates } from "./exchange-rates/config";
import { QuickBooks } from "./quickbooks/config";
import { Resend } from "./resend/config";
import { Slack } from "./slack/config";
import { Xero } from "./xero/config";
import { Zapier } from "./zapier/config";

export const integrations = [
  ExchangeRates,
  Resend,
  Slack,
  QuickBooks,
  Xero,
  Zapier,
];
