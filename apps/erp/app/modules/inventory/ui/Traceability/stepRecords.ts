// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { StepRecord } from "../../types";

export type ActivityStepRecord = StepRecord & { outputSerial?: string };
export type ActivityMeasurements = {
  activityId: string | null;
  stepRecords: ActivityStepRecord[];
};

export function stepRecordsForSelection(
  activityId: string | null,
  measurements?: ActivityMeasurements
) {
  // React Router retains the previous response while the next one loads.
  return activityId && measurements?.activityId === activityId
    ? measurements.stepRecords
    : [];
}

export type SerialOutput = {
  trackedEntityId: string;
  quantity: number;
  trackedEntity: { readableId: string | null } | null;
};

export function batchOutputSerialsByIndex(
  attributes: Record<string, unknown>,
  outputs: SerialOutput[]
): Map<number, string> {
  // Older single-unit activities can carry one durable Unit index. A
  // completion ordinal on an entity is a different number from its step index.
  const legacy =
    outputs.length === 1
      ? { [outputs[0]!.trackedEntityId]: attributes.Unit }
      : {};
  const byId =
    attributes["Output Unit Indices"] === undefined
      ? legacy
      : attributes["Output Unit Indices"];
  const indices = new Map<number, string>();
  if (
    !byId ||
    typeof byId !== "object" ||
    Array.isArray(byId) ||
    Object.keys(byId).length !== outputs.length
  )
    return indices;
  for (const output of outputs) {
    const index = (byId as Record<string, unknown>)[output.trackedEntityId];
    if (
      !output.trackedEntity ||
      output.quantity !== 1 ||
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      indices.has(index)
    )
      return new Map();
    indices.set(
      index,
      output.trackedEntity.readableId || output.trackedEntityId
    );
  }
  return indices;
}
