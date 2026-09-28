// The service-function registry the Carbon API dispatch resolves against: every
// module's service namespace, keyed by the manifest's module name. This is the ONE
// copy — the oRPC dispatch, MCP call_tool, the in-app agent, and the workflow
// dispatcher all resolve through it.
//
// A module may also have a server-only companion, `{module}.mcp.server.ts`, for
// tools that need `*.server` code (Kysely, redis, `@carbon/ee` server modules)
// the client-bundled service file cannot import. `scripts/generate-mcp.ts`
// publishes every companion it finds, so EVERY companion on disk must be
// imported and spread here (the companion spread wins, so a same-named export
// shadows the service function). `test/mcp-registry-parity.test.ts` fails when
// the two drift.

import * as accountFunctions from "~/modules/account/account.service";
import * as accountingMcpFunctions from "~/modules/accounting/accounting.mcp.server";
import * as accountingFunctions from "~/modules/accounting/accounting.service";
import * as documentsFunctions from "~/modules/documents/documents.service";
import * as inventoryFunctions from "~/modules/inventory/inventory.service";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service";
import * as itemsFunctions from "~/modules/items/items.service";
import * as peopleFunctions from "~/modules/people/people.service";
import * as productionMcpFunctions from "~/modules/production/production.mcp.server";
import * as productionFunctions from "~/modules/production/production.service";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service";
import * as qualityMcpFunctions from "~/modules/quality/quality.mcp.server";
import * as qualityFunctions from "~/modules/quality/quality.service";
import * as resourcesFunctions from "~/modules/resources/resources.service";
import * as salesFunctions from "~/modules/sales/sales.service";
import * as settingsMcpFunctions from "~/modules/settings/settings.mcp.server";
import * as settingsFunctions from "~/modules/settings/settings.service";
import * as sharedFunctions from "~/modules/shared/shared.service";
import * as usersFunctions from "~/modules/users/users.service";

// Combine all functions into a single registry.
export const functionRegistry = {
  account: accountFunctions,
  accounting: { ...accountingFunctions, ...accountingMcpFunctions },
  documents: documentsFunctions,
  inventory: inventoryFunctions,
  invoicing: invoicingFunctions,
  items: itemsFunctions,
  people: peopleFunctions,
  production: { ...productionFunctions, ...productionMcpFunctions },
  purchasing: purchasingFunctions,
  quality: { ...qualityFunctions, ...qualityMcpFunctions },
  resources: resourcesFunctions,
  sales: salesFunctions,
  settings: { ...settingsFunctions, ...settingsMcpFunctions },
  shared: sharedFunctions,
  users: usersFunctions
};
