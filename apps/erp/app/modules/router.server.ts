// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { production } from "./production/index.server";

/**
 * Every module's operations. Routes call them through `carbon(request)`; the
 * API and MCP publish the ones tagged `@mcp`.
 */
export const router = { production };

export type Router = typeof router;
