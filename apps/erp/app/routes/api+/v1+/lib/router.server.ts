// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Carbon API oRPC router, built at module load from the operation catalog:
// one procedure per published service function.
// A plain nested object `{ [module]: { [operationId]: procedure } }` is a valid oRPC
// router for both OpenAPIHandler (HTTP) and server-side call() (MCP/agent).

import type { Operation } from "@carbon/api/catalog.server";
import { jsonSchema, zodInput } from "@carbon/api/schema";
import { annotateRequestSpan, withSpan } from "@carbon/logger/tracing.server";
import { base } from "./base.server";
import {
  OPERATIONS,
  operationId,
  operationPath,
  outputSchema,
  shapeHttpBody
} from "./operations.server";
import { callServiceFn } from "./service-fn.server";

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
 * Every caller (HTTP, MCP call_tool, workflows) runs an operation inside this
 * span, so this is the one place a trace learns its name.
 */
export function traceOperation<T>(
  op: Pick<Operation, "name" | "module">,
  run: () => Promise<T>
): Promise<T> {
  const attributes = {
    "carbon.operation": op.name,
    "carbon.operation.module": op.module
  };
  annotateRequestSpan(attributes);
  return withSpan(`operation ${op.name}`, attributes, run);
}

function buildProcedure(op: Operation) {
  return (
    // No scope check here: the service function's gate checks the caller
    // against the same permission the catalog publishes (`callServiceFn`).
    base
      .route({
        method: "POST",
        path: operationPath(op),
        tags: [op.module],
        summary: op.title,
        description: op.description
      })
      // Input validates with the function's own validator; output does NOT —
      // shapeHttpBody rewrites the body, so a correct response does not match
      // the declared response schema.
      .input(zodInput(op.fn.input, () => op.schema))
      .output(jsonSchema(outputSchema(op)))
      .handler(({ input, context }) =>
        traceOperation(op, async () =>
          shapeHttpBody(await callServiceFn(op.fn, context, input))
        )
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
  for (const op of OPERATIONS) {
    const id = operationId(op);
    if (RESERVED_KEYS.has(id) || RESERVED_KEYS.has(op.module)) {
      throw new Error(
        `Carbon API operation "${op.name}" collides with a reserved oRPC router key.`
      );
    }
    (out[op.module] ??= {})[id] = buildProcedure(op);
  }
  return out;
})();
