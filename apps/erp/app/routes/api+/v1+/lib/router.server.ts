// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Carbon API oRPC router, built at module load from the operation manifest.
// A plain nested object `{ [module]: { [operationId]: procedure } }` is a valid oRPC
// router for both OpenAPIHandler (HTTP) and server-side call() (MCP/agent).

import type { ManifestEntry } from "@carbon/api";
import { jsonSchema, jsonSchemaInput } from "@carbon/api/schema";
import { base, gate, mapThrownErrors } from "./base.server";
import { dispatchOperation } from "./dispatch.server";
import {
  liveOperationAliases,
  OPERATIONS,
  operationId,
  outputSchema,
  shapeHttpBody
} from "./operations.server";

// Property names oRPC reserves on a router object — an operation id must not collide
// (`then` is the load-bearing one: routers are thenable-detected).
const RESERVED_KEYS = new Set([
  "then",
  "bind",
  "valueOf",
  "toString",
  "toJSON"
]);

// `module`/`id` name the route; `meta` is the operation it runs. They differ only
// for a deprecated alias, which keeps its old path but runs (and is gated as) its
// replacement.
function buildProcedure(
  meta: ManifestEntry,
  module: string,
  id: string,
  deprecated = false
) {
  return (
    base
      // Outside the gate so it also covers anything the gate itself throws
      // through — it re-raises ORPCErrors untouched, so 403s/404s are unaffected.
      .use(mapThrownErrors)
      .use(gate(meta))
      .route({
        method: "POST",
        path: `/${module}/${id}`,
        tags: [module],
        summary: deprecated
          ? `${meta.description} (deprecated: use /${meta.module}/${operationId(meta)})`
          : meta.description,
        // Only when set — `deprecated: false` would land on every operation.
        ...(deprecated ? { deprecated: true } : {})
      })
      // Input validates; output does NOT — shapeHttpBody rewrites the body, so a
      // correct response does not match the declared response schema.
      .input(jsonSchemaInput(meta.schema))
      .output(jsonSchema(outputSchema(meta)))
      // callOperation reverses this shaping with the same static bit, so
      // MCP/agent/workflow callers still see DispatchResult semantics.
      .handler(async ({ input, context }) =>
        shapeHttpBody(meta, await dispatchOperation(meta, context, input))
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
  const add = (
    module: string,
    id: string,
    meta: ManifestEntry,
    deprecated: boolean
  ) => {
    if (RESERVED_KEYS.has(id) || RESERVED_KEYS.has(module)) {
      throw new Error(
        `Carbon API operation "${module}_${id}" collides with a reserved oRPC router key.`
      );
    }
    (out[module] ??= {})[id] = buildProcedure(meta, module, id, deprecated);
  };
  for (const meta of OPERATIONS) {
    add(meta.module, operationId(meta), meta, false);
  }
  // Aliases are `<module>_<operation>` like every operation name; module names
  // carry no underscore, so the first one splits it.
  for (const [alias, meta] of liveOperationAliases) {
    const split = alias.indexOf("_");
    add(alias.slice(0, split), alias.slice(split + 1), meta, true);
  }
  return out;
})();
