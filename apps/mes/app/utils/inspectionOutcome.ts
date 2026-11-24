// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isUnitOnHold, type UnitHolds } from "./unitHold";
import { completedAtOperation } from "./workUnit";

/** A held WIP serial can be covered by the acceptance decision but must clear
 * its hold and any physical rejection before it can post. */
export function inspectionEntityEligible(
  entity: {
    id: string;
    status: string | null;
    attributes: unknown;
    inOperationScope?: boolean;
  },
  operationId: string,
  holds: UnitHolds,
  includeHeld = false
) {
  const held = isUnitOnHold(holds, entity.id);
  return (
    entity.inOperationScope !== false &&
    (!isUnsampleableEntityStatus(entity.status) ||
      (includeHeld && held && entity.status === "Rejected")) &&
    (includeHeld || !held) &&
    !completedAtOperation(entity.attributes, operationId)
  );
}

export function isUnsampleableEntityStatus(status: string | null | undefined) {
  return (
    status === "Consumed" || status === "Rejected" || status === "Scrapped"
  );
}

/** A passed serial sample stays postable after acceptance, including partial
 * acceptance, if its hold cleared after disposition. The sample link prevents a retry posting twice. */
export function canPostPassedSamples(status: string, serial: boolean) {
  return (
    status === "Pending" ||
    status === "In Progress" ||
    (serial && (status === "Passed" || status === "Partial"))
  );
}

export type InspectionOutcomeSample = {
  id: string;
  trackedEntityId: string | null;
  status: string;
};

type SerialCandidateState = {
  samples: InspectionOutcomeSample[];
  linkedSampleIds: Set<string>;
  entities: { id: string }[];
  entityEligible: (id: string) => boolean;
};

// The serial units a completion pass may post, in ascending sample order:
// sampled units whose sample isn't linked yet, then (optionally) sample-less
// eligible units. Verdict-driven double-posting is impossible — the sample
// link's partial UNIQUE index guards sampled units, and the `Operation <opId>`
// entity attribute (via entityEligible) guards sample-less ones.
export function getSerialCompletionCandidates(
  state: SerialCandidateState,
  opts: {
    // Accept completes Pending-sampled units too (identify-only scans that
    // never failed); progressive complete-passed takes Passed only.
    includePending: boolean;
    // Accept covers unsampled units as part of the lot decision.
    includeSampleless: boolean;
    excludeEntityIds?: Set<string>;
  }
): { trackedEntityId: string; inspectionSampleId: string | null }[] {
  const candidates: {
    trackedEntityId: string;
    inspectionSampleId: string | null;
  }[] = [];
  const sampledEntityIds = new Set<string>();
  for (const sample of state.samples) {
    if (sample.trackedEntityId) sampledEntityIds.add(sample.trackedEntityId);
    const statusOk =
      sample.status === "Passed" ||
      (opts.includePending && sample.status === "Pending");
    if (!statusOk) continue;
    if (!sample.trackedEntityId) continue;
    if (state.linkedSampleIds.has(sample.id)) continue;
    if (!state.entityEligible(sample.trackedEntityId)) continue;
    if (opts.excludeEntityIds?.has(sample.trackedEntityId)) continue;
    candidates.push({
      trackedEntityId: sample.trackedEntityId,
      inspectionSampleId: sample.id
    });
  }
  if (opts.includeSampleless) {
    for (const entity of state.entities) {
      if (sampledEntityIds.has(entity.id)) continue;
      if (!state.entityEligible(entity.id)) continue;
      if (opts.excludeEntityIds?.has(entity.id)) continue;
      candidates.push({ trackedEntityId: entity.id, inspectionSampleId: null });
    }
  }
  return candidates;
}

/** Once Accept closes a sampling-plan lot, its saved decision can complete an
 * unsampled or identify-only unit. Older lots have only individual verdicts. */
export function getPostableInspectionUnits(
  state: SerialCandidateState,
  inspection: { status: string; acceptedUnitIds: string[] | null }
) {
  const accepted =
    inspection.status === "Passed" && inspection.acceptedUnitIds != null
      ? new Set(inspection.acceptedUnitIds)
      : null;
  return getSerialCompletionCandidates(
    {
      ...state,
      entityEligible: (id) =>
        (!accepted || accepted.has(id)) && state.entityEligible(id)
    },
    { includePending: !!accepted, includeSampleless: !!accepted }
  );
}
