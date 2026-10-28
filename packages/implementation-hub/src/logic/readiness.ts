// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BOARD_TASKS, boardTasksForScope } from "../content/board";
import { SPINE } from "../content/spine";
import type { BoardTask, Mod, Tier } from "../types";
import { boardTasksForTier } from "./board";
import { taskKey } from "./keys";
import { spineForTier } from "./overlay";
import type { OnboardingCountKey } from "./status";

export type SetupCounts = Partial<Record<OnboardingCountKey, number | null>>;

// An operational task is ready once the records it needs exist: every count in
// its rule reaches its minimum. A count that could not be read (null) or was
// never loaded is not ready, so a task never shows on a guess. A task with no
// rule is always ready.
export function isReady(task: BoardTask, counts: SetupCounts): boolean {
  return (task.ready ?? []).every(({ count, min }) => {
    const value = counts[count];
    return value != null && value >= min;
  });
}

// The tasks to show: the ones that are ready, plus any task someone already
// started or ticked — a viewer whose count is unreadable (no permission for
// that module) must not lose work that was done. A hidden task counts toward
// nothing, neither progress nor the overdue cascade.
export function visibleTasks(
  tasks: BoardTask[],
  counts: SetupCounts,
  states?: Map<string, string>
): BoardTask[] {
  return tasks.filter(
    (task) =>
      isReady(task, counts) ||
      (states?.get(taskKey(task.key)) ?? "todo") !== "todo"
  );
}

// The Plan's tasks for a hub, the one list every view counts progress from:
// the tasks of the tier's phases, without excluded-module setup rows, and only
// the operational tasks that are ready. A task under a phase the tier does not
// have (Discovery on self-serve) is dropped here too, or it would count toward
// progress on a card that is never shown.
export function planTasks(
  tier: Tier,
  excludedModules: Mod[],
  counts: SetupCounts,
  states?: Map<string, string>
): BoardTask[] {
  const steps = new Set(spineForTier(SPINE, tier).map((step) => step.key));
  const tasks = boardTasksForScope(
    boardTasksForTier(BOARD_TASKS, tier),
    excludedModules
  ).filter((task) => steps.has(task.stepKey));
  return visibleTasks(tasks, counts, states);
}
