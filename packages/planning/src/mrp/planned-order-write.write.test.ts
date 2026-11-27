// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  recordingDatabase as database,
  kindOf,
  type RecordingDriver,
  type Row
} from "./__fixtures__/recording-driver";
import {
  type CurrentPlannedOrder,
  diffPlannedOrders,
  type PlannedOrderSnapshot,
  PlannedOrdersChangedError,
  plannedOrdersChangedSince,
  retryOnPlannedOrderChange,
  writePlannedOrderDiff
} from "./planned-order-write";
import {
  type GeneratedPlannedOrder,
  plannedOrderNaturalKey
} from "./planned-orders";

const TRACE = {
  policyName: "Demand-Based Reorder",
  triggerValues: { projectedStock: -10 },
  quantity: 10,
  scrapQuantity: 0,
  explosionQuantity: 10
};

function generated(
  overrides: Partial<GeneratedPlannedOrder> = {}
): GeneratedPlannedOrder {
  const order = {
    itemId: "item-1",
    locationId: "loc-1",
    planningSegmentId: "",
    orderType: "Make" as const,
    quantity: 10,
    scrapQuantity: 0,
    dueDate: "2026-11-20",
    releaseDate: "2026-11-13",
    periodId: "p2",
    splitIndex: 0,
    lowLevelCode: 0,
    supplierId: null,
    quantityTrace: TRACE,
    ...overrides
  };
  return { ...order, naturalKey: plannedOrderNaturalKey(order) };
}

/** A stored row with the values `generated()` would write. */
function stored(id: string, overrides: Partial<Row> = {}): Row {
  const { naturalKey: _key, ...order } = generated();
  return { ...order, id, status: "Planned", ...overrides };
}

function kindsOf(driver: RecordingDriver) {
  return driver.sent.map(kindOf);
}

async function write(
  rows: Row[],
  orders: GeneratedPlannedOrder[],
  heldPlannedOrderIds: string[] = [],
  snapshot?: PlannedOrderSnapshot
) {
  const { db, driver } = database(rows);
  const idByKey = await writePlannedOrderDiff(db, {
    companyId: "co-1",
    userId: "user-1",
    locationIds: ["loc-1"],
    generated: orders,
    heldPlannedOrderIds,
    updatedAt: "2026-11-14T00:00:00Z",
    snapshot
  });
  return { idByKey, kinds: kindsOf(driver), driver };
}

describe("writePlannedOrderDiff", () => {
  // A conversion between the run's read and its write would otherwise be
  // overwritten or deleted.
  it("takes the company's planning lock before any other statement", async () => {
    const { kinds, driver } = await write([], [generated()]);
    expect(kinds[0]).toBe("lock");
    expect(driver.sent[0]!.parameters).toEqual(["planning-actions:co-1"]);
  });

  it("inserts a new order and returns its id by natural key", async () => {
    const order = generated();
    const { idByKey, kinds, driver } = await write([], [order]);
    expect(kinds).toEqual(["lock", "select", "insert"]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "new-1"]]));
    expect(driver.rows).toEqual([
      expect.objectContaining({ id: "new-1", status: "Planned", quantity: 10 })
    ]);
  });

  // Two identical runs write nothing: ids and updatedAt stay.
  it("sends no write for a matched row whose values did not change", async () => {
    const order = generated();
    const { idByKey, kinds } = await write([stored("plo-1")], [order]);
    expect(kinds).toEqual(["lock", "select"]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "plo-1"]]));
  });

  it("updates a matched row in place when its quantity changed", async () => {
    const { idByKey, kinds, driver } = await write(
      [stored("plo-1")],
      [generated({ quantity: 15 })]
    );
    expect(kinds).toEqual(["lock", "select", "update"]);
    expect([...idByKey.values()]).toEqual(["plo-1"]);
    expect(driver.rows).toEqual([
      expect.objectContaining({
        id: "plo-1",
        quantity: 15,
        updatedBy: "user-1"
      })
    ]);
  });

  it("deletes a Planned row no generated order matches, but keeps a held one", async () => {
    const { kinds, driver } = await write(
      [stored("plo-gone"), stored("plo-held", { periodId: "p3" })],
      [],
      ["plo-held"]
    );
    expect(kinds).toEqual(["lock", "select", "delete"]);
    expect(driver.rows.map((row) => row.id)).toEqual(["plo-held"]);
  });

  // Another location's rows are not this run's, nor are another company's.
  it("diffs only the company's Planned rows at the planned locations", async () => {
    const { kinds, driver } = await write(
      [
        stored("plo-own", { companyId: "co-1" }),
        stored("plo-elsewhere", { companyId: "co-1", locationId: "loc-2" }),
        stored("plo-other-company", { companyId: "co-2" })
      ],
      []
    );
    expect(kinds).toEqual(["lock", "select", "delete"]);
    expect(driver.sent[2]!.parameters).toEqual(["co-1", "Planned", "plo-own"]);
    expect(driver.rows.map((row) => row.id)).toEqual([
      "plo-elsewhere",
      "plo-other-company"
    ]);
  });

  it("never touches a Firm or Converted row, even on the same natural key", async () => {
    const firm = stored("plo-firm", { status: "Firm", quantity: 99 });
    const converted = stored("plo-conv", {
      status: "Converted",
      periodId: "p3",
      jobId: "job-1"
    });
    const order = generated();
    const { idByKey, driver } = await write([firm, converted], [order]);
    expect(idByKey).toEqual(new Map([[order.naturalKey, "new-1"]]));
    expect(driver.rows.slice(0, 2)).toEqual([
      stored("plo-firm", { status: "Firm", quantity: 99 }),
      stored("plo-conv", {
        status: "Converted",
        periodId: "p3",
        jobId: "job-1"
      })
    ]);
  });
});

describe("diffPlannedOrders", () => {
  // jsonb drops a key whose value is undefined; read back, the trace must
  // still equal the generated one, or every run rewrites every row.
  it("reads a trace with an undefined value back as unchanged", () => {
    const order = generated({
      quantityTrace: {
        ...TRACE,
        triggerValues: { projectedStock: -10, reorderPoint: undefined }
      }
    });
    const { naturalKey: _key, ...values } = order;
    const diff = diffPlannedOrders({
      existing: [
        {
          ...values,
          id: "plo-1",
          quantityTrace: JSON.parse(JSON.stringify(order.quantityTrace))
        }
      ],
      generated: [order],
      heldPlannedOrderIds: new Set()
    });
    expect(diff).toEqual({
      inserts: [],
      updates: [],
      deleteIds: [],
      matchedIds: new Map([[order.naturalKey, "plo-1"]])
    });
  });
});

describe("the planned-order check before the write", () => {
  const READ_START = "2026-11-14 10:00:00+00";
  const snapshotOf = (...rows: Row[]): PlannedOrderSnapshot => ({
    readStart: READ_START,
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      updatedAt: (row.updatedAt as string | undefined) ?? null
    }))
  });

  // A planner firmed plo-1 after the run read it: the run's plan would
  // overwrite the firm, so this attempt writes nothing.
  it("writes nothing when a planned order changed since the run read it", async () => {
    const before = stored("plo-1");
    const firmed = stored("plo-1", {
      status: "Firm",
      updatedAt: "2026-11-14 10:00:05"
    });
    const { db, driver } = database([firmed]);
    await expect(
      writePlannedOrderDiff(db, {
        companyId: "co-1",
        userId: "user-1",
        locationIds: ["loc-1"],
        generated: [generated({ quantity: 15 })],
        heldPlannedOrderIds: [],
        updatedAt: "2026-11-14T00:00:00Z",
        snapshot: snapshotOf(before)
      })
    ).rejects.toBeInstanceOf(PlannedOrdersChangedError);
    expect(kindsOf(driver)).toEqual(["lock", "check"]);
    expect(driver.rows).toEqual([firmed]);
  });

  it("writes as usual when the planned orders are as the run read them", async () => {
    const row = stored("plo-1", { updatedAt: "2026-11-13 09:00:00" });
    const { kinds, driver } = await write(
      [row],
      [generated({ quantity: 15 })],
      [],
      snapshotOf(row)
    );
    expect(kinds).toEqual(["lock", "check", "select", "update"]);
    expect(driver.rows).toEqual([
      expect.objectContaining({ id: "plo-1", quantity: 15 })
    ]);
  });
});

describe("plannedOrdersChangedSince", () => {
  const loaded = [
    { id: "plo-1", status: "Planned", updatedAt: null },
    { id: "plo-2", status: "Firm", updatedAt: "2026-11-13 09:00:00" }
  ];
  const current = (
    overrides: Partial<
      Record<string, Partial<CurrentPlannedOrder> | null>
    > = {},
    extra: CurrentPlannedOrder[] = []
  ): CurrentPlannedOrder[] => [
    ...loaded.flatMap((row) => {
      const override = overrides[row.id];
      if (override === null) return [];
      return [{ ...row, createdSinceRead: false, ...override }];
    }),
    ...extra
  ];

  it("sees no change when every row is as read", () => {
    expect(plannedOrdersChangedSince(loaded, current())).toBe(false);
  });

  it.each([
    [
      "a firm",
      { "plo-1": { status: "Firm", updatedAt: "2026-11-14 10:00:05" } }
    ],
    ["an edit", { "plo-2": { updatedAt: "2026-11-14 10:00:05" } }],
    [
      "a conversion",
      { "plo-1": { status: "Converted", updatedAt: "2026-11-14 10:00:05" } }
    ],
    ["a cancel (the row is deleted)", { "plo-2": null }]
  ] as const)("sees %s", (_name, overrides) => {
    expect(plannedOrdersChangedSince(loaded, current(overrides))).toBe(true);
  });

  it("sees a planned order another run inserted", () => {
    expect(
      plannedOrdersChangedSince(
        loaded,
        current({}, [
          {
            id: "plo-3",
            status: "Planned",
            updatedAt: null,
            createdSinceRead: false
          }
        ])
      )
    ).toBe(true);
  });

  it("sees any row created after the read began", () => {
    expect(
      plannedOrdersChangedSince(
        loaded,
        current({}, [
          {
            id: "plo-4",
            status: "Converted",
            updatedAt: null,
            createdSinceRead: true
          }
        ])
      )
    ).toBe(true);
  });
});

describe("retryOnPlannedOrderChange", () => {
  // The random pause between attempts, counted instead of waited for.
  const pauses = () => {
    const counter = { count: 0, pause: async () => void counter.count++ };
    return counter;
  };

  it("plans again after a change and returns the attempt that wrote", async () => {
    const attempts: number[] = [];
    const counter = pauses();
    const result = await retryOnPlannedOrderChange(
      async (attempt) => {
        attempts.push(attempt);
        if (attempt < 2) throw new PlannedOrdersChangedError();
        return "written";
      },
      { pause: counter.pause }
    );
    expect([result, attempts, counter.count]).toEqual(["written", [1, 2], 1]);
  });

  it("gives up after five changed attempts", async () => {
    const attempts: number[] = [];
    const counter = pauses();
    await expect(
      retryOnPlannedOrderChange(
        async (attempt) => {
          attempts.push(attempt);
          throw new PlannedOrdersChangedError();
        },
        { pause: counter.pause }
      )
    ).rejects.toMatchObject({ cause: expect.any(PlannedOrdersChangedError) });
    expect([attempts, counter.count]).toEqual([[1, 2, 3, 4, 5], 4]);
  });

  it("does not retry any other failure", async () => {
    const attempts: number[] = [];
    const counter = pauses();
    await expect(
      retryOnPlannedOrderChange(
        async (attempt) => {
          attempts.push(attempt);
          throw new Error("connection lost");
        },
        { pause: counter.pause }
      )
    ).rejects.toThrow("connection lost");
    expect([attempts, counter.count]).toEqual([[1], 0]);
  });
});
