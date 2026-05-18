import { z } from "zod";
import type { McpToolAnnotation, McpToolFn } from "./types";
import { MCP_TOOL_ANNOTATION } from "./types";

// Tags the function with its slim annotation under a non-enumerable symbol
// and returns the function unchanged. Registration is deferred to
// `registerAll()` (emitted by the manifest generator) — this wrapper is now
// pure metadata stamping, with no module-load side effects.
//
// The literal carries only what a human must decide; `description` and
// `paramSchema` are derived by the manifest generator, `inject` replaces
// `injectAuth`/`injectInto`:
//
//   export const getAccount = mcpTool(
//     { classification: "READ" },
//     async function getAccount(client, id) { ... }
//   );
//
//   export const upsertSalesOrder = mcpTool(
//     {
//       classification: "WRITE",
//       inject: [
//         { param: "salesOrder", as: "companyId" },
//         { param: "salesOrder", as: "createdBy" },
//         { param: "salesOrder", as: "updatedBy" },
//       ],
//     },
//     async function upsertSalesOrder(client, salesOrder) { ... }
//   );
// This wrapper is the single canonical point where the annotation literal
// is captured, so it owns annotation normalization (SRP): it resolves the
// `schema` alias and supplies the honest `z.unknown()` default. Downstream
// (registry/executor) therefore always sees a populated `paramSchema` and
// stays strict — a missing schema there remains a real bug, not a shrug.
export function mcpTool<F extends McpToolFn>(
  annotation: McpToolAnnotation,
  fn: F
): F {
  const normalized: McpToolAnnotation = {
    ...annotation,
    // `schema` is the Option-B name; `paramSchema` is the transitional
    // alias. Either may be present; default to z.unknown() (the honest
    // placeholder for genuinely unstructured input).
    paramSchema: annotation.schema ?? annotation.paramSchema ?? z.unknown()
  };
  Object.defineProperty(fn, MCP_TOOL_ANNOTATION, {
    value: normalized,
    enumerable: false,
    configurable: true,
    writable: false
  });
  return fn;
}
