// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { BoardTask } from "../types";
import { taskStatus } from "./board";
import { type Timeline, toISODate } from "./timeline";

// The overdue cascade: the open tasks whose checkpoint date has passed, and
// every later task they hold up through the dependency map
// (content/dependencies.ts). It exists to push people to clear overdue work.
//
// Dates are `YYYY-MM-DD` strings throughout, and ISO dates sort as strings, so
// "before" is a string comparison. `today` comes from the caller: the browser
// passes `today(getLocalTimeZone()).toString()`.

// Each gate's date (its step key → YYYY-MM-DD), from the resolved timeline.
// Empty when the hub has no dates: nothing is due, so nothing is overdue.
export function gateDueDates(
  timeline: Pick<Timeline, "bars">
): Map<string, string> {
  return new Map(
    timeline.bars.flatMap((bar) =>
      bar.gateDate ? [[bar.key, toISODate(bar.gateDate)] as const] : []
    )
  );
}

// True when a due date has passed: it is before today. Due today is not late.
export function isPastDue(due: string | undefined, today: string): boolean {
  return due != null && due < today;
}

// A task is due on its phase's gate date. Overdue: still open (not "done")
// and due before today.
export function overdueTasks(
  tasks: BoardTask[],
  states: Map<string, string>,
  gateDates: Map<string, string>,
  today: string
): BoardTask[] {
  return tasks.filter(
    (task) =>
      taskStatus(task, states) !== "done" &&
      isPastDue(gateDates.get(task.stepKey), today)
  );
}

export interface HeldUpTask {
  key: string;
  // The overdue tasks it is reachable from, in the order they were given.
  causes: string[];
}

// Every task the overdue tasks hold up, directly or through other tasks,
// except the overdue tasks themselves. Each one lists the overdue tasks that
// hold it up. A cycle in the map is walked once, never looped.
export function heldUp(
  overdueKeys: string[],
  dependencies: Record<string, string[]>
): HeldUpTask[] {
  const overdue = new Set(overdueKeys);
  const causes = new Map<string, string[]>();
  for (const root of overdueKeys) {
    // Breadth-first, one level of the map at a time.
    const seen = new Set([root]);
    let frontier = dependencies[root] ?? [];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const key of frontier) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (!overdue.has(key)) {
          causes.set(key, [...(causes.get(key) ?? []), root]);
        }
        next.push(...(dependencies[key] ?? []));
      }
      frontier = next;
    }
  }
  return [...causes].map(([key, by]) => ({ key, causes: by }));
}

export interface OverdueCascade {
  overdue: BoardTask[];
  heldUp: { task: BoardTask; causes: BoardTask[] }[];
}

// The cascade as the Plan and the Gantt show it, over the tasks the hub shows
// (logic/readiness.ts `planTasks`). The walk passes through tasks the hub does
// not show, so a dependency survives a step this tier skips; only open tasks
// the hub shows are listed as held up, in plan order.
export function overdueCascade(
  tasks: BoardTask[],
  states: Map<string, string>,
  gateDates: Map<string, string>,
  today: string,
  dependencies: Record<string, string[]>
): OverdueCascade {
  const overdue = overdueTasks(tasks, states, gateDates, today);
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const causes = new Map(
    heldUp(
      overdue.map((task) => task.key),
      dependencies
    ).map((held) => [held.key, held.causes])
  );
  return {
    overdue,
    heldUp: tasks.flatMap((task) => {
      const by = causes.get(task.key);
      if (!by || taskStatus(task, states) === "done") return [];
      return [
        {
          task,
          causes: by.flatMap((key) => {
            const cause = byKey.get(key);
            return cause ? [cause] : [];
          })
        }
      ];
    })
  };
}
