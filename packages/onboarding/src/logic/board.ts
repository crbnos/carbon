import type { BoardTask, TaskValue, Tier } from "../types";
import { taskKey } from "./keys";

// Drop tasks that don't apply to this tier (omitted `tiers` => all tiers), so a
// self-serve plan/board never shows paid-only work like hypercare.
export function boardTasksForTier(tasks: BoardTask[], tier: Tier): BoardTask[] {
  return tasks.filter((t) => !t.tiers || t.tiers.includes(tier));
}

// The status of a board task from stored state (default "todo"). Plan-page
// bullets derive from these same values, so Board ↔ Plan can never drift.
export function taskStatus(
  task: BoardTask,
  states: Map<string, string>
): TaskValue {
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
