// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WorkflowDefinition, WorkflowNode } from "@carbon/ee/workflows";
import { DATA_OPERATIONS } from "@carbon/ee/workflows";
import type { WorkflowRunDetail } from "../../workflows.service";
import { nodeTitle } from "../Builder/labelKeys";
import { metaForNodeType, NODE_KIND_META } from "../Builder/nodes/meta";
import type { RunStepView } from "./WorkflowRunSteps";

export type RunOutcome = {
  tone: "neutral" | "warning" | "danger";
  text: string;
};

/** How a step is named. The UI passes `useNodeLabel`'s title, so the outcome
 * sentence and the step list never name one step two ways; this module is pure,
 * so the default (tests, no hooks) is the untranslated English name. */
export type NameNode = (node: WorkflowNode) => string;

const untranslatedName: NameNode = (node) => {
  const meta = NODE_KIND_META[node.type];
  const describes =
    meta.catalogId?.(node) ??
    meta.title?.(node) ??
    meta.summary?.(node, {
      operation: (operation) => DATA_OPERATIONS[operation].label
    }) ??
    meta.defaultTitle;
  return nodeTitle(node.name, describes);
};

function stepTitle(
  step: RunStepView,
  definition: WorkflowDefinition | null,
  nameNode: NameNode
): string {
  const node = definition?.nodes.find((n) => n.id === step.nodeId);
  if (!node) {
    return metaForNodeType(step.nodeType)?.defaultTitle ?? step.nodeType;
  }
  return nameNode(node);
}

/**
 * One sentence describing what a run actually did. Exists because a condition
 * that matches no path still ends the run `Succeeded` — see
 * `conditionExecutor` in `packages/ee/src/workflows/runtime/condition.ts`.
 */
export function runOutcome(
  run: Pick<WorkflowRunDetail, "status" | "error" | "statusReason">,
  steps: RunStepView[],
  definition: WorkflowDefinition | null,
  nameNode: NameNode = untranslatedName
): RunOutcome {
  const nodeSteps = steps.filter((s) => !s.itemKey || s.itemKey === "");

  if (run.status === "Failed") {
    const failed = nodeSteps.find((s) => s.status === "Failed");
    const where = failed
      ? ` at "${stepTitle(failed, definition, nameNode)}"`
      : "";
    const why = run.error ? `: ${run.error}` : ".";
    return { tone: "danger", text: `Failed${where}${why}` };
  }

  if (run.status === "Blocked") {
    return {
      tone: "warning",
      text: run.statusReason
        ? `Blocked — ${run.statusReason}`
        : "Blocked before it could run."
    };
  }

  if (run.status === "Skipped") {
    return {
      tone: "warning",
      text: run.statusReason
        ? `Skipped — ${run.statusReason}`
        : "Skipped before it could run."
    };
  }

  if (run.status === "Queued") {
    return { tone: "neutral", text: "Waiting to start." };
  }

  if (run.status === "Running") {
    return { tone: "neutral", text: "Running now…" };
  }

  const noMatch = nodeSteps.find((s) => s.branchTaken === "none");
  if (noMatch) {
    const title = stepTitle(noMatch, definition, nameNode);
    if (definition) {
      const notRun = definition.nodes.length - nodeSteps.length;
      if (notRun > 0) {
        return {
          tone: "warning",
          text: `Nothing happened — "${title}" matched none of its conditions, so the ${notRun} ${notRun === 1 ? "step" : "steps"} after it never ran.`
        };
      }
    }
    return {
      tone: "warning",
      text: `Nothing happened — "${title}" matched none of its conditions.`
    };
  }

  const skipped = nodeSteps.find((s) => s.status === "Skipped");
  if (skipped) {
    const title = stepTitle(skipped, definition, nameNode);
    const why = skipped.statusReason ? `: ${skipped.statusReason}` : ".";
    return {
      tone: "warning",
      text: `Stopped early — "${title}" was skipped${why}`
    };
  }

  const total = definition?.nodes.length ?? nodeSteps.length;
  return {
    tone: "neutral",
    text: `Completed — ${nodeSteps.length} of ${total} ${total === 1 ? "step" : "steps"} ran.`
  };
}
