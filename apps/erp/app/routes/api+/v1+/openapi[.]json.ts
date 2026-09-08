// GET /api/v1/openapi.json — the generated OpenAPI 3 spec for the Carbon API.
// Public, so clients can generate a typed client in any language. Memoized at module
// scope (the router and its schemas are static for the process lifetime).

import { CarbonJsonSchemaConverter } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { router } from "./lib/router.server";
import { specOptions } from "./lib/spec-options.server";

// The promise, not the string: concurrent cold-start requests on this public
// route must share ONE generation of the 1,495-operation spec.
let cachedSpec: Promise<string> | null = null;

async function generateSpec(): Promise<string> {
  const generator = new OpenAPIGenerator({
    schemaConverters: [new CarbonJsonSchemaConverter()]
  });
  const spec = await generator.generate(router, specOptions());
  return JSON.stringify(spec);
}

export async function loader() {
  cachedSpec ??= generateSpec();
  return new Response(await cachedSpec, {
    headers: { "content-type": "application/json" }
  });
}
