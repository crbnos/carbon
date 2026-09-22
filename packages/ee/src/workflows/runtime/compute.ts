import {
  type ComputeNode,
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT
} from "../definition/schema";
import type { ScalarType } from "../definition/types";
import { resolveValue } from "./resolve";
import type { NodeExecutor, RuntimeValue } from "./types";
import { listValue } from "./values";

const GONE = "This calculation is no longer available.";

export const computeExecutor: NodeExecutor<ComputeNode> = {
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

    // Batch mode: if any input that the operation expects as a single value
    // resolved to a list, run the operation once per item and return a list.
    let batchInputName: string | undefined;
    let batchItems: RuntimeValue[] | undefined;
    for (const [name, decl] of Object.entries(operation.inputs)) {
      if (decl.type.kind === "list") continue; // operation already expects a list
      const resolved = inputs[name];
      if (resolved?.kind === "list") {
        batchInputName = name;
        batchItems = resolved.items;
        break;
      }
    }

    if (
      batchInputName !== undefined &&
      batchItems !== undefined &&
      operation.output.kind !== "list"
    ) {
      const results: RuntimeValue[] = [];
      for (const item of batchItems) {
        const outcome = await ctx.services.runOperation(node.data.operation, {
          ...inputs,
          [batchInputName]: item
        });
        if (outcome.ok) results.push(outcome.value);
      }
      const { value: list } = listValue(
        operation.output as ScalarType,
        results
      );
      return {
        status: "Succeeded",
        outputs: { [DEFAULT_OUTPUT]: list },
        handle: DEFAULT_HANDLE
      };
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
