import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import type { BatchMemberInput, BatchToPlace } from "./batch-scheduler.ts";
import { planBatchPlacements } from "./batch-scheduler.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type { JobOperationDependency, ScheduledOperation } from "./types.ts";
import {
  type FiniteSchedulingContext,
  WorkCenterSelector
} from "./work-center-selector.ts";

const utc = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();

const NOW = utc("2026-01-05T00:00:00.000Z"); // Monday
const HORIZON = utc("2027-01-05T00:00:00.000Z");
const MIN = 60_000;

function makeMember(
  overrides: Partial<BatchMemberInput> & { id: string; jobId: string }
): BatchMemberInput {
  return {
    setupSeconds: 600, // 10 min
    laborSeconds: 0,
    machineSeconds: 0,
    operationQuantity: 1,
    quantityComplete: 0,
    isOpen: true,
    predecessorEndMs: null,
    ...overrides
  };
}

// The spec's worked example: member effective runs 40/70/50 min, setups 10 each.
function workedExampleMembers(): BatchMemberInput[] {
  return [
    makeMember({ id: "op-a", jobId: "job-a", laborSeconds: 40 * 60 }),
    makeMember({ id: "op-b", jobId: "job-b", laborSeconds: 70 * 60 }),
    makeMember({ id: "op-c", jobId: "job-c", laborSeconds: 50 * 60 })
  ];
}

function makeBatch(
  overrides: Partial<BatchToPlace> & { id: string }
): BatchToPlace {
  return {
    readableId: "BAT000001",
    workCenterId: "wc1",
    candidateWorkCenterIds: [],
    batchType: "Sequential",
    hasAnyEvent: false,
    members: workedExampleMembers(),
    ...overrides
  };
}

function openWindows() {
  return new Map([["wc1", [{ start: NOW, end: HORIZON }]]]);
}

function plan(
  batches: BatchToPlace[],
  overrides: Partial<Parameters<typeof planBatchPlacements>[0]> = {}
) {
  return planBatchPlacements({
    batches,
    orderedJobIds: ["job-a", "job-b", "job-c"],
    now: NOW,
    horizonEnd: HORIZON,
    timeZone: "UTC",
    windowsByWorkCenter: openWindows(),
    reservationsByWorkCenter: new Map(),
    ...overrides
  });
}

it("a Sequential batch reserves setup(max) + Σ run — the spec's 170 minutes", () => {
  const { placements, reservations } = plan([makeBatch({ id: "b1" })]);

  assertEquals(reservations.length, 1);
  const r = reservations[0]!;
  assertEquals(r.startAt, NOW);
  assertEquals(r.endAt - r.startAt, 170 * MIN); // 10 + (40+70+50)
  assertEquals(r.batchId, "b1");
  assertEquals(r.workCenterId, "wc1");
  assertEquals(r.isPlaceholder, false);
  // deterministic anchor = min member op id
  assertEquals(r.anchorOperationId, "op-a");
  assertEquals(r.anchorJobId, "job-a");

  // every open member is pinned to the batch window
  for (const id of ["op-a", "op-b", "op-c"]) {
    const p = placements.get(id);
    assert(p, `${id} has a placement`);
    assertEquals(p.startAt, r.startAt);
    assertEquals(p.endAt, r.endAt);
    assertEquals(p.conflict, null);
  }
});

it("a Simultaneous batch reserves setup(max) + max run — the spec's 80 minutes", () => {
  const { reservations } = plan([
    makeBatch({ id: "b1", batchType: "Simultaneous" })
  ]);
  assertEquals(reservations.length, 1);
  assertEquals(reservations[0]!.endAt - reservations[0]!.startAt, 80 * MIN); // 10 + max(40,70,50)
});

it("one reservation regardless of member count; Done members are not pinned", () => {
  const { placements, reservations } = plan([
    makeBatch({
      id: "b1",
      members: [
        ...workedExampleMembers(),
        makeMember({
          id: "op-done",
          jobId: "job-a",
          laborSeconds: 99 * 60,
          isOpen: false
        })
      ]
    })
  ]);
  assertEquals(reservations.length, 1);
  // the Done member contributes no duration and gets no pin
  assertEquals(reservations[0]!.endAt - reservations[0]!.startAt, 170 * MIN);
  assertEquals(placements.has("op-done"), false);
  assertEquals(placements.size, 3);
});

it("hasAnyEvent drops the shared setup (setup-done rule)", () => {
  const { reservations } = plan([makeBatch({ id: "b1", hasAnyEvent: true })]);
  assertEquals(reservations[0]!.endAt - reservations[0]!.startAt, 160 * MIN); // Σ runs only
});

it("two batches on one work center place sequentially in job order", () => {
  const early = makeBatch({ id: "b-early" }); // members job-a/b/c → rank 0
  const late = makeBatch({
    id: "b-late",
    readableId: "BAT000002",
    members: [makeMember({ id: "op-z", jobId: "job-z", laborSeconds: 30 * 60 })]
  }); // job-z not in the order → rank Infinity → placed second
  const { reservations } = plan([late, early], {
    orderedJobIds: ["job-a", "job-b", "job-c"]
  });

  assertEquals(reservations.length, 2);
  const first = reservations.find((r) => r.batchId === "b-early")!;
  const second = reservations.find((r) => r.batchId === "b-late")!;
  assertEquals(first.startAt, NOW);
  // the second batch waits for the first (capacity 1, in-memory accumulation)
  assert(
    second.startAt >= first.endAt,
    "later batch starts after the earlier one ends"
  );
});

it("no work center AND no candidates → skipped (members place individually)", () => {
  const { placements, reservations } = plan([
    makeBatch({ id: "b1", workCenterId: null, candidateWorkCenterIds: [] })
  ]);
  assertEquals(reservations.length, 0);
  assertEquals(placements.size, 0);
});

it("a batch without a work center auto-selects the emptier candidate (load balancing)", () => {
  // wc-busy holds a 3h reservation from NOW; wc-free is open. Earliest finish
  // picks wc-free, and the selection is reported for persistence.
  const busyStart = NOW;
  const busyEnd = NOW + 3 * 3_600_000;
  const { placements, reservations, selectedWorkCenters } = plan(
    [
      makeBatch({
        id: "b1",
        workCenterId: null,
        candidateWorkCenterIds: ["wc-busy", "wc-free"]
      })
    ],
    {
      windowsByWorkCenter: new Map([
        ["wc-busy", [{ start: NOW, end: HORIZON }]],
        ["wc-free", [{ start: NOW, end: HORIZON }]]
      ]),
      reservationsByWorkCenter: new Map([
        ["wc-busy", [{ startAt: busyStart, endAt: busyEnd }]]
      ])
    }
  );
  assertEquals(reservations.length, 1);
  assertEquals(reservations[0]!.workCenterId, "wc-free");
  assertEquals(reservations[0]!.startAt, NOW);
  assertEquals(selectedWorkCenters.get("b1"), "wc-free");
  assertEquals(placements.get("op-a")!.workCenterId, "wc-free");
});

it("auto-selection tie-breaks deterministically by work-center id", () => {
  const { reservations, selectedWorkCenters } = plan(
    [
      makeBatch({
        id: "b1",
        workCenterId: null,
        candidateWorkCenterIds: ["wc-b", "wc-a"]
      })
    ],
    {
      windowsByWorkCenter: new Map([
        ["wc-a", [{ start: NOW, end: HORIZON }]],
        ["wc-b", [{ start: NOW, end: HORIZON }]]
      ])
    }
  );
  assertEquals(reservations[0]!.workCenterId, "wc-a");
  assertEquals(selectedWorkCenters.get("b1"), "wc-a");
});

it("an assigned work center is never auto-reselected", () => {
  const { selectedWorkCenters } = plan([makeBatch({ id: "b1" })]);
  assertEquals(selectedWorkCenters.size, 0);
});

it("an all-done batch is skipped entirely", () => {
  const { placements, reservations } = plan([
    makeBatch({
      id: "b1",
      members: workedExampleMembers().map((m) => ({ ...m, isOpen: false }))
    })
  ]);
  assertEquals(reservations.length, 0);
  assertEquals(placements.size, 0);
});

it("the anchor honors persisted predecessor forecasts", () => {
  const predEnd = NOW + 5 * 3_600_000; // predecessor projected +5h
  const { reservations } = plan([
    makeBatch({
      id: "b1",
      members: [
        makeMember({
          id: "op-a",
          jobId: "job-a",
          laborSeconds: 40 * 60,
          predecessorEndMs: predEnd
        }),
        makeMember({ id: "op-b", jobId: "job-b", laborSeconds: 70 * 60 })
      ]
    })
  ]);
  assertEquals(reservations[0]!.startAt, predEnd);
});

it("no feasible slot degrades to a placeholder window that never blocks", () => {
  const blocked = makeBatch({ id: "b-blocked" });
  const following = makeBatch({
    id: "b-follows",
    readableId: "BAT000002",
    members: [makeMember({ id: "op-z", jobId: "job-a", laborSeconds: 30 * 60 })]
  });
  // wc1 has NO windows at all → allocation conflicts for both, and the
  // placeholder from the first must not stack the second later.
  const { placements, reservations } = plan([blocked, following], {
    windowsByWorkCenter: new Map()
  });

  assertEquals(reservations.length, 2);
  for (const r of reservations) {
    assertEquals(r.isPlaceholder, true);
    assertEquals(r.startAt, NOW); // calendar window from the anchor
  }
  const p = placements.get("op-a")!;
  assert(p.conflict, "members carry the allocation conflict");
});

// --- selector integration: members take the batch window --------------------

function makeOp(
  overrides: Partial<ScheduledOperation> & { id: string }
): ScheduledOperation {
  return {
    jobId: "job-1",
    processId: "proc-1",
    startDate: null,
    dueDate: null,
    priority: 1,
    durationHours: 2,
    durationDays: 1,
    hasConflict: false,
    conflictReason: null,
    workCenterId: null,
    ...overrides
  } as ScheduledOperation;
}

function makeContext(
  overrides: Partial<FiniteSchedulingContext> = {}
): FiniteSchedulingContext {
  return {
    capacityByWorkCenter: new Map([
      [
        "wc1",
        {
          workCenter: { id: "wc1" },
          windows: [{ start: NOW, end: utc("2026-02-05T00:00:00.000Z") }],
          reservations: []
        }
      ]
    ]),
    requirementByProcess: new Map(),
    employeesByAbility: new Map(),
    reservationsByEmployee: new Map(),
    dependencies: [],
    now: NOW,
    horizonDays: 365,
    windowsEnd: utc("2026-02-05T00:00:00.000Z"),
    peopleByWorkCenter: new Map(),
    assignmentsByEmployee: new Map(),
    requiresStaffing: false,
    peopleBudgets: new Map(),
    windowsByEmployee: new Map(),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>(),
    ...overrides
  } as FiniteSchedulingContext;
}

const batchWindowPlacement = (startAt: number, endAt: number) => ({
  batchId: "b1",
  batchReadableId: "BAT000001",
  workCenterId: "wc1",
  startAt,
  endAt,
  conflict: null
});

it("a batched member takes the batch window verbatim, books no reservation, and chains its successor after the batch end", async () => {
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  const deps = [
    { operationId: "op-succ", dependsOnId: "op-batch" }
  ] as JobOperationDependency[];
  selector.setFiniteContext(makeContext({ dependencies: deps }));

  const batchStart = NOW + 2 * 3_600_000;
  const batchEnd = NOW + 5 * 3_600_000;
  const member = makeOp({
    id: "op-batch",
    workCenterId: "wc1",
    setupTime: 0,
    laborTime: 1,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const successor = makeOp({
    id: "op-succ",
    workCenterId: "wc1",
    setupTime: 0,
    laborTime: 1,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations(
    [member, successor],
    {
      jobDueDate: null,
      batchPlacements: new Map([
        ["op-batch", batchWindowPlacement(batchStart, batchEnd)]
      ])
    }
  );

  const memberSelection = selections.get("op-batch")!;
  assertEquals(memberSelection.placedStart, "2026-01-05T02:00:00.000Z");
  assertEquals(memberSelection.placedEnd, "2026-01-05T05:00:00.000Z");
  assertEquals(memberSelection.workCenterId, "wc1");
  assertEquals(memberSelection.conflict ?? null, null);

  // NO per-member reservation — the pre-pass owns the coalesced batch row.
  assertEquals(
    selector
      .getPlannedReservations()
      .filter((r) => r.operationId === "op-batch").length,
    0
  );

  // The successor waits for the batch end.
  const succSelection = selections.get("op-succ")!;
  assert(succSelection.placedStart, "successor placed");
  assert(
    utc(succSelection.placedStart) >= batchEnd,
    "successor starts at/after the batch end"
  );
});

it("a predecessor freshly placed past the batch start flags a conflict on the member", async () => {
  const selector = new WorkCenterSelector(
    {} as unknown as MasterDataProvider,
    "loc1"
  );
  const deps = [
    { operationId: "op-batch", dependsOnId: "op-pred" }
  ] as JobOperationDependency[];
  selector.setFiniteContext(makeContext({ dependencies: deps }));

  // Predecessor runs 4h from NOW; the batch window starts at NOW+1h — the
  // pre-pass anchored on a stale forecast, so the member must be flagged.
  const predecessor = makeOp({
    id: "op-pred",
    description: "Saw blanks",
    workCenterId: "wc1",
    setupTime: 0,
    laborTime: 4,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });
  const member = makeOp({
    id: "op-batch",
    workCenterId: "wc1",
    setupTime: 0,
    laborTime: 1,
    laborUnit: "Total Hours",
    machineTime: 0,
    operationQuantity: 1,
    quantityComplete: 0
  });

  const selections = await selector.selectWorkCentersForOperations(
    [predecessor, member],
    {
      jobDueDate: null,
      batchPlacements: new Map([
        [
          "op-batch",
          batchWindowPlacement(NOW + 1 * 3_600_000, NOW + 2 * 3_600_000)
        ]
      ])
    }
  );

  const memberSelection = selections.get("op-batch")!;
  assert(memberSelection.conflict, "member carries the predecessor conflict");
  assert(
    memberSelection.conflict!.includes("BAT000001"),
    "conflict names the batch"
  );
  assert(
    memberSelection.conflict!.includes("Saw blanks"),
    "conflict names the predecessor"
  );
  // The window itself is still the batch's — pinned, not re-placed.
  assertEquals(memberSelection.placedStart, "2026-01-05T01:00:00.000Z");
});
