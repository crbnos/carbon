// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { account } from "./account/index.server";
import { accounting } from "./accounting/index.server";
import { agent } from "./agent/index.server";
import { documents } from "./documents/index.server";
import { inventory } from "./inventory/index.server";
import { invoicing } from "./invoicing/index.server";
import { items } from "./items/index.server";
import { people } from "./people/index.server";
import { production } from "./production/index.server";
import { purchasing } from "./purchasing/index.server";
import { quality } from "./quality/index.server";
import { resources } from "./resources/index.server";
import { sales } from "./sales/index.server";
import { settings } from "./settings/index.server";
import { shared } from "./shared/index.server";
import { users } from "./users/index.server";
import { workflows } from "./workflows/index.server";

/**
 * Every module's operations. Routes call them through `carbon(request)`; the
 * API and MCP publish the ones tagged `@mcp`.
 */
export const router = {
  account,
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
