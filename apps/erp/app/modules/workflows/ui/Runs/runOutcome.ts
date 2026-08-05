import type { WorkflowDefinition } from "@carbon/workflows";
import type { WorkflowRunDetail } from "../../workflows.service";
import type { LabelFor } from "../Builder/labelKeys";
import { nodeTitle } from "../Builder/labelKeys";
import { NODE_KIND_META } from "../Builder/nodes/meta";
import type { RunStepView } from "./WorkflowRunSteps";

export type RunOutcome = {
  tone: "neutral" | "warning" | "danger";
  text: string;
};

/** This module is pure, so callers with hook access pass a translator in. */
const UNTRANSLATED: LabelFor = (_key, fallback) => fallback;

/** The title a step should be described by in the outcome sentence. Same rule as
 * the step rows use, so the sentence and the list never name a step differently. */
function stepTitle(
  step: RunStepView,
  definition: WorkflowDefinition | null,
  labelFor: LabelFor
): string {
  const node = definition?.nodes.find((n) => n.id === step.nodeId);
  if (!node) {
    return (
      NODE_KIND_META[step.nodeType as keyof typeof NODE_KIND_META]
        ?.defaultTitle ?? step.nodeType
    );
  }
  const meta = NODE_KIND_META[node.type];
  const catalogId = meta.catalogId?.(node);
  const describes =
    (catalogId === undefined ? undefined : labelFor(catalogId, catalogId)) ??
    meta.title?.(node) ??
    meta.summary?.(node) ??
    meta.defaultTitle;
  return nodeTitle(node.name, describes);
}

/**
 * One sentence describing what a run actually did. Exists because a condition
 * that matches no path still ends the run `Succeeded` — see
 * `conditionExecutor` in `packages/workflows/src/runtime/condition.ts`.
 */
export function runOutcome(
  run: Pick<WorkflowRunDetail, "status" | "error" | "statusReason">,
  steps: RunStepView[],
  definition: WorkflowDefinition | null,
  labelFor: LabelFor = UNTRANSLATED
): RunOutcome {
  const nodeSteps = steps.filter((s) => !s.itemKey || s.itemKey === "");

  if (run.status === "Failed") {
    const failed = nodeSteps.find((s) => s.status === "Failed");
    const where = failed
      ? ` at "${stepTitle(failed, definition, labelFor)}"`
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
    const title = stepTitle(noMatch, definition, labelFor);
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
    const title = stepTitle(skipped, definition, labelFor);
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
