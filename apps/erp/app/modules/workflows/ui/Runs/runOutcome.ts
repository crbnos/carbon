import type { WorkflowDefinition } from "@carbon/workflows";
import type {
  WorkflowRunDetail,
  WorkflowRunStep
} from "../../workflows.service";
import { NODE_KIND_META } from "../Builder/nodes/meta";

export type RunOutcome = {
  tone: "neutral" | "warning" | "danger";
  text: string;
};

/** The title a step should be described by in the outcome sentence. */
function stepTitle(
  step: WorkflowRunStep,
  definition: WorkflowDefinition | null
): string {
  const node = definition?.nodes.find((n) => n.id === step.nodeId);
  if (!node) {
    return (
      NODE_KIND_META[step.nodeType as keyof typeof NODE_KIND_META]
        ?.defaultTitle ?? step.nodeType
    );
  }
  const meta = NODE_KIND_META[node.type];
  const explicit = (node.data as Record<string, unknown>).title;
  return (
    (typeof explicit === "string" && explicit !== "" ? explicit : undefined) ??
    meta.title?.(node) ??
    meta.summary?.(node) ??
    meta.defaultTitle
  );
}

/**
 * One sentence describing what a run actually did. Exists because a condition
 * that matches no path still ends the run `Succeeded` — see
 * `conditionExecutor` in `packages/workflows/src/runtime/condition.ts`.
 */
export function runOutcome(
  run: WorkflowRunDetail,
  steps: WorkflowRunStep[],
  definition: WorkflowDefinition | null
): RunOutcome {
  const nodeSteps = steps.filter((s) => !s.itemKey || s.itemKey === "");

  if (run.status === "Failed") {
    const failed = nodeSteps.find((s) => s.status === "Failed");
    const where = failed ? ` at "${stepTitle(failed, definition)}"` : "";
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
    const title = stepTitle(noMatch, definition);
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
    const title = stepTitle(skipped, definition);
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
