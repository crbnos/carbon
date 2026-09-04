// GET /api/v1/openapi.json — the generated OpenAPI 3 spec for the Carbon API.
// Public, so clients can generate a typed client in any language. Memoized at module
// scope (the router and its schemas are static for the process lifetime).

import { CarbonJsonSchemaConverter } from "@carbon/api/schema";
import { getAppUrl } from "@carbon/env";
import { OpenAPIGenerator } from "@orpc/openapi";
import { router } from "./lib/router.server";

let cachedSpec: string | null = null;

async function generateSpec(): Promise<string> {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new CarbonJsonSchemaConverter()]
  });
  const spec = await generator.generate(router, {
    info: {
      title: "Carbon API",
      version: "1.0.0",
      description:
        "Carbon's service-layer API — read and write your manufacturing data the safe way."
    },
    servers: [{ url: `${getAppUrl() || ""}/api/v1` }],
    security: [{ carbonKey: [] }],
    components: {
      securitySchemes: {
        carbonKey: { type: "apiKey", in: "header", name: "carbon-key" }
      }
    }
  });
  return JSON.stringify(spec);
}

export async function loader() {
  if (!cachedSpec) cachedSpec = await generateSpec();
  return new Response(cachedSpec, {
    headers: { "content-type": "application/json" }
  });
}
