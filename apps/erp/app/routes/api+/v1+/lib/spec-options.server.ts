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
    // Two schemes with OR semantics — the server accepts either
    // (authenticate.server.ts): the raw `carbon-key` header, or the same key as a
    // Bearer token, which is what every doc sample shows and what the
    // rest.carbon.ms proxy convention uses. Declaring only `carbonKey` made
    // generated SDKs authenticate differently from every documented example.
    security: [{ carbonKey: [] }, { bearerAuth: [] }],
    components: {
      securitySchemes: {
        carbonKey: { type: "apiKey", in: "header", name: "carbon-key" },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A Carbon API key (`crbn_…`) sent as a Bearer token."
        }
      }
    }
  };
}
