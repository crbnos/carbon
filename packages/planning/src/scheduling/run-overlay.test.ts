// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { CrossJobOperation } from "./master-data-provider.ts";
import {
  dependencyEdgesEqual,
  mergeCrossJobOperations,
  visibleReservations
} from "./run-overlay.ts";
import type { PlannedReservation } from "./types.ts";

const NOW = 1_000;

const reservation = (
  overrides: Partial<PlannedReservation> = {}
): PlannedReservation => ({
  resourceKind: "WorkCenter",
  resourceId: "wc1",
  operationId: "op1",
  startAt: NOW + 10,
  endAt: NOW + 20,
  ...overrides
});

const operation = (
  id: string,
  workCenterId: string | null,
  priority = 1
): CrossJobOperation => ({
  id,
  workCenterId,
  priority,
  dueDate: null,
  startDate: null,
  deadlineType: null,
  jobPriority: null,
  createdAt: null,
  projectedCompletionAt: null,
  setupTime: null,
  setupUnit: null,
  laborTime: null,
  laborUnit: null,
  machineTime: null,
  machineUnit: null,
  operationQuantity: null,
  operationLeadTime: null
});

describe("dependencyEdgesEqual", () => {
  const a = { operationId: "b", dependsOnId: "a" };
  const b = { operationId: "c", dependsOnId: "b" };

  it("ignores order", () => {
    expect(dependencyEdgesEqual([a, b], [b, a])).toBe(true);
  });

  it("sees an added, a removed and a reversed edge", () => {
    expect(dependencyEdgesEqual([a], [a, b])).toBe(false);
    expect(dependencyEdgesEqual([a, b], [a])).toBe(false);
    expect(
      dependencyEdgesEqual([a], [{ operationId: "a", dependsOnId: "b" }])
    ).toBe(false);
  });

  it("treats two empty sets as equal", () => {
    expect(dependencyEdgesEqual([], [])).toBe(true);
  });
});

describe("visibleReservations", () => {
  const writes = (
    jobStatus: string | null,
    reservations: PlannedReservation[]
  ) => ({ jobId: "job1", jobStatus, reservations });

  it("carries a released job's reservation to the jobs after it", () => {
    expect(
      visibleReservations(writes("Ready", [reservation()]), "J1", NOW)
    ).toEqual([
      {
        resourceKind: "WorkCenter",
        resourceId: "wc1",
        startAt: NOW + 10,
        endAt: NOW + 20,
        jobId: "job1",
        readableJobId: "J1",
        jobOperationBatchId: null
      }
    ]);
  });

  it("drops placeholders and reservations that ended by now", () => {
    const rows = visibleReservations(
      writes("In Progress", [
        reservation({ isPlaceholder: true }),
        reservation({ startAt: NOW - 20, endAt: NOW })
      ]),
      "J1",
      NOW
    );
    expect(rows).toEqual([]);
  });

  it("holds no capacity for a job that is not released", () => {
    for (const status of ["Draft", "Planned", "Completed", null]) {
      expect(
        visibleReservations(writes(status, [reservation()]), "J1", NOW)
      ).toEqual([]);
    }
  });
});

describe("mergeCrossJobOperations", () => {
  it("replaces a stored operation with its new placement", () => {
    const merged = mergeCrossJobOperations(
      [operation("a", "wc1", 1), operation("b", "wc1", 2)],
      new Map([["a", operation("a", "wc1", 9)]]),
      ["wc1"]
    );
    expect(merged.map((o) => [o.id, o.priority])).toEqual([
      ["b", 2],
      ["a", 9]
    ]);
  });

  it("moves an operation to the work center it was placed at", () => {
    const placed = new Map([["a", operation("a", "wc2")]]);
    expect(
      mergeCrossJobOperations([operation("a", "wc1")], placed, ["wc1"])
    ).toEqual([]);
    expect(
      mergeCrossJobOperations([], placed, ["wc2"]).map((o) => o.id)
    ).toEqual(["a"]);
  });

  it("leaves out a placed operation with no work center", () => {
    expect(
      mergeCrossJobOperations(
        [operation("a", "wc1")],
        new Map([["a", operation("a", null)]]),
        ["wc1"]
      )
    ).toEqual([]);
  });
});
