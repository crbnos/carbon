import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type EntityNode
} from "../definition/schema";
import { resolveValue } from "./resolve";
import type { NodeExecutor, RuntimeValue } from "./types";

const GONE = "This calculation is no longer available.";

export const entityExecutor: NodeExecutor<EntityNode> = {
  permission: (node, catalog) =>
    catalog.getOperation(node.data.operation)?.permission,

  execute: async (node, ctx) => {
    const operation = ctx.catalog.getOperation(node.data.operation);
    if (operation === undefined) return { status: "Skipped", reason: GONE };

    const inputs: Record<string, RuntimeValue> = {};
    for (const [name, value] of Object.entries(node.data.inputs)) {
      const resolved = await resolveValue(value, ctx);
      // Missing data is a skip with a reason, never an error.
      if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };
      inputs[name] = resolved.value;
      ctx.record?.(name, resolved.value);
    }

    const outcome = await ctx.services.runOperation(
      node.data.operation,
      inputs
    );
    if (!outcome.ok) return { status: "Failed", error: outcome.error };

    return {
      status: "Succeeded",
      outputs: { [DEFAULT_OUTPUT]: outcome.value },
      handle: DEFAULT_HANDLE
    };
  }
};
