import type { ConditionNode } from "../definition/schema";
import { evaluateClauses } from "./compare";
import type { NodeDetail, NodeExecutor } from "./types";

/** `branchTaken` in the run log when no path matched. */
export const NO_BRANCH = "none";

export const conditionExecutor: NodeExecutor<ConditionNode> = {
  permission: () => undefined,

  execute: async (node, ctx) => {
    const paths: NodeDetail["paths"] = [];

    for (const path of node.data.paths) {
      if (path.kind === "else") {
        paths.push({
          pathId: path.id,
          combinator: path.combinator,
          evaluations: [],
          taken: true
        });
        return {
          status: "Succeeded",
          outputs: {},
          handle: path.id,
          branchTaken: path.id,
          detail: { kind: "condition", paths }
        };
      }

      const result = await evaluateClauses(path.clauses, path.combinator, ctx);
      paths.push({
        pathId: path.id,
        combinator: path.combinator,
        evaluations: result.evaluations,
        taken: result.ok && result.passed
      });

      // Unresolvable data is a skip, not a failed test — never fall through to the else.
      if (!result.ok) {
        return {
          status: "Skipped",
          reason: result.reason,
          detail: { kind: "condition", paths }
        };
      }

      if (result.passed) {
        return {
          status: "Succeeded",
          outputs: {},
          handle: path.id,
          branchTaken: path.id,
          detail: { kind: "condition", paths }
        };
      }
    }

    return {
      status: "Succeeded",
      outputs: {},
      handle: null,
      branchTaken: NO_BRANCH,
      detail: { kind: "condition", paths }
    };
  }
};
