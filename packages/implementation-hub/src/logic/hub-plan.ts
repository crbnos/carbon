// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The hub as an agent reads it over MCP (`getHubStatus`): every gate with its
// tasks, every Setup Map row, the objectives and the custom rows, each with
// the item key a write tool takes, its status, its assignee and its evidence.
// Pure, so the read and the hub's own pages derive the same picture from the
// same rules (planTasks, effectiveGateStatus, taskStatus).

import type { MessageDescriptor } from "@lingui/core";
import { SETUP_ROW_EVIDENCE } from "../content/evidence";
import { OBJECTIVE_EVENTS } from "../content/objectives";
import { SETUP_GROUPS } from "../content/setup";
import { SPINE } from "../content/spine";
import type {
  AssignmentRow,
  CheckStateRow,
  FieldValueRow,
  HubExclusions,
  ImplementationRowData,
  Tier
} from "../types";
import { stepTaskProgress, taskStatus, tasksForStep } from "./board";
import { checkKey, flagKey, rowItemKey, taskKey } from "./keys";
import { readObjective } from "./objectives";
import {
  effectiveGateStatus,
  fieldMap,
  spineForTier,
  stateMap
} from "./overlay";
import { planTasks, type SetupCounts } from "./readiness";
import type { OnboardingCountKey } from "./status";
import { gateDateKey, PLAN_START_KEY } from "./timeline";
import { filterByModule } from "./visibility";

// Turns a template message into text. The ERP passes its English catalog; the
// fallback reads the descriptor's source text.
export type Label = (descriptor: MessageDescriptor) => string;

const sourceText: Label = (descriptor) => descriptor.message ?? descriptor.id;

const evidenceOf = (
  key: OnboardingCountKey | undefined,
  counts: SetupCounts
) => (key ? { count: key, value: counts[key] ?? null } : undefined);

export function buildHubPlan({
  tier,
  exclusions,
  checkStates,
  fieldValues,
  rows,
  assignments,
  counts,
  label = sourceText
}: {
  tier: Tier;
  exclusions: HubExclusions;
  checkStates: CheckStateRow[];
  fieldValues: FieldValueRow[];
  rows: ImplementationRowData[];
  assignments: AssignmentRow[];
  counts: SetupCounts;
  label?: Label;
}) {
  const states = stateMap(checkStates);
  const verified = new Map(
    checkStates.map((row) => [row.itemKey, row.verifiedAt ?? null])
  );
  const assignee = new Map(
    assignments.map((row) => [row.itemKey, row.assigneeId])
  );
  const fields = fieldMap(fieldValues);
  const steps = spineForTier(SPINE, tier);
  const tasks = planTasks(tier, exclusions.modules, counts, states);
  const noSignals = {
    hasItems: false,
    hasMakeMethod: false,
    hasJob: false,
    hasSalesOrder: false,
    hasTrackedEntity: false
  };

  const gates = steps.map((step) => ({
    itemKey: step.key,
    title: label(step.title),
    checkpoint: label(step.gate),
    status: effectiveGateStatus(
      step,
      states,
      noSignals,
      stepTaskProgress(tasks, step.key, states)
    ),
    date: fields.get(gateDateKey(step.key)) ?? null,
    verifiedAt: verified.get(step.key) ?? null,
    tasks: tasksForStep(tasks, step.key).map((task) => ({
      // A task that rolls up Setup Map rows is ticked through those rows.
      itemKey: task.setupKeys?.length ? null : taskKey(task.key),
      assignKey: taskKey(task.key),
      label: label(task.label),
      status: taskStatus(task, states),
      assigneeId: assignee.get(taskKey(task.key)) ?? null,
      evidence: evidenceOf(task.evidence, counts)
    })),
    productSteps: (step.nested ?? []).map((nested) => ({
      itemKey: nested.key,
      label: label(nested.label),
      status: states.get(nested.key) ?? "todo"
    }))
  }));

  const setupRows = SETUP_GROUPS.flatMap((group) =>
    filterByModule(group.rows, exclusions.modules).map((row) => {
      const itemKey = flagKey(`setup.${row.key}`);
      return {
        itemKey,
        group: label(group.title),
        label: label(row.object),
        configured: states.get(itemKey) === "1",
        assigneeId: assignee.get(itemKey) ?? null,
        verifiedAt: verified.get(itemKey) ?? null,
        evidence: evidenceOf(SETUP_ROW_EVIDENCE[row.key], counts)
      };
    })
  );

  const objectives = rows
    .filter((row) => row.collection === "objective")
    .map((row) => {
      const objective = readObjective(row.payload);
      return {
        rowId: row.id,
        itemKey: checkKey("objective", row.id),
        assignKey: rowItemKey(row.id),
        ...objective,
        done: states.get(checkKey("objective", row.id)) === "1",
        assigneeId: assignee.get(rowItemKey(row.id)) ?? null,
        source: row.source ?? null,
        evidence: objective.event
          ? evidenceOf(OBJECTIVE_EVENTS[objective.event].countKey, counts)
          : undefined
      };
    });

  const customRows = rows
    .filter((row) => row.collection !== "objective")
    .map((row) => ({
      rowId: row.id,
      collection: row.collection,
      assignKey: rowItemKey(row.id),
      payload: row.payload,
      assigneeId: assignee.get(rowItemKey(row.id)) ?? null,
      source: row.source ?? null,
      sourceRef: row.sourceRef ?? null
    }));

  return {
    startDate: fields.get(PLAN_START_KEY) ?? null,
    gates,
    setupRows,
    objectives,
    customRows
  };
}
