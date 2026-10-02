// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Module-scope OpenAPIHandler singleton for the Carbon API v1 HTTP transport.

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { router } from "./router.server";

export const openApiHandler = new OpenAPIHandler(router);
