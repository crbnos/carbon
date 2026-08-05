import {
  type ActionNode,
  FAILURE_HANDLE,
  SUCCESS_HANDLE
} from "../definition/schema";
import { resolveValue } from "./resolve";
import type { NodeExecutor, RuntimeValue } from "./types";

const GONE = "This step is no longer available.";

// One item only. Batching belongs to the engine, which calls this once per item —
// a loop here would make one step row stand for many effects.
export const actionExecutor: NodeExecutor<ActionNode> = {
  permission: (node, catalog) =>
    catalog.getAction(node.data.action)?.permission,

  execute: async (node, ctx) => {
    const action = ctx.catalog.getAction(node.data.action);
    if (action === undefined) return { status: "Skipped", reason: GONE };

    const inputs: Record<string, RuntimeValue> = {};
    for (const [name, value] of Object.entries(node.data.inputs)) {
      const resolved = await resolveValue(value, ctx);
      if (!resolved.ok) return { status: "Skipped", reason: resolved.reason };
      // In a batch the one list input stands for the item this turn is on.
      inputs[name] =
        ctx.item !== undefined && resolved.value.kind === "list"
          ? ctx.item
          : resolved.value;
      ctx.record?.(name, inputs[name]);
    }

    const outcome = await ctx.services.runAction(node.data.action, inputs);
    if (!outcome.ok) {
      return { status: "Failed", error: outcome.error, handle: FAILURE_HANDLE };
    }

    return {
      status: "Succeeded",
      outputs: outcome.outputs,
      handle: SUCCESS_HANDLE,
      ...(outcome.summary === undefined ? {} : { summary: outcome.summary })
    };
  }
};
