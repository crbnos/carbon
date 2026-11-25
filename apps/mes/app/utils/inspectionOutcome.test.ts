// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  canPostPassedSamples,
  getSerialCompletionCandidates,
  inspectionEntityEligible
} from "./inspectionOutcome";
import type { UnitHolds } from "./unitHold";

describe("serial inspection dispositions", () => {
  it("accepts the eligible sample and posts the other passed sample once Quality releases it", () => {
    const holds: UnitHolds = {
      held: [
        {
          id: "issue",
          readableId: "NCR-1",
          name: "Dent",
          status: "Registered",
          description: null,
          type: null,
          createdAt: ""
        }
      ]
    };
    const entities = ["held", "peer"].map((id) => ({
      id,
      attributes: {},
      status: "Reserved"
    }));
    const state = {
      entities,
      samples: entities.map(({ id }) => ({
        id: "sample-" + id,
        trackedEntityId: id,
        status: "Passed"
      })),
      linkedSampleIds: new Set<string>(),
      entityEligible(id: string) {
        return inspectionEntityEligible(
          entities.find((e) => e.id === id)!,
          "op",
          holds
        );
      }
    };
    const accept = () =>
      getSerialCompletionCandidates(state, {
        includePending: true,
        includeSampleless: true
      });
    const passed = () =>
      getSerialCompletionCandidates(state, {
        includePending: false,
        includeSampleless: false
      });
    const peer = { trackedEntityId: "peer", inspectionSampleId: "sample-peer" };
    expect(passed()).toEqual([peer]);
    expect(accept()).toEqual([peer]);
    state.linkedSampleIds.add("sample-peer");
    expect(passed()).toEqual([]);
    delete holds.held;
    expect(canPostPassedSamples("Passed", true)).toBe(true);
    expect(passed()).toEqual([
      { trackedEntityId: "held", inspectionSampleId: "sample-held" }
    ]);
    state.linkedSampleIds.add("sample-held");
    expect(passed()).toEqual([]);
  });
  it("refuses rejected, scrapped, out-of-scope and already-completed serials", () => {
    const unit = { id: "serial", attributes: {}, status: "Reserved" };
    for (const entity of [
      { ...unit, status: "Rejected" },
      { ...unit, status: "Scrapped" },
      { ...unit, status: "Consumed" },
      { ...unit, inOperationScope: false },
      { ...unit, attributes: { "Operation op": 0 } }
    ]) {
      expect(inspectionEntityEligible(entity, "op", {})).toBe(false);
    }
  });
  it("allows delayed serial passes on a Partial lot and preserves the other terminal dispositions", () => {
    expect(canPostPassedSamples("Partial", true)).toBe(true);
    expect(canPostPassedSamples("Passed", false)).toBe(false);
    expect(canPostPassedSamples("Failed", true)).toBe(false);
    expect(canPostPassedSamples("Cancelled", true)).toBe(false);
  });
});
