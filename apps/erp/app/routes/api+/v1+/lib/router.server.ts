// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Carbon API oRPC router, built at module load from the operation manifest:
// one procedure per published service function.
// A plain nested object `{ [module]: { [operationId]: procedure } }` is a valid oRPC
// router for both OpenAPIHandler (HTTP) and server-side call() (MCP/agent).

import type { ManifestEntry } from "@carbon/api";
import { jsonSchema, jsonSchemaInput } from "@carbon/api/schema";
import { annotateRequestSpan, withSpan } from "@carbon/logger/tracing.server";
import { base } from "./base.server";
import {
  OPERATIONS,
  operationId,
  operationPath,
  outputSchema,
  shapeHttpBody
} from "./operations.server";
import { runServiceFn } from "./service-fn.server";

// Property names oRPC reserves on a router object — an operation id must not collide
// (`then` is the load-bearing one: routers are thenable-detected).
const RESERVED_KEYS = new Set([
  "then",
  "bind",
  "valueOf",
  "toString",
  "toJSON"
]);

// Every caller (HTTP, MCP call_tool, the agent, workflows) runs an operation
// through its procedure, so this is the one place a trace learns its name.
const traced = (meta: ManifestEntry) =>
  base.middleware(({ next }) => {
    const attributes = {
      "carbon.operation": meta.name,
      "carbon.operation.module": meta.module
    };
    annotateRequestSpan(attributes);
    return withSpan(`operation ${meta.name}`, attributes, async () => next());
  });

function buildProcedure(meta: ManifestEntry) {
  const summary = meta.title ?? meta.description;
  return (
    // No scope check here: the service function's gate checks the caller
    // against the same permission the manifest publishes (`runServiceFn`).
    base
      .use(traced(meta))
      .route({
        method: "POST",
        path: operationPath(meta),
        tags: [meta.module],
        summary,
        ...(meta.title ? { description: meta.description } : {})
      })
      // Input validates; output does NOT — shapeHttpBody rewrites the body, so a
      // correct response does not match the declared response schema.
      .input(jsonSchemaInput(meta.schema))
      .output(jsonSchema(outputSchema(meta)))
      // callOperation reverses this shaping for MCP, agent and workflow callers.
      .handler(async ({ input, context }) =>
        shapeHttpBody(meta, await runServiceFn(meta, context, input))
      )
  );
}

export const router: Record<
  string,
  Record<string, ReturnType<typeof buildProcedure>>
> = (() => {
  const out: Record<
    string,
    Record<string, ReturnType<typeof buildProcedure>>
  > = {};
  for (const meta of OPERATIONS) {
    const id = operationId(meta);
    if (RESERVED_KEYS.has(id) || RESERVED_KEYS.has(meta.module)) {
      throw new Error(
        `Carbon API operation "${meta.name}" collides with a reserved oRPC router key.`
      );
    }
    (out[meta.module] ??= {})[id] = buildProcedure(meta);
  }
  return out;
})();
