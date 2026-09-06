// The Carbon API oRPC router, built at module load from the operation manifest.
// A plain nested object `{ [module]: { [operationId]: procedure } }` is a valid oRPC
// router for both OpenAPIHandler (HTTP) and server-side call() (MCP/agent).

import type { ManifestEntry } from "@carbon/api";
import { jsonSchema } from "@carbon/api/schema";
import { base, gate } from "./base.server";
import { dispatchOperation } from "./dispatch.server";
import {
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

function buildProcedure(meta: ManifestEntry, id: string) {
  return (
    base
      .use(gate(meta))
      .route({
        method: "POST",
        path: `/${meta.module}/${id}`,
        tags: [meta.module],
        summary: meta.description
      })
      .input(jsonSchema(meta.schema))
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
  for (const meta of OPERATIONS) {
    const id = operationId(meta);
    if (RESERVED_KEYS.has(id) || RESERVED_KEYS.has(meta.module)) {
      throw new Error(
        `Carbon API operation "${meta.name}" collides with a reserved oRPC router key.`
      );
    }
    (out[meta.module] ??= {})[id] = buildProcedure(meta, id);
  }
  return out;
})();
