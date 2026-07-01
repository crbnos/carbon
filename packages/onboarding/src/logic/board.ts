import type { BoardTask, TaskValue, Tier } from "../types";
import { flagKey, taskKey } from "./keys";

// Drop tasks that don't apply to this tier (omitted `tiers` => all tiers), so a
// self-serve plan/board never shows paid-only work like hypercare.
export function boardTasksForTier(tasks: BoardTask[], tier: Tier): BoardTask[] {
  return tasks.filter((t) => !t.tiers || t.tiers.includes(tier));
}

// The status of a board task. A task with `setupKeys` always derives its
// status from those Setup Map rows' "configured" flags — all checked => done,
// some checked => in progress — with no manual tick of its own, so Plan and
// the Setup Map can never drift apart for the same work. Every other task is
// manual-only, ticked directly on the Plan page.
export function taskStatus(
  task: BoardTask,
  states: Map<string, string>
): TaskValue {
  if (task.setupKeys?.length) {
    const doneCount = task.setupKeys.filter(
      (k) => states.get(flagKey(`setup.${k}`)) === "1"
    ).length;
    if (doneCount === task.setupKeys.length) return "done";
    if (doneCount > 0) return "prog";
    return "todo";
  }

  return (states.get(taskKey(task.key)) as TaskValue) ?? "todo";
}

export function tasksForStep(tasks: BoardTask[], stepKey: string): BoardTask[] {
  return tasks.filter((t) => t.stepKey === stepKey);
}

export function stepTaskProgress(
  tasks: BoardTask[],
  stepKey: string,
  states: Map<string, string>
): { done: number; total: number } {
  const stepTasks = tasksForStep(tasks, stepKey);
  const done = stepTasks.filter((t) => taskStatus(t, states) === "done").length;
  return { done, total: stepTasks.length };
}
