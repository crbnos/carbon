// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MessageDescriptor } from "@lingui/core";
import { CUSTOMIZATION_STATUSES } from "../content/customization";
import type {
  BoardTask,
  CustomizationStatus,
  ImplementationRowData,
  StateKind,
  StepDef,
  TaskValue
} from "../types";
import { taskStatus } from "./board";
import {
  checkKey,
  flagKey,
  objectiveCheckKey,
  planAnchorId,
  rowItemKey,
  setupAnchorId,
  taskKey
} from "./keys";
import { isIsoDay, readObjective } from "./objectives";

// "My tasks": every hub item assigned to one person, with its status and its
// due date, read from the same keys the pages that hold the items write.

export type AssignedKind =
  | "task"
  | "setup"
  | "objective"
  | "question"
  | "customization";

// A board task's status, plus "dropped" for a customization that will not
// happen: nothing is left to do, but it is not done either.
export type AssignedStatus = TaskValue | "dropped";

export interface AssignedItem {
  // The assignment key (task:<key>, flag:setup.<key or row id>, row:<row id>).
  itemKey: string;
  kind: AssignedKind;
  // Template items carry a message; custom rows carry their own text.
  label: MessageDescriptor | string;
  // Where the item sits: a task's phase, a setup row's module group.
  context?: MessageDescriptor;
  // The hub page that holds the item, and the anchor of its section there.
  page: string;
  anchor?: string;
  status: AssignedStatus;
  // Done or dropped: nothing left to do, so never overdue.
  closed: boolean;
  // YYYY-MM-DD, or null when the item has no date.
  due: string | null;
  // The check-state write that ticks the item, for items ticked by hand. A
  // Setup Map derived task and a customization have none.
  tick?: { itemKey: string; kind: StateKind; on: string; off: string };
  // A customization's own status, which is finer than `status`.
  customizationStatus?: CustomizationStatus;
}

// The Setup Map rows the viewer can see, per module group.
export interface AssignableSetupGroup {
  // The group's stable key (setupGroupKey), for its section anchor.
  key: string;
  title: MessageDescriptor;
  rows: { key: string; object: MessageDescriptor }[];
}

export interface AssignmentSources {
  // itemKey -> assignee id.
  assignments: Map<string, string>;
  checks: Map<string, string>;
  // Board tasks, already filtered to the tier and the scope.
  tasks: BoardTask[];
  // The tier's spine steps, for each task's phase title.
  steps: StepDef[];
  // Gate step key -> the gate's date (YYYY-MM-DD). A task is due on its gate's
  // date; a gate without a date leaves its tasks undated.
  gateDates: Map<string, string>;
  setupGroups: AssignableSetupGroup[];
  // Every custom row of the hub.
  rows: ImplementationRowData[];
}

// Setup Map rows are the work of the Configure phase. A custom setup row has no
// board task, so it takes this gate's date.
const SETUP_STEP_KEY = "gate:configure";

const CUSTOMIZATION_TO_STATUS: Record<CustomizationStatus, AssignedStatus> = {
  proposed: "todo",
  agreed: "todo",
  inProgress: "prog",
  done: "done",
  dropped: "dropped"
};

const isCustomizationStatus = (value: unknown): value is CustomizationStatus =>
  typeof value === "string" && Object.hasOwn(CUSTOMIZATION_STATUSES, value);

const rowText = (row: ImplementationRowData, field: string) =>
  typeof row.payload[field] === "string" ? (row.payload[field] as string) : "";

// Pure: every item of the hub assigned to `userId`, in page order (tasks,
// then Setup Map rows, then custom rows). Items whose assignment points at
// something the viewer cannot see (another tier, an excluded module, a deleted
// row) are left out.
export function itemsAssignedTo(
  userId: string,
  sources: AssignmentSources
): AssignedItem[] {
  if (!userId) return [];
  const { assignments, checks, gateDates } = sources;
  const mine = (itemKey: string) => assignments.get(itemKey) === userId;
  const dueOn = (stepKey: string) => gateDates.get(stepKey) ?? null;
  const stepTitles = new Map(sources.steps.map((s) => [s.key, s.title]));
  const items: AssignedItem[] = [];

  for (const task of sources.tasks) {
    const itemKey = taskKey(task.key);
    if (!mine(itemKey)) continue;
    const status = taskStatus(task, checks);
    // A task that rolls up Setup Map rows is done on the Setup Map, so it
    // opens there and has no tick of its own.
    const fromSetupMap = !!task.setupKeys?.length;
    items.push({
      itemKey,
      kind: "task",
      label: task.label,
      context: stepTitles.get(task.stepKey),
      page: fromSetupMap ? "setup" : "plan",
      anchor: fromSetupMap
        ? setupAnchorId(task.key)
        : planAnchorId(task.stepKey),
      status,
      closed: status === "done",
      due: dueOn(task.stepKey),
      tick: fromSetupMap
        ? undefined
        : { itemKey, kind: "task", on: "done", off: "todo" }
    });
  }

  const setupItem = (
    rowKey: string,
    label: MessageDescriptor | string,
    stepKey: string,
    group?: AssignableSetupGroup
  ): AssignedItem => {
    const itemKey = flagKey(`setup.${rowKey}`);
    const done = checks.get(itemKey) === "1";
    return {
      itemKey,
      kind: "setup",
      label,
      context: group?.title,
      page: "setup",
      anchor: group ? setupAnchorId(group.key) : undefined,
      status: done ? "done" : "todo",
      closed: done,
      due: dueOn(stepKey),
      tick: { itemKey, kind: "scopeFlag", on: "1", off: "0" }
    };
  };

  // A template setup row is due with the board task that rolls it up.
  const setupRowStep = new Map(
    sources.tasks.flatMap((task) =>
      (task.setupKeys ?? []).map((key) => [key, task.stepKey] as const)
    )
  );
  for (const group of sources.setupGroups) {
    for (const row of group.rows) {
      if (!mine(flagKey(`setup.${row.key}`))) continue;
      items.push(
        setupItem(
          row.key,
          row.object,
          setupRowStep.get(row.key) ?? SETUP_STEP_KEY,
          group
        )
      );
    }
  }

  for (const row of sources.rows) {
    switch (row.collection) {
      case "setup": {
        if (!mine(flagKey(`setup.${row.id}`))) break;
        items.push(setupItem(row.id, rowText(row, "object"), SETUP_STEP_KEY));
        break;
      }
      case "objective": {
        const itemKey = rowItemKey(row.id);
        if (!mine(itemKey)) break;
        const objective = readObjective(row.payload);
        const doneKey = objectiveCheckKey(row.id);
        const done = checks.get(doneKey) === "1";
        items.push({
          itemKey,
          kind: "objective",
          label: objective.title,
          page: "objectives",
          status: done ? "done" : "todo",
          closed: done,
          due: objective.targetDate ?? null,
          tick: { itemKey: doneKey, kind: "check", on: "1", off: "0" }
        });
        break;
      }
      case "question": {
        const itemKey = rowItemKey(row.id);
        if (!mine(itemKey)) break;
        // A question is closed when someone marks it resolved on the
        // Requirements page (its own `check`), not merely when it has an answer.
        const resolvedKey = checkKey("question", row.id);
        const resolved = checks.get(resolvedKey) === "1";
        items.push({
          itemKey,
          kind: "question",
          label: rowText(row, "question"),
          page: "requirements",
          status: resolved ? "done" : "todo",
          closed: resolved,
          due: null,
          tick: { itemKey: resolvedKey, kind: "check", on: "1", off: "0" }
        });
        break;
      }
      case "customization": {
        const itemKey = rowItemKey(row.id);
        if (!mine(itemKey)) break;
        const customizationStatus = isCustomizationStatus(row.payload.status)
          ? row.payload.status
          : "proposed";
        const status = CUSTOMIZATION_TO_STATUS[customizationStatus];
        items.push({
          itemKey,
          kind: "customization",
          label: rowText(row, "title"),
          page: "customization",
          status,
          closed: status === "done" || status === "dropped",
          due: isIsoDay(row.payload.targetDate) ? row.payload.targetDate : null,
          customizationStatus
        });
        break;
      }
    }
  }

  return items;
}

// Pure: an open item is overdue once its due date is before today. Both are
// `YYYY-MM-DD`, so string order is day order. Due today is not overdue.
export function isOverdue(
  due: string | null | undefined,
  closed: boolean,
  today: string
): boolean {
  return !closed && !!due && due < today;
}

// Pure: overdue first, then the rest of the open items, then the closed ones;
// within each, the earliest due date first and undated items last. Items with
// the same rank and date keep their page order.
export function sortAssigned(
  items: AssignedItem[],
  today: string
): AssignedItem[] {
  const rank = (item: AssignedItem) =>
    isOverdue(item.due, item.closed, today) ? 0 : item.closed ? 2 : 1;
  const byDue = (a: string | null, b: string | null) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || byDue(a.due, b.due));
}
