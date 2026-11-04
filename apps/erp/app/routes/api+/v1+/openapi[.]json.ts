// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// GET /api/v1/openapi.json — the generated OpenAPI 3 spec for the Carbon API.
// Public, so clients can generate a typed client in any language. Memoized at module
// scope (the router and its schemas are static for the process lifetime).

import { CarbonJsonSchemaConverter } from "@carbon/api/schema";
import { OpenAPIGenerator } from "@orpc/openapi";
import { specOptions, withErrorResponses } from "./lib/spec-options.server";

// The promise, not the string: concurrent cold-start requests on this public
// route must share ONE generation of the 1,495-operation spec.
let cachedSpec: Promise<string> | null = null;
const FAILED_SPEC_COOLDOWN_MS = 30_000;

async function generateSpec(): Promise<string> {
  // Not a module-scope import: the router is built over the whole operation
  // catalog (tool-metadata.json, ~20 MB), and the dev server evaluates every
  // route module up front.
  const { router } = await import("./lib/router.server");
  const generator = new OpenAPIGenerator({
    schemaConverters: [new CarbonJsonSchemaConverter()]
  });
  const spec = await generator.generate(router, specOptions());
  return JSON.stringify(withErrorResponses(spec as never));
}

export async function loader() {
  if (!cachedSpec) {
    const generating = generateSpec();
    // A failure is served for a cooldown, then retried, so a persistent one
    // neither sticks until a restart nor rebuilds the spec on every request
    // to this public route.
    generating.catch(() => {
      setTimeout(() => {
        if (cachedSpec === generating) cachedSpec = null;
      }, FAILED_SPEC_COOLDOWN_MS).unref?.();
    });
    cachedSpec = generating;
  }
  return new Response(await cachedSpec, {
    headers: { "content-type": "application/json" }
  });
}
