// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isUnitOnHold, type UnitHolds } from "./unitHold";
import { completedAtOperation } from "./workUnit";

/** Inspection can complete a serial only once, when it is in scope and cleared for production. */
export function inspectionEntityEligible(
  entity: {
    id: string;
    status: string | null;
    attributes: unknown;
    inOperationScope?: boolean;
  },
  operationId: string,
  holds: UnitHolds
) {
  return (
    entity.inOperationScope !== false &&
    !isUnsampleableEntityStatus(entity.status) &&
    !isUnitOnHold(holds, entity.id) &&
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

// The serial units a completion pass may post, in ascending sample order:
// sampled units whose sample isn't linked yet, then (optionally) sample-less
// eligible units. Verdict-driven double-posting is impossible — the sample
// link's partial UNIQUE index guards sampled units, and the `Operation <opId>`
// entity attribute (via entityEligible) guards sample-less ones.
export function getSerialCompletionCandidates(
  state: {
    samples: InspectionOutcomeSample[];
    linkedSampleIds: Set<string>;
    entities: { id: string }[];
    entityEligible: (id: string) => boolean;
  },
  opts: {
    // Accept completes Pending-sampled units too (identify-only scans that
    // never failed); progressive complete-passed takes Passed only.
    includePending: boolean;
    // Accept sweeps un-sampled eligible units; Partial/complete-passed don't.
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
