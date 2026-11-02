// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { QUICKBOOKS_CLIENT_ID } from "@carbon/auth";
import { z } from "zod";
import { defineIntegration } from "../fns";
import { pieceLogo } from "../integrations/piece-logo";

export const QuickBooks = defineIntegration({
  name: "QuickBooks Online",
  id: "quickbooks",
  active: false,
  category: "Accounting",
  providerRole: "accounting" as const,
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
  },
  actions: [
    {
      id: "import-master-data",
      label: "Import customers & vendors",
      description:
        "Pull the customers and vendors already in QuickBooks Online into Carbon and link them, so documents Carbon posts later reuse the original QuickBooks Online records instead of creating duplicates",
      endpoint:
        "/api/integrations/master-sync?provider=quickbooks&direction=pull-from-accounting&entities=customers,vendors"
    },
    {
      id: "push-master-data",
      label: "Push customers, vendors & items",
      description:
        "Send every Carbon customer, vendor and item that has no QuickBooks Online counterpart yet",
      endpoint:
        "/api/integrations/master-sync?provider=quickbooks&direction=push-to-accounting"
    }
  ]
});
