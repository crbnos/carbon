import type { ConditionNode } from "../definition/schema";
import { evaluateClauses } from "./compare";
import type { NodeExecutor } from "./types";

/** `branchTaken` in the run log when no path matched. */
export const NO_BRANCH = "none";

export const conditionExecutor: NodeExecutor<ConditionNode> = {
  permission: () => undefined,

  execute: async (node, ctx) => {
    for (const path of node.data.paths) {
      if (path.kind === "else") {
        return {
          status: "Succeeded",
          outputs: {},
          handle: path.id,
          branchTaken: path.id
        };
      }

      const result = await evaluateClauses(path.clauses, path.combinator, ctx);
      // Unresolvable data is a skip, not a failed test — never fall through to the else.
      if (!result.ok) return { status: "Skipped", reason: result.reason };

      if (result.passed) {
        return {
          status: "Succeeded",
          outputs: {},
          handle: path.id,
          branchTaken: path.id
        };
      }
    }

    return {
      status: "Succeeded",
      outputs: {},
      handle: null,
      branchTaken: NO_BRANCH
    };
  }
};
