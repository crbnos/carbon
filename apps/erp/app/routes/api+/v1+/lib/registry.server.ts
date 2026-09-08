// The service-function registry the Carbon API dispatch resolves against: every
// module's service namespace, keyed by the manifest's module name. This is the ONE
// copy — the oRPC dispatch, MCP call_tool, the in-app agent, and the workflow
// dispatcher all resolve through it.

import * as accountFunctions from "~/modules/account/account.service";
import * as accountingFunctions from "~/modules/accounting/accounting.ee.service";
import * as documentsFunctions from "~/modules/documents/documents.service";
import * as inventoryFunctions from "~/modules/inventory/inventory.service";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service";
import * as itemsFunctions from "~/modules/items/items.service";
import * as peopleFunctions from "~/modules/people/people.service";
import * as productionMcpFunctions from "~/modules/production/production.mcp.server";
import * as productionFunctions from "~/modules/production/production.service";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service";
import * as qualityFunctions from "~/modules/quality/quality.service";
import * as resourcesFunctions from "~/modules/resources/resources.service";
import * as salesFunctions from "~/modules/sales/sales.service";
import * as settingsFunctions from "~/modules/settings/settings.service";
import * as sharedFunctions from "~/modules/shared/shared.service";
import * as usersFunctions from "~/modules/users/users.service";

// Combine all functions into a single registry.
export const functionRegistry = {
  account: accountFunctions,
  accounting: accountingFunctions,
  documents: documentsFunctions,
  inventory: inventoryFunctions,
  invoicing: invoicingFunctions,
  items: itemsFunctions,
  people: peopleFunctions,
  production: { ...productionFunctions, ...productionMcpFunctions },
  purchasing: purchasingFunctions,
  quality: qualityFunctions,
  resources: resourcesFunctions,
  sales: salesFunctions,
  settings: settingsFunctions,
  shared: sharedFunctions,
  users: usersFunctions
};
