import { QUICKBOOKS_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";

export const QuickBooks = defineIntegration({
  name: "QuickBooks Online",
  id: "quickbooks",
  active: false,
  category: "Accounting",
  logo: pieceLogo("quickbooks"),
  description:
    "Integrating Carbon with QuickBooks Online keeps your books in sync: customers, vendors, items, invoices and bills flow between both systems, and Carbon's inventory and production postings are pushed as journal entries into your QuickBooks Online ledger.",
  shortDescription:
    "Sync customers, vendors, items and invoices, and post journal entries.",
  images: [],
  settings: [],
  schema: z.object({}),
  oauth: {
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    clientId: QUICKBOOKS_CLIENT_ID ?? "",
    redirectUri: "/api/integrations/quickbooks/oauth",
    scopes: ["com.intuit.quickbooks.accounting"],
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
  }
});
