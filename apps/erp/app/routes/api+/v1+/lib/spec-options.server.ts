// The OpenAPI document options for the Carbon API spec — extracted from the
// openapi.json route so the mechanics test asserts on the REAL options rather
// than a copy that could drift.

import { getAppUrl } from "@carbon/env";
import type { OpenAPIGeneratorGenerateOptions } from "@orpc/openapi";

export function specOptions(): OpenAPIGeneratorGenerateOptions {
  return {
    info: {
      title: "Carbon API",
      version: "1.0.0",
      description:
        "Carbon's service-layer API — read and write your manufacturing data the safe way."
    },
    servers: [{ url: `${getAppUrl() || ""}/api/v1` }],
    // ONE documented way in: `Authorization: Bearer crbn_…` — the convention every
    // doc sample and the rest.carbon.ms proxy use, and what generated SDKs will
    // configure. The server also accepts the raw internal `carbon-key` header
    // (authenticate.server.ts) as a compatibility alias, deliberately NOT declared
    // here: a spec that says "either way" gives every generated client two auth
    // stories instead of one.
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A Carbon API key (`crbn_…`) sent as a Bearer token."
        }
      }
    }
  };
}
