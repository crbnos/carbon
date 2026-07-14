import { readFileSync } from "node:fs";
import type { Binding } from "../binding";
import { outcomePath } from "../layout";
import { groomingNotes, tryExtractJson } from "./prompts";
import type {
  LoopOutcome,
  PlanTask,
  RunnerConfig,
  RunnerDeps,
  TaskStatus
} from "./types";

/**
 * Systematic chunking, owned by the harness — not by the groomer, not by the
 * outer-loop model. A binding with more than a couple of criteria is decomposed
 * into small, ordered, independently-committable tasks; each task is one
 * doer-session-sized unit with its own judge review and its own checkpoint
 * commit. Parsing is defensive: any planner failure degrades to a single
 * whole-binding task (the pre-plan behavior), and criteria the planner missed
 * are appended as a catch-all task so coverage is guaranteed by construction.
 */

/** One task covering the whole binding — the degenerate (and fallback) plan. */
function wholeTask(binding: Binding): PlanTask {
  return {
    title: binding.title,
    detail: "The complete work item (no decomposition).",
    criteria: binding.acceptance.map((_, i) => i)
  };
}

export function buildPlannerPrompt(binding: Binding): string {
  return `You are the PLANNER in an unattended conductor loop. Decompose the work item into small, ordered tasks. There is NO human; never ask a question. Do NOT change any files — read the codebase as needed, then answer.

Work item (${binding.kind}, risk ${binding.risk}): ${binding.title}

Acceptance criteria:
${binding.acceptance.map((c, i) => `  [${i}] ${c}`).join("\n")}
${groomingNotes(binding)}
Rules for the plan:
- 2 to 6 tasks, in dependency order (schema/migration first, then services, then UI, then tests/polish).
- Each task must be SMALL: completable by one focused coding session and reviewable by one short review session. One migration, one service function + test, one component — that scale.
- Each task must be independently committable: after it lands, the branch builds and passes lint/typecheck on its own.
- Each task lists the acceptance criterion indices it advances. Cover every index across the plan.

End your reply with EXACTLY one fenced json block, no prose after it:
\`\`\`json
{
  "tasks": [
    { "title": "<short imperative title>", "detail": "<2-3 sentences: what to build and where>", "criteria": [<acceptance indices this task advances>] }
  ]
}
\`\`\``;
}

const MAX_TASKS = 8;

export function parsePlanResult(text: string, binding: Binding): PlanTask[] {
  const raw = tryExtractJson<{ tasks?: unknown }>(text);
  const list = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const valid = binding.acceptance.length;
  const tasks: PlanTask[] = [];
  for (const t of list.slice(0, MAX_TASKS)) {
    if (typeof t !== "object" || t === null) continue;
    const { title, detail, criteria } = t as Partial<PlanTask>;
    if (typeof title !== "string" || title === "") continue;
    tasks.push({
      title,
      detail: typeof detail === "string" ? detail : "",
      criteria: Array.isArray(criteria)
        ? criteria.filter(
            (i): i is number =>
              typeof i === "number" &&
              Number.isInteger(i) &&
              i >= 0 &&
              i < valid
          )
        : []
    });
  }
  // Planner produced nothing usable ⇒ degrade to the whole binding as one task.
  if (tasks.length === 0) return [wholeTask(binding)];
  // Coverage by construction: criteria the planner missed become a final task.
  const covered = new Set(tasks.flatMap((t) => t.criteria));
  const missed = binding.acceptance
    .map((_, i) => i)
    .filter((i) => !covered.has(i));
  if (missed.length > 0) {
    tasks.push({
      title: "Remaining acceptance criteria",
      detail: "Criteria not covered by the planned tasks.",
      criteria: missed
    });
  }
  return tasks;
}

/**
 * Produce the task plan for a binding. Loop-sized bindings (≤2 criteria) skip
 * the planner session entirely — deterministic, free. Anything larger gets one
 * bounded planner session; its output is validated and coverage-completed.
 */
export function buildPlan(
  binding: Binding,
  config: RunnerConfig,
  deps: RunnerDeps
): PlanTask[] {
  if (binding.acceptance.length <= 2) return [wholeTask(binding)];
  try {
    const res = deps.claude({
      prompt: buildPlannerPrompt(binding),
      cwd: config.cwd,
      maxTurns: config.plannerMaxTurns,
      maxBudgetUsd: config.plannerMaxBudgetUsd
    });
    const tasks = parsePlanResult(res.text, binding);
    deps.log({
      event: "plan",
      tasks: tasks.map((t) => t.title),
      cost: res.costUsd,
      ...(res.stopReason ? { stopReason: res.stopReason } : {})
    });
    return tasks;
  } catch (err) {
    // A dead planner must never kill the run — fall back to the whole binding
    // as a single task (the pre-plan behavior).
    deps.log({
      event: "plan:failed",
      error: err instanceof Error ? err.message : String(err)
    });
    return [wholeTask(binding)];
  }
}

/** What `resolvePlan` hands the loop: tasks, their starting statuses, and any
 *  flags carried over from the run being resumed. */
export type ResolvedPlan = {
  tasks: PlanTask[];
  status: TaskStatus[];
  /** Prior run's proof gaps / questions — re-seeded so the PR keeps its flags. */
  unverified: string[];
  questions: string[];
  resumed: boolean;
};

/**
 * RESUME, deterministically: a prior non-shipped run on this branch left its
 * full plan (tasks + statuses) in `outcome.json`, which is committed with the
 * branch. Re-dispatching the same binding picks the plan back up — concluded
 * tasks (`done`/`flagged`) are skipped without spending a session, pending and
 * failed ones re-run. No re-planning, no model judgment, no outer-loop smarts
 * required: "run it again" is always the right recovery move.
 *
 * A prior `shipped` outcome never resumes (PR-feedback re-entry is new work —
 * it gets a fresh plan), and any unreadable/invalid outcome falls through to
 * fresh planning.
 */
export function resolvePlan(
  binding: Binding,
  config: RunnerConfig,
  deps: RunnerDeps
): ResolvedPlan {
  try {
    const prior = JSON.parse(
      readFileSync(outcomePath(config.cwd, binding.id), "utf8")
    ) as Partial<LoopOutcome>;
    const plan = prior?.plan;
    if (
      prior?.state !== "shipped" &&
      Array.isArray(plan) &&
      plan.length > 0 &&
      plan.every(
        (t) => typeof t?.title === "string" && Array.isArray(t?.criteria)
      )
    ) {
      const valid = binding.acceptance.length;
      const tasks: PlanTask[] = plan.map((t) => ({
        title: t.title,
        detail: typeof t.detail === "string" ? t.detail : "",
        criteria: t.criteria.filter(
          (i): i is number =>
            typeof i === "number" && Number.isInteger(i) && i >= 0 && i < valid
        )
      }));
      const status: TaskStatus[] = plan.map((t) =>
        t.status === "done" || t.status === "flagged" ? t.status : "pending"
      );
      deps.log({
        event: "plan:resume",
        priorState: prior.state,
        tasks: tasks.map((t, i) => `${t.title} [${status[i]}]`)
      });
      return {
        tasks,
        status,
        unverified: Array.isArray(prior.unverified) ? prior.unverified : [],
        questions: Array.isArray(prior.questions) ? prior.questions : [],
        resumed: true
      };
    }
  } catch {
    /* no prior outcome — fresh run */
  }
  const tasks = buildPlan(binding, config, deps);
  return {
    tasks,
    status: tasks.map(() => "pending"),
    unverified: [],
    questions: [],
    resumed: false
  };
}
