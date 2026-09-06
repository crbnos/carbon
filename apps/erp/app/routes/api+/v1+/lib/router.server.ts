// The Carbon API oRPC router, built at module load from the operation manifest.
// A plain nested object `{ [module]: { [operationId]: procedure } }` is a valid oRPC
// router for both OpenAPIHandler (HTTP) and server-side call() (MCP/agent).

import type { ManifestEntry } from "@carbon/api";
import { jsonSchema } from "@carbon/api/schema";
import { base, gate } from "./base.server";
import { dispatchOperation } from "./dispatch.server";
import { OPERATIONS, operationId } from "./operations.server";

// Property names oRPC reserves on a router object — an operation id must not collide
// (`then` is the load-bearing one: routers are thenable-detected).
const RESERVED_KEYS = new Set([
  "then",
  "bind",
  "valueOf",
  "toString",
  "toJSON"
]);

/**
 * The success body `dispatchOperation` returns: the Supabase result unwrapped to
 * `data`, plus `count` on paginated reads. `data` carries the operation's own
 * reflected response schema when the generator derived one; without it the property
 * is left unconstrained rather than described as something it might not be.
 */
function outputSchema(meta: ManifestEntry): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      data: meta.responseSchema ?? {},
      count: {
        type: ["number", "null"],
        description: "Total matching rows, present on paginated reads."
      }
    },
    required: ["data"]
  };
}

function buildProcedure(meta: ManifestEntry, id: string) {
  return base
    .use(gate(meta))
    .route({
      method: "POST",
      path: `/${meta.module}/${id}`,
      tags: [meta.module],
      summary: meta.description
    })
    .input(jsonSchema(meta.schema))
    .output(jsonSchema(outputSchema(meta)))
    .handler(({ input, context }) => dispatchOperation(meta, context, input));
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
