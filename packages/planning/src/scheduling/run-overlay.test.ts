// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parseAbsolute } from "@internationalized/date";
import { describe, expect, it } from "vitest";
import type {
  CrossJobOperation,
  MasterDataProvider
} from "./master-data-provider.ts";
import {
  dependencyEdgesEqual,
  mergeCrossJobOperations,
  startedOperationHolds,
  startedOperationsToHold,
  visibleReservations
} from "./run-overlay.ts";
import type { ReservationInterval } from "./slot-allocator.ts";
import type {
  BaseOperation,
  PlannedReservation,
  ScheduledOperation
} from "./types.ts";
import {
  type FiniteSchedulingContext,
  WorkCenterSelector
} from "./work-center-selector.ts";

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

describe("startedOperationHolds", () => {
  const HOUR = 3_600_000;
  const start = parseAbsolute("2026-01-05T00:00:00Z", "UTC").toDate().getTime();
  const windows = new Map([["wc1", [{ start, end: start + 30 * 24 * HOUR }]]]);

  // One job's run on wc1, seeing the given reservations, as buildFiniteContext
  // would hand them to the selector.
  const place = (
    op: Partial<ScheduledOperation>,
    reservations: ReservationInterval[]
  ) => {
    const selector = new WorkCenterSelector(
      {} as unknown as MasterDataProvider,
      "loc1"
    );
    const ctx: FiniteSchedulingContext = {
      capacityByWorkCenter: new Map([
        [
          "wc1",
          {
            workCenter: { id: "wc1" },
            windows: windows.get("wc1")!,
            reservations
          }
        ]
      ]),
      requirementByProcess: new Map(),
      employeesByAbility: new Map(),
      reservationsByEmployee: new Map(),
      dependencies: [],
      now: start,
      horizonDays: 365,
      windowsEnd: start + 30 * 24 * HOUR,
      peopleByWorkCenter: new Map(),
      assignmentsByEmployee: new Map(),
      requiresStaffing: false,
      peopleBudgets: new Map(),
      windowsByEmployee: new Map(),
      timeZone: "UTC",
      operationsWithEvents: new Set()
    };
    selector.setFiniteContext(ctx);
    const scheduled: ScheduledOperation = {
      id: "op",
      jobId: "job",
      processId: "proc",
      workCenterId: "wc1",
      startDate: null,
      dueDate: null,
      priority: 1,
      durationHours: 0,
      durationDays: 1,
      hasConflict: false,
      conflictReason: null,
      setupTime: 0,
      laborUnit: "Total Hours",
      machineTime: 0,
      operationQuantity: 1,
      quantityComplete: 0,
      ...op
    };
    return selector
      .selectWorkCentersForOperations([scheduled], { jobDueDate: null })
      .get("op");
  };

  it("keeps a running op on its machine ahead of a higher-priority job's unstarted op", () => {
    // job-1 runs first (higher priority): an unstarted 2h op on wc1.
    // job-2 runs second: its 3h op on wc1 is already In Progress.
    const holds = startedOperationHolds({
      operations: [
        { jobId: "job-2", readableJobId: "J2", workCenterId: "wc1", hours: 3 }
      ],
      windowsByWorkCenter: windows,
      reservations: [],
      now: start,
      horizonEnd: start + 30 * 24 * HOUR,
      timeZone: "UTC"
    });
    expect(holds).toEqual([
      {
        resourceKind: "WorkCenter",
        resourceId: "wc1",
        startAt: start,
        endAt: start + 3 * HOUR,
        jobId: "job-2",
        readableJobId: "J2",
        jobOperationBatchId: null
      }
    ]);

    // job-1 sees job-2's hold and waits for it.
    const job1 = place({ laborTime: 2, status: "Ready" }, [...holds]);
    expect([job1?.placedStart, job1?.placedEnd]).toEqual([
      "2026-01-05T03:00:00.000Z",
      "2026-01-05T05:00:00.000Z"
    ]);

    // job-2's own run sees job-1's placement, not its own hold: it runs now.
    const job2 = place({ laborTime: 3, status: "In Progress" }, [
      { startAt: start + 3 * HOUR, endAt: start + 5 * HOUR }
    ]);
    expect([job2?.placedStart, job2?.placedEnd]).toEqual([
      "2026-01-05T00:00:00.000Z",
      "2026-01-05T03:00:00.000Z"
    ]);
  });

  it("holds the operator working a started gated op, so an earlier job's gated op waits for them", () => {
    // job-2's started op on wc1: 3h left, all hands-on, emp-1 clocked on it.
    const holds = startedOperationHolds({
      operations: [
        {
          jobId: "job-2",
          readableJobId: "J2",
          workCenterId: "wc1",
          hours: 3,
          attendedHours: 3,
          employeeIds: ["emp-1"]
        }
      ],
      windowsByWorkCenter: windows,
      reservations: [],
      now: start,
      horizonEnd: start + 30 * 24 * HOUR,
      timeZone: "UTC"
    });

    // job-1 runs first: a 2h gated op on a free machine (wc2) whose only
    // qualified operator is emp-1. It sees job-2's holds, as
    // buildFiniteContext hands Employee rows to the selector.
    const free = [{ start, end: start + 30 * 24 * HOUR }];
    const selector = new WorkCenterSelector(
      {} as unknown as MasterDataProvider,
      "loc1"
    );
    selector.setFiniteContext({
      capacityByWorkCenter: new Map([
        ["wc2", { workCenter: { id: "wc2" }, windows: free, reservations: [] }]
      ]),
      requirementByProcess: new Map([
        ["proc", { abilityId: "ab1", abilityName: "Welding" }]
      ]),
      employeesByAbility: new Map([
        ["ab1", [{ employeeId: "emp-1", expiresAt: null, windows: free }]]
      ]),
      reservationsByEmployee: new Map([
        [
          "emp-1",
          holds
            .filter((h) => h.resourceKind === "Employee")
            .map((h) => ({ startAt: h.startAt, endAt: h.endAt }))
        ]
      ]),
      dependencies: [],
      now: start,
      horizonDays: 365,
      windowsEnd: start + 30 * 24 * HOUR,
      peopleByWorkCenter: new Map(),
      assignmentsByEmployee: new Map(),
      requiresStaffing: false,
      peopleBudgets: new Map(),
      windowsByEmployee: new Map([["emp-1", free]]),
      timeZone: "UTC",
      operationsWithEvents: new Set()
    });
    const job1 = selector
      .selectWorkCentersForOperations(
        [
          {
            id: "op-1",
            jobId: "job-1",
            processId: "proc",
            workCenterId: "wc2",
            startDate: null,
            dueDate: null,
            priority: 1,
            durationHours: 0,
            durationDays: 1,
            hasConflict: false,
            conflictReason: null,
            setupTime: 0,
            laborTime: 2,
            laborUnit: "Total Hours",
            machineTime: 0,
            operationQuantity: 1,
            quantityComplete: 0,
            status: "Ready"
          }
        ],
        { jobDueDate: null }
      )
      .get("op-1");
    expect([job1?.placedStart, job1?.placedEnd]).toEqual([
      "2026-01-05T03:00:00.000Z",
      "2026-01-05T05:00:00.000Z"
    ]);
  });

  it("queues two running ops on one machine in the order given", () => {
    const holds = startedOperationHolds({
      operations: [
        { jobId: "job-a", readableJobId: "JA", workCenterId: "wc1", hours: 1 },
        { jobId: "job-b", readableJobId: "JB", workCenterId: "wc1", hours: 2 }
      ],
      windowsByWorkCenter: windows,
      reservations: [
        {
          resourceKind: "WorkCenter",
          resourceId: "wc1",
          startAt: start,
          endAt: start + HOUR,
          jobId: "job-x",
          readableJobId: "JX",
          jobOperationBatchId: null
        }
      ],
      now: start,
      horizonEnd: start + 30 * 24 * HOUR,
      timeZone: "UTC"
    });
    expect(
      holds.map((h) => [h.jobId, h.startAt - start, h.endAt - start])
    ).toEqual([
      ["job-a", HOUR, 2 * HOUR],
      ["job-b", 2 * HOUR, 4 * HOUR]
    ]);
  });
});

describe("startedOperationsToHold", () => {
  const started = (overrides: Partial<BaseOperation>): BaseOperation => ({
    id: "op",
    jobId: "job",
    processId: "proc",
    workCenterId: "wc1",
    status: "In Progress",
    operationType: "Process",
    setupTime: 0,
    laborTime: 2,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0,
    ...overrides
  });
  const holdIds = (operations: BaseOperation[]) =>
    startedOperationsToHold({
      jobs: [{ jobId: "job", readableJobId: "J", status: "Ready", operations }],
      skipOperationIds: new Set(),
      operationsWithEvents: new Set()
    }).map((h) => h.operationId);

  it("holds a started op on the work center the selector keeps it on", () => {
    expect(holdIds([started({ id: "op-run" })])).toEqual(["op-run"]);
  });

  // The selector gives an op with no process no candidate, so it never runs
  // on its stored machine this run: holding that machine idles it.
  it("does not hold a started op that has no process", () => {
    expect(holdIds([started({ id: "op-noproc", processId: null })])).toEqual(
      []
    );
  });
});
