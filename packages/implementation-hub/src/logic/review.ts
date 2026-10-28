// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a gate's verification covers on the Gate Review page. Carbon staff of a
// guided or enterprise hub review a gate's items with their evidence, then
// verify the gate: the server stamps the gate key and every ticked item key. A
// later tick on an item clears that item's stamp.

import { parseAbsolute } from "@internationalized/date";
import type { MessageDescriptor } from "@lingui/core";
import { SETUP_GROUPS } from "../content/setup";
import type { BoardTask, CheckStateRow, StepDef, TaskValue } from "../types";
import { tasksForStep } from "./board";
import { flagKey, gateKey, taskKey } from "./keys";
import type { OnboardingCountKey } from "./status";

export type GateReviewItemKind = "task" | "setupRow" | "productStep";

export interface GateReviewItem {
  // The item's status key: task:<key>, flag:setup.<key or row id>, or the
  // product step's key.
  itemKey: string;
  kind: GateReviewItemKind;
  // The board task key: the task itself, or the setup-derived Configure task
  // that rolls up this Setup Map row. Absent on custom setup rows and product
  // steps.
  taskKey?: string;
  // The Setup Map row key, or the custom setup row's id.
  rowKey?: string;
  // The template label. Absent on custom setup rows, whose label is row data.
  label?: MessageDescriptor;
  // An operational task's evidence count (BoardTask.evidence).
  evidence?: OnboardingCountKey;
}

// Custom setup rows belong to the gate the Setup Map works through.
const CONFIGURE_GATE = gateKey("configure");

const SETUP_ROW_LABELS = new Map(
  SETUP_GROUPS.flatMap((group) =>
    group.rows.map((row) => [row.key, row.object] as const)
  )
);

// The items of one gate, in review order: each board task of the step (a
// setup-derived task expands to its Setup Map rows), the custom setup rows for
// the Configure gate, then the step's nested product steps. Pass the tier- and
// scope-filtered tasks and a tier-resolved step (spineForTier), so the review
// covers what the customer's Plan shows.
export function gateReviewItems(
  step: StepDef,
  tasks: BoardTask[],
  customSetupRowIds: string[]
): GateReviewItem[] {
  const items: GateReviewItem[] = [];
  for (const task of tasksForStep(tasks, step.key)) {
    if (task.setupKeys?.length) {
      for (const rowKey of task.setupKeys) {
        items.push({
          itemKey: flagKey(`setup.${rowKey}`),
          kind: "setupRow",
          taskKey: task.key,
          rowKey,
          label: SETUP_ROW_LABELS.get(rowKey)
        });
      }
    } else {
      items.push({
        itemKey: taskKey(task.key),
        kind: "task",
        taskKey: task.key,
        label: task.label,
        evidence: task.evidence
      });
    }
  }
  if (step.key === CONFIGURE_GATE) {
    for (const id of customSetupRowIds) {
      items.push({
        itemKey: flagKey(`setup.${id}`),
        kind: "setupRow",
        rowKey: id
      });
    }
  }
  for (const nested of step.nested ?? []) {
    items.push({
      itemKey: nested.key,
      kind: "productStep",
      label: nested.label
    });
  }
  return items;
}

const TASK_VALUES: readonly string[] = ["todo", "prog", "blocked", "done"];

// An item's status in task terms. A setup row stores "1" when configured;
// tasks and product steps store their status. Anything else reads as todo.
export function reviewItemStatus(
  item: GateReviewItem,
  value: string | undefined
): TaskValue {
  if (item.kind === "setupRow") return value === "1" ? "done" : "todo";
  return value && TASK_VALUES.includes(value) ? (value as TaskValue) : "todo";
}

export function isItemTicked(
  item: GateReviewItem,
  value: string | undefined
): boolean {
  return reviewItemStatus(item, value) === "done";
}

export interface GateVerification {
  verified: boolean;
  // Items whose tick changed after the gate was verified.
  changed: number;
  changedItemKeys: string[];
}

// Whether `later` is a later instant than `earlier`. Both are stored
// timestamps; an unreadable one compares as not later.
function isLaterInstant(later: string, earlier: string): boolean {
  try {
    return (
      parseAbsolute(later, "UTC").compare(parseAbsolute(earlier, "UTC")) > 0
    );
  } catch {
    return false;
  }
}

// A gate is verified when its own tick carries a stamp. An item changed since
// then has lost its stamp: it is ticked but unverified (re-ticked, or ticked
// after the review), or it was written after the gate's verification (for
// example unticked since).
export function gateVerification(
  stepKey: string,
  items: GateReviewItem[],
  rowMap: Map<string, CheckStateRow>
): GateVerification {
  const verifiedAt = rowMap.get(stepKey)?.verifiedAt;
  if (!verifiedAt) return { verified: false, changed: 0, changedItemKeys: [] };
  const changedItemKeys = items
    .filter((item) => {
      const row = rowMap.get(item.itemKey);
      if (!row || row.verifiedAt) return false;
      if (isItemTicked(item, row.value)) return true;
      return row.updatedAt ? isLaterInstant(row.updatedAt, verifiedAt) : false;
    })
    .map((item) => item.itemKey);
  return {
    verified: true,
    changed: changedItemKeys.length,
    changedItemKeys
  };
}
