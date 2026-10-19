// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as accounting from "./accounting/accounting.server";
import * as agent from "./agent/agent.server";
import * as documents from "./documents/documents.server";
import * as inventory from "./inventory/inventory.server";
import * as invoicing from "./invoicing/invoicing.server";
import * as items from "./items/items.server";
import * as people from "./people/people.server";
import * as production from "./production/production.server";
import * as purchasing from "./purchasing/purchasing.server";
import * as quality from "./quality/quality.server";
import * as resources from "./resources/resources.server";
import * as sales from "./sales/sales.server";
import * as settings from "./settings/settings.server";
import * as shared from "./shared/shared.server";
import * as users from "./users/users.server";
import * as workflows from "./workflows/workflows.server";

/**
 * Every module's operations. Routes call them through `carbon(request)`; the
 * API and MCP publish the ones tagged `@mcp`.
 */
export const router = {
  accounting,
  agent,
  documents,
  inventory,
  invoicing,
  items,
  people,
  production,
  purchasing,
  quality,
  resources,
  sales,
  settings,
  shared,
  users,
  workflows
};

export type Router = typeof router;
