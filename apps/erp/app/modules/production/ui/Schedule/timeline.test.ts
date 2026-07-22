import { describe, expect, it } from "vitest";
import type {
  TimelineOperation,
  TimelineProductionEvent,
  TimelineReservation
} from "./timeline";
import { buildJobTimeline } from "./timeline";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const job = { id: "job-1", readableId: "J000008", status: "Ready" };

function op(overrides: Partial<TimelineOperation>): TimelineOperation {
  return {
    id: "op-1",
    description: "Weld Frame",
    order: 1,
    status: "Todo",
    startDate: null,
    dueDate: null,
    hasConflict: false,
    conflictReason: null,
    assigneeName: null,
    workCenterName: "Weld Cell 1",
    makeMethodId: "jmm-1",
    makeMethodParentMaterialId: null,
    makeMethodItemReadableId: "WELD-FRAME-01",
    ...overrides
  };
}

function reservation(
  overrides: Partial<TimelineReservation>
): TimelineReservation {
  return {
    id: "res-1",
    operationId: "op-1",
    resourceKind: "WorkCenter",
    resourceName: "Weld Cell 1",
    startAt: "2026-07-10T08:00:00.000Z",
    endAt: "2026-07-13T10:30:00.000Z",
    ...overrides
  };
}

describe("buildJobTimeline", () => {
  it("computes offsets and durations from reservations", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [reservation({})],
      productionEvents: []
    });

    const root = result.events.find((e) => e.id === "job-1")!;
    const operation = result.events.find((e) => e.id === "op-1")!;

    expect(result.windowStart?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(root.data.offset).toBe(0);
    expect(root.data.duration).toBe(result.totalDuration);
    expect(operation.data.offset).toBe(0);
    expect(operation.data.duration).toBe(3 * DAY + 2.5 * HOUR);
    expect(operation.data.isPartial).toBe(false);
    expect(operation.parentId).toBe("job-1"); // single make method → no assembly node
  });

  it("ignores date-only columns of reserved ops when sizing the window", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        // Has a reservation AND date-only columns: the date-only midnight
        // must not pad the window ahead of the real 08:00 start
        op({ startDate: "2026-07-10", dueDate: "2026-07-13" })
      ],
      reservations: [reservation({})],
      productionEvents: []
    });

    expect(result.windowStart?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    const operation = result.events.find((e) => e.id === "op-1")!;
    expect(operation.data.offset).toBe(0);
  });

  it("derives the wait ghost and schedule note from the reservation", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({
          // could have started at 06:00, actually started 08:00 → 2h queue
          earliestStartAt: "2026-07-10T06:00:00.000Z",
          scheduleNote:
            "Waited 2h for the work center — queued behind J000007 (1 op)"
        })
      ],
      productionEvents: []
    });

    // window extends left to cover the ghost
    expect(result.windowStart?.toISOString()).toBe("2026-07-10T06:00:00.000Z");

    const operation = result.events.find((e) => e.id === "op-1")!;
    expect(operation.data.wait).toEqual({
      offset: 0, // ghost starts at earliestStartAt
      duration: 2 * HOUR,
      reason: "Waited 2h for the work center — queued behind J000007 (1 op)"
    });
    expect(operation.data.offset).toBe(2 * HOUR); // solid bar starts after the wait

    const detail = result.detailsById["op-1"];
    expect(detail.waitMs).toBe(2 * HOUR);
    expect(detail.scheduleNote).toContain("queued behind J000007");
    // the reservation child row carries the note too
    expect(result.detailsById["res-1"].scheduleNote).toContain(
      "queued behind J000007"
    );
  });

  it("carries work content vs wall-clock span into details", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        // 6h08m of work stretched across a 22h08m span (off-shift pause)
        reservation({
          startAt: "2026-07-16T09:43:00.000Z",
          endAt: "2026-07-17T07:51:00.000Z",
          workHours: 6.133
        })
      ],
      productionEvents: []
    });

    const opDetail = result.detailsById["op-1"];
    expect(opDetail.workMs).toBeCloseTo(6.133 * 3_600_000, 0);
    expect(opDetail.durationMs).toBe(
      Date.parse("2026-07-17T07:51:00.000Z") -
        Date.parse("2026-07-16T09:43:00.000Z")
    );
    expect(result.detailsById["res-1"].workMs).toBeCloseTo(
      6.133 * 3_600_000,
      0
    );
  });

  it("no ghost when the op started as early as it could", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({
          earliestStartAt: "2026-07-10T08:00:00.000Z", // === startAt
          scheduleNote: null
        })
      ],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    expect(operation.data.wait).toBeUndefined();
    expect(result.detailsById["op-1"].waitMs).toBe(0);
  });

  it("unplaced conflicted ops (stale past dates) do not stretch the window", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({}),
        // No reservation, backward-pass dates weeks in the past — the exact
        // shape of a "No qualified operator" conflict
        op({
          id: "op-unplaced",
          description: "Solder",
          order: 2,
          startDate: "2026-06-25",
          dueDate: "2026-06-26",
          hasConflict: true,
          conflictReason: "No qualified operator for Solder"
        })
      ],
      reservations: [reservation({})],
      productionEvents: []
    });

    // Window sized by the precise reservation only — not late June
    expect(result.windowStart?.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(result.totalDuration).toBe(3 * DAY + 2.5 * HOUR);

    // The unplaced op renders as a sliver pinned to the left edge…
    const unplaced = result.events.find((e) => e.id === "op-unplaced")!;
    expect(unplaced.data.offset).toBe(0);
    expect(unplaced.data.duration).toBe(0);
    // …but the side panel keeps its real (meaningless-but-honest) dates
    expect(result.detailsById["op-unplaced"].start).toBe(
      "2026-06-25T00:00:00.000Z"
    );
  });

  it("far-future date-only ops clamp to the right edge instead of stretching", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({}),
        op({
          id: "op-future",
          order: 2,
          startDate: "2026-09-01",
          dueDate: "2026-09-02"
        })
      ],
      reservations: [reservation({})],
      productionEvents: []
    });

    expect(result.totalDuration).toBe(3 * DAY + 2.5 * HOUR);
    const future = result.events.find((e) => e.id === "op-future")!;
    expect(future.data.offset).toBe(result.totalDuration);
    expect(future.data.duration).toBe(0);
  });

  it("assembly grow keeps the right edge when a later op starts AND ends earlier", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        // Root-method op: LOWER routing order, later in time
        op({
          id: "op-root",
          order: 10,
          makeMethodId: "jmm-root",
          makeMethodItemReadableId: "ROOT"
        }),
        // Subassembly op: higher order, but runs days earlier
        op({
          id: "op-sub",
          order: 20,
          makeMethodId: "jmm-sub",
          makeMethodParentMakeMethodId: "jmm-root",
          makeMethodItemReadableId: "SUB"
        })
      ],
      reservations: [
        reservation({
          id: "res-root",
          operationId: "op-root",
          startAt: "2026-07-19T08:00:00.000Z",
          endAt: "2026-07-19T16:00:00.000Z"
        }),
        reservation({
          id: "res-sub",
          operationId: "op-sub",
          startAt: "2026-07-15T08:00:00.000Z",
          endAt: "2026-07-15T12:00:00.000Z"
        })
      ],
      productionEvents: []
    });

    // Root assembly must cover BOTH its own op (ends 19/07 16:00) and the
    // sub op (starts 15/07 08:00). The old grow logic re-anchored the old
    // duration at the lowered offset, collapsing the right edge to day 0.
    const rootAssembly = result.events.find((e) => e.id === "jmm-root")!;
    expect(rootAssembly.data.offset).toBe(0);
    expect(rootAssembly.data.duration).toBe(4 * DAY + 8 * HOUR);
  });

  it("falls back to date-only spans with inclusive dueDate, marked approximate", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({ startDate: "2026-07-10", dueDate: "2026-07-13" })],
      reservations: [],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    // estimated (no reservation) — static striped bar, NOT the live-work animation
    expect(operation.data.isEstimated).toBe(true);
    expect(operation.data.isPartial).toBe(false);
    // inclusive dueDate → ends at start of 07-14
    expect(operation.data.duration).toBe(4 * DAY);
  });

  it("nests subassemblies under the parent make method, parent listed first", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        // Subassembly op starts FIRST chronologically
        op({
          id: "op-sub",
          makeMethodId: "jmm-sub",
          makeMethodItemReadableId: "ARM-01",
          makeMethodParentMakeMethodId: "jmm-root",
          startDate: "2026-07-10",
          dueDate: "2026-07-11"
        }),
        // Root (parent item) op starts LAST — final assembly
        op({
          id: "op-root",
          makeMethodId: "jmm-root",
          makeMethodItemReadableId: "00000000OLD",
          makeMethodParentMakeMethodId: null,
          startDate: "2026-07-12",
          dueDate: "2026-07-13"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const rootMethod = result.events.find((e) => e.id === "jmm-root")!;
    const subMethod = result.events.find((e) => e.id === "jmm-sub")!;

    // Hierarchy: job → parent item → subassembly (not flat/chronological)
    expect(rootMethod.parentId).toBe("job-1");
    expect(subMethod.parentId).toBe("jmm-root");
    expect(rootMethod.level).toBe(1);
    expect(subMethod.level).toBe(2);

    // Row order: parent method appears before the subassembly it consumes
    const order = result.events.map((e) => e.id);
    expect(order.indexOf("jmm-root")).toBeLessThan(order.indexOf("jmm-sub"));

    // Parent's bar spans its own ops AND the nested subassembly's ops
    expect(rootMethod.data.offset).toBe(0);
    expect(rootMethod.data.duration).toBe(result.totalDuration);

    // Assembly rows are clickable: they have detail entries for the side panel
    expect(result.detailsById["jmm-root"]).toMatchObject({
      kind: "assembly",
      title: "00000000OLD",
      durationMs: result.totalDuration
    });
    expect(result.detailsById["jmm-sub"]?.kind).toBe("assembly");
  });

  it("orders sibling subassemblies by BOM line order, not by who starts first", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({
          id: "op-root",
          makeMethodId: "jmm-root",
          makeMethodItemReadableId: "00000000OLD",
          startDate: "2026-07-14",
          dueDate: "2026-07-15"
        }),
        // BOM line 2 starts FIRST chronologically
        op({
          id: "op-b",
          makeMethodId: "jmm-b",
          makeMethodItemReadableId: "000000019",
          makeMethodParentMakeMethodId: "jmm-root",
          makeMethodParentMaterialOrder: 2,
          startDate: "2026-07-10",
          dueDate: "2026-07-11"
        }),
        // BOM line 1 starts LAST — must still be listed first
        op({
          id: "op-a",
          makeMethodId: "jmm-a",
          makeMethodItemReadableId: "000000012",
          makeMethodParentMakeMethodId: "jmm-root",
          makeMethodParentMaterialOrder: 1,
          startDate: "2026-07-12",
          dueDate: "2026-07-13"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const order = result.events.map((e) => e.id);
    expect(order.indexOf("jmm-a")).toBeLessThan(order.indexOf("jmm-b"));
  });

  it("orders operations within a group by routing order, not placement time", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        // Routing: CNC Route (order 1) THEN Anodize (order 2) — but Anodize's
        // date-only midnight span starts earlier than CNC's reservation
        op({
          id: "op-anodize",
          description: "Anodize",
          order: 2,
          startDate: "2026-07-10",
          dueDate: "2026-07-10"
        }),
        op({ id: "op-cnc", description: "CNC Route", order: 1 })
      ],
      reservations: [
        reservation({
          id: "res-cnc",
          operationId: "op-cnc",
          startAt: "2026-07-10T08:00:00.000Z",
          endAt: "2026-07-10T12:00:00.000Z"
        })
      ],
      productionEvents: []
    });

    const order = result.events.map((e) => e.id);
    expect(order.indexOf("op-cnc")).toBeLessThan(order.indexOf("op-anodize"));
  });

  it("marks conflicted operations as errors and bubbles to job + assembly", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({
          hasConflict: true,
          conflictReason: "No qualified operator for Welding",
          startDate: "2026-07-10"
        }),
        op({
          id: "op-2",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "SUB-01",
          startDate: "2026-07-11"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    const assembly = result.events.find((e) => e.id === "jmm-1")!;
    const root = result.events.find((e) => e.id === "job-1")!;

    expect(operation.data.isError).toBe(true);
    // Stays TRACE so the conflicted op still renders as a duration bar,
    // not a point-event dot; isError carries the conflict signal
    expect(operation.data.level).toBe("TRACE");
    expect(assembly.data.isError).toBe(true);
    expect(root.data.isError).toBe(true);
    // The assembly's panel entry explains its bubbled-up red state
    expect(result.detailsById["jmm-1"]?.conflictReason).toBe(
      "1 operation in this assembly has a scheduling conflict"
    );
    expect(result.detailsById["op-1"].conflictReason).toBe(
      "No qualified operator for Welding"
    );
  });

  it("groups operations under assembly nodes when there are multiple make methods", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({ startDate: "2026-07-10", dueDate: "2026-07-10" }),
        op({
          id: "op-2",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "SUB-01",
          startDate: "2026-07-11",
          dueDate: "2026-07-12"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const assembly1 = result.events.find((e) => e.id === "jmm-1")!;
    const assembly2 = result.events.find((e) => e.id === "jmm-2")!;
    const op2 = result.events.find((e) => e.id === "op-2")!;

    expect(assembly1.parentId).toBe("job-1");
    expect(op2.parentId).toBe("jmm-2");
    // assembly span covers its operation
    expect(assembly2.data.offset).toBe(1 * DAY);
    expect(assembly2.data.duration).toBe(2 * DAY);
    expect(assembly1.data.style.icon).toBe("assembly");
  });

  it("keeps each subtree contiguous even when operations interleave in time", () => {
    // The TreeView renders events as a pre-flattened depth-first list; an
    // operation row rendered under another assembly's header reads as
    // wrongly indented.
    const result = buildJobTimeline({
      job,
      operations: [
        // assembly A's ops start first and LAST; assembly B's op starts in
        // between, so naive start-time ordering would interleave the subtrees
        op({ id: "a-1", startDate: "2026-07-10", dueDate: "2026-07-10" }),
        op({
          id: "b-1",
          description: "Press-Fit",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "SUB-01",
          startDate: "2026-07-11",
          dueDate: "2026-07-11"
        }),
        op({
          id: "a-2",
          startDate: "2026-07-12",
          dueDate: "2026-07-12"
        })
      ],
      reservations: [],
      productionEvents: []
    });

    const ids = result.events.map((e) => e.id);
    const byId = new Map(result.events.map((e) => [e.id, e]));

    // every node renders after its parent…
    for (const e of result.events) {
      if (e.parentId) {
        expect(ids.indexOf(e.parentId)).toBeLessThan(ids.indexOf(e.id));
      }
    }
    // …and nothing from another subtree is drawn between a parent and its
    // children: rows between an assembly header and the next same-level node
    // must all descend from that assembly
    const assemblyIndex = ids.indexOf("jmm-1");
    const nextAssemblyIndex = ids.indexOf("jmm-2");
    for (const id of ids.slice(assemblyIndex + 1, nextAssemblyIndex)) {
      let node = byId.get(id);
      while (node?.parentId && node.parentId !== "jmm-1") {
        node = byId.get(node.parentId);
      }
      expect(node?.parentId).toBe("jmm-1");
    }
    expect(ids.indexOf("b-1")).toBeGreaterThan(nextAssemblyIndex);
  });

  it("adds machine + operator-pool reservation child rows", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({}),
        reservation({
          id: "res-2",
          resourceKind: "OperatorPool",
          resourceName: "Welding"
        })
      ],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    const pool = result.events.find((e) => e.id === "res-2")!;

    expect(operation.children).toEqual(["res-1", "res-2"]);
    expect(pool.data.message).toBe("Welding");
    expect(result.detailsById["res-2"].resourceKind).toBe("OperatorPool");
  });

  it("renders named-operator (Employee) reservation rows like pool rows", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({}),
        reservation({
          id: "res-emp",
          resourceKind: "Employee",
          resourceName: "Sam Smith"
        })
      ],
      productionEvents: []
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    const person = result.events.find((e) => e.id === "res-emp")!;

    expect(operation.children).toEqual(["res-1", "res-emp"]);
    expect(person.data.message).toBe("Sam Smith");
    expect(person.data.style?.icon).toBe("wait");
    expect(result.detailsById["res-emp"].resourceKind).toBe("Employee");
  });

  it("lists booked operators on the operation detail, in booking order, deduped", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [
        reservation({}),
        // relay: second person's stretch listed first in input — order must
        // follow startAt, not input order
        reservation({
          id: "res-emp-2",
          resourceKind: "Employee",
          resourceName: "Night Nick",
          startAt: "2026-07-10T16:00:00.000Z",
          endAt: "2026-07-10T21:00:00.000Z"
        }),
        reservation({
          id: "res-emp-1",
          resourceKind: "Employee",
          resourceName: "Day Dana",
          startAt: "2026-07-10T08:00:00.000Z",
          endAt: "2026-07-10T16:00:00.000Z"
        }),
        // pause + resume next day: same person twice → deduped
        reservation({
          id: "res-emp-3",
          resourceKind: "Employee",
          resourceName: "Night Nick",
          startAt: "2026-07-11T16:00:00.000Z",
          endAt: "2026-07-11T18:00:00.000Z"
        })
      ],
      productionEvents: []
    });

    expect(result.detailsById["op-1"].employeeName).toBe(
      "Day Dana, Night Nick"
    );
  });

  it("leaves the operation detail employeeName null when nobody is booked", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [reservation({})],
      productionEvents: []
    });

    expect(result.detailsById["op-1"].employeeName).toBeNull();
  });

  it("renders open production events up to now as partial, with person accessory", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const events: TimelineProductionEvent[] = [
      {
        id: "pe-1",
        operationId: "op-1",
        type: "Labor",
        employeeName: "Anne Barbin",
        startTime: "2026-07-10T09:00:00.000Z",
        endTime: null
      }
    ];

    const result = buildJobTimeline({
      job,
      operations: [op({})],
      reservations: [reservation({})],
      productionEvents: events,
      now
    });

    const timecard = result.events.find((e) => e.id === "pe-1")!;
    expect(timecard.data.isPartial).toBe(true);
    expect(timecard.data.duration).toBe(3 * HOUR);
    expect(timecard.data.style.accessory?.items[0]?.text).toBe("Anne Barbin");
    expect(result.detailsById["pe-1"].end).toBeNull();
  });

  it("returns an empty-window timeline when nothing is scheduled", () => {
    const result = buildJobTimeline({
      job,
      operations: [op({ workCenterName: null })],
      reservations: [],
      productionEvents: []
    });

    expect(result.windowStart).toBeUndefined();
    expect(result.totalDuration).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.isRoot).toBe(true);
  });
});

describe("buildJobTimeline groupBy workCenter", () => {
  const wcOps = [
    op({
      id: "op-1",
      description: "CNC Rout Arms",
      order: 1,
      workCenterId: "wc-cnc",
      workCenterName: "CNC Router"
    }),
    op({
      id: "op-2",
      description: "CNC Rout Plate",
      order: 3,
      workCenterId: "wc-cnc",
      workCenterName: "CNC Router"
    }),
    op({
      id: "op-3",
      description: "Battery Test",
      order: 2,
      workCenterId: "wc-rig",
      workCenterName: "Battery Test Rig"
    })
  ];
  const wcReservations = [
    reservation({
      id: "res-1",
      operationId: "op-1",
      startAt: "2026-07-10T08:00:00.000Z",
      endAt: "2026-07-10T12:00:00.000Z"
    }),
    reservation({
      id: "res-2",
      operationId: "op-2",
      startAt: "2026-07-11T08:00:00.000Z",
      endAt: "2026-07-11T12:00:00.000Z"
    }),
    reservation({
      id: "res-3",
      operationId: "op-3",
      startAt: "2026-07-10T10:00:00.000Z",
      endAt: "2026-07-10T16:00:00.000Z"
    })
  ];

  it("groups operations under their work centers, ordered by first activity", () => {
    const result = buildJobTimeline({
      job,
      operations: wcOps,
      reservations: wcReservations,
      productionEvents: [],
      groupBy: "workCenter"
    });

    const root = result.events.find((e) => e.id === "job-1")!;
    // CNC starts 08:00, Rig starts 10:00 → CNC group first
    expect(root.children).toEqual(["wc:wc-cnc", "wc:wc-rig"]);

    const cnc = result.events.find((e) => e.id === "wc:wc-cnc")!;
    expect(cnc.data.message).toBe("CNC Router");
    expect(cnc.children).toEqual(["op-1", "op-2"]);
    expect(result.events.find((e) => e.id === "op-3")!.parentId).toBe(
      "wc:wc-rig"
    );

    // No assembly nodes in this grouping
    expect(result.events.find((e) => e.id === "jmm-1")).toBeUndefined();
  });

  it("grows the work-center group to cover its operations", () => {
    const result = buildJobTimeline({
      job,
      operations: wcOps,
      reservations: wcReservations,
      productionEvents: [],
      groupBy: "workCenter"
    });

    // CNC covers op-1 (07-10 08:00) through op-2 (07-11 12:00)
    const cnc = result.events.find((e) => e.id === "wc:wc-cnc")!;
    expect(cnc.data.offset).toBe(0);
    expect(cnc.data.duration).toBe(DAY + 4 * HOUR);

    const detail = result.detailsById["wc:wc-cnc"];
    expect(detail.kind).toBe("resource");
    expect(detail.title).toBe("CNC Router");
    expect(detail.start).toBe("2026-07-10T08:00:00.000Z");
    expect(detail.end).toBe("2026-07-11T12:00:00.000Z");
  });

  it("bubbles conflicts to the work-center row with a rollup message", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        wcOps[0],
        { ...wcOps[1], hasConflict: true, conflictReason: "Queued" }
      ],
      reservations: [wcReservations[0], wcReservations[1]],
      productionEvents: [],
      groupBy: "workCenter"
    });

    const cnc = result.events.find((e) => e.id === "wc:wc-cnc")!;
    expect(cnc.data.isError).toBe(true);
    expect(result.detailsById["wc:wc-cnc"].conflictReason).toBe(
      "1 operation at this work center has a scheduling conflict"
    );
  });

  it("collects operations without a work center under Unassigned", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        wcOps[0],
        op({
          id: "op-out",
          description: "Anodize (Outside)",
          workCenterId: null,
          workCenterName: null
        })
      ],
      reservations: [wcReservations[0]],
      productionEvents: [],
      groupBy: "workCenter"
    });

    const unassigned = result.events.find((e) => e.id === "wc:unassigned")!;
    expect(unassigned.data.message).toBe("Unassigned");
    expect(result.events.find((e) => e.id === "op-out")!.parentId).toBe(
      "wc:unassigned"
    );
  });

  it("keeps reservations and timecards as children of the operation", () => {
    const result = buildJobTimeline({
      job,
      operations: [wcOps[0]],
      reservations: [wcReservations[0]],
      productionEvents: [
        {
          id: "pe-1",
          operationId: "op-1",
          type: "Labor",
          employeeName: "Ana Weaver",
          startTime: "2026-07-10T08:30:00.000Z",
          endTime: "2026-07-10T09:30:00.000Z"
        }
      ],
      groupBy: "workCenter"
    });

    const operation = result.events.find((e) => e.id === "op-1")!;
    expect(operation.children).toEqual(["res-1", "pe-1"]);
    // Depth-first order: group → op → children
    const ids = result.events.map((e) => e.id);
    expect(ids).toEqual(["job-1", "wc:wc-cnc", "op-1", "res-1", "pe-1"]);
  });
});

describe("buildJobTimeline workCenter row labels", () => {
  it("disambiguates same-named ops from different subassemblies", () => {
    const result = buildJobTimeline({
      job,
      operations: [
        op({
          id: "op-d1",
          description: "Drill",
          workCenterId: "wc-drill",
          workCenterName: "Drill Press",
          makeMethodId: "jmm-1",
          makeMethodItemReadableId: "ARM-01"
        }),
        op({
          id: "op-d2",
          description: "Drill",
          workCenterId: "wc-drill",
          workCenterName: "Drill Press",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "PLATE-01"
        })
      ],
      reservations: [
        reservation({
          id: "res-d1",
          operationId: "op-d1",
          startAt: "2026-07-10T08:00:00.000Z",
          endAt: "2026-07-10T09:00:00.000Z"
        }),
        reservation({
          id: "res-d2",
          operationId: "op-d2",
          startAt: "2026-07-10T09:00:00.000Z",
          endAt: "2026-07-10T10:00:00.000Z"
        })
      ],
      productionEvents: [],
      groupBy: "workCenter"
    });

    const d1 = result.events.find((e) => e.id === "op-d1")!;
    const d2 = result.events.find((e) => e.id === "op-d2")!;
    expect(d1.data.message).toBe("Drill — ARM-01");
    expect(d2.data.message).toBe("Drill — PLATE-01");
    expect(result.detailsById["op-d1"].title).toBe("Drill — ARM-01");
  });

  it("keeps plain labels for single-method jobs and in assembly view", () => {
    const single = buildJobTimeline({
      job,
      operations: [
        op({ id: "op-d1", description: "Drill", workCenterId: "wc-drill" })
      ],
      reservations: [reservation({ id: "res-d1", operationId: "op-d1" })],
      productionEvents: [],
      groupBy: "workCenter"
    });
    expect(single.events.find((e) => e.id === "op-d1")!.data.message).toBe(
      "Drill"
    );

    const assemblyView = buildJobTimeline({
      job,
      operations: [
        op({
          id: "op-d1",
          description: "Drill",
          makeMethodId: "jmm-1",
          makeMethodItemReadableId: "ARM-01"
        }),
        op({
          id: "op-d2",
          description: "Drill",
          makeMethodId: "jmm-2",
          makeMethodItemReadableId: "PLATE-01"
        })
      ],
      reservations: [reservation({ id: "res-d1", operationId: "op-d1" })],
      productionEvents: [],
      groupBy: "assembly"
    });
    expect(
      assemblyView.events.find((e) => e.id === "op-d1")!.data.message
    ).toBe("Drill");
  });
});
