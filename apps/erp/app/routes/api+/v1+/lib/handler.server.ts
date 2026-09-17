// Module-scope OpenAPIHandler singleton for the Carbon API v1 HTTP transport.

import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { router } from "./router.server";

export const openApiHandler = new OpenAPIHandler(router);
