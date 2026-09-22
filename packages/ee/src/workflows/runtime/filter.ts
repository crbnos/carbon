import {
  DEFAULT_HANDLE,
  DEFAULT_OUTPUT,
  type FilterNode
} from "../definition/schema";
import { evaluateClauses } from "./compare";
import { resolveRef } from "./resolve";
import type { NodeExecutor, RuntimeValue } from "./types";
import { listValue } from "./values";

export function filterSummary(
  kept: number,
  total: number,
  unresolved: number
): string {
  const base = `Kept ${kept} of ${total}.`;
  return unresolved === 0
    ? base
    : `Kept ${kept} of ${total}; ${unresolved} could not be checked.`;
}

export const filterExecutor: NodeExecutor<FilterNode> = {
  permission: () => undefined,

  execute: async (node, ctx) => {
    if (node.data.source === undefined) {
      return { status: "Skipped", reason: "No list was chosen to filter." };
    }

    const source = await resolveRef(node.data.source, ctx);
    if (!source.ok) return { status: "Skipped", reason: source.reason };
    if (source.value.kind !== "list") {
      return { status: "Skipped", reason: "This step expected a list." };
    }
    ctx.record?.("source", source.value);

    const items = source.value.items;
    const kept: RuntimeValue[] = [];
    let unresolved = 0;

    for (const item of items) {
      const result = await evaluateClauses(
        node.data.clauses,
        node.data.combinator,
        { ...ctx, item }
      );
      // One unreadable item drops out; it never stops the whole list.
      if (!result.ok) {
        unresolved += 1;
        continue;
      }
      if (result.passed) kept.push(item);
    }

    return {
      status: "Succeeded",
      outputs: { [DEFAULT_OUTPUT]: listValue(source.value.of, kept).value },
      handle: DEFAULT_HANDLE,
      summary: filterSummary(kept.length, items.length, unresolved)
    };
  }
};
