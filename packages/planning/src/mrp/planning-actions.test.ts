// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DB } from "@carbon/database/client";
import { KEY_SEP } from "@carbon/database/mrp-engine";
import * as pegging from "@carbon/ee/pegging";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it } from "vitest";
import { itemLocationSegmentKey } from "./open-supply-orders";
import type {
  ChangeCandidate,
  PlanningActionCandidate
} from "./planning-action-types";
import {
  diffPlanningActions,
  type ExistingPlanningAction,
  keyPeriodFor,
  naturalKey
} from "./planning-action-write";
import { loadSegmentOnHand, memberMoveCandidates } from "./planning-actions";
import {
  deriveReleaseActions,
  deriveRowActions,
  onePerPlannedOrder,
  plannedOrderActions
} from "./row-actions";
import { convertOrdersToIncreases, deriveChangeActions } from "./row-sizing";

const PERIODS = [
  { id: "p1", startDate: "2026-10-05" },
  { id: "p2", startDate: "2026-10-12" },
  { id: "p3", startDate: "2026-10-19" },
  { id: "p4", startDate: "2026-10-26" },
  { id: "p5", startDate: "2026-11-02" }
];

const TODAY = "2026-09-11";
const TOLERANCE = 7;

const base = {
  periods: PERIODS,
  policyFloor: 0,
  toleranceDays: TOLERANCE,
  todayDate: TODAY
};

describe("change actions on a planned order", () => {
  const plannedOrder = {
    plannedOrderId: "plo-1",
    quantity: 10,
    dueDate: "2026-10-12",
    requiresManualAction: false
  };

  it("cancels a planned order nothing needs, on the planned order", () => {
    const actions = deriveChangeActions({
      ...base,
      onHand: 100, // on-hand covers all demand
      demandPeriods: [
        { periodId: "p1", startDate: "2026-10-05", quantity: 10 }
      ],
      openOrders: [{ ...plannedOrder, quantity: 25 }]
    });
    expect(actions).toEqual([
      {
        type: "Cancel",
        periodId: "p2",
        suggestedQuantity: 25,
        suggestedDate: "2026-10-12",
        horizonDate: "2026-10-12",
        latestOrderDate: null,
        isASAP: false,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: "plo-1",
        requiresManualAction: false,
        supplierId: null,
        policyName: null,
        reason: expect.any(String),
        triggerValues: null
      }
    ]);
  });

  it("keys an action on a planned order by the order, whatever its week", () => {
    const cancel = {
      itemId: "item-1",
      locationId: "loc-1",
      type: "Cancel",
      periodId: "p2",
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: "plo-1"
    };
    expect(naturalKey(cancel).split(KEY_SEP)[4]).toBe("order:plo-1");
    expect(naturalKey(cancel)).toBe(naturalKey({ ...cancel, periodId: "p4" }));
  });

  const suggestion = (type: "Order" | "Make") => ({
    type,
    periodId: "p2",
    suggestedQuantity: 5,
    suggestedDate: "2026-10-12",
    horizonDate: "2026-10-12",
    latestOrderDate: "2026-10-07",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: null,
    requiresManualAction: false,
    supplierId: null,
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: null
  });

  it.each([
    ["Order", "Buy"],
    ["Make", "Make"]
  ] as const)(
    "folds a %s suggestion into a same-window %s planned order as one Increase",
    (type, orderType) => {
      const [action] = convertOrdersToIncreases({
        sizingCandidates: [suggestion(type)],
        openOrders: [{ ...plannedOrder, orderType }],
        changeActions: [],
        toleranceDays: TOLERANCE,
        todayDate: TODAY
      });
      expect(action).toMatchObject({
        type: "Increase",
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: "plo-1",
        requiresManualAction: false,
        suggestedQuantity: 15 // existing 10 + shortfall 5
      });
    }
  );

  // A Make planned order is a job to be; buying into it would mix the two.
  it.each([
    ["Order", "Make"],
    ["Make", "Buy"]
  ] as const)(
    "keeps a %s suggestion a new order beside a %s planned order",
    (type, orderType) => {
      const result = convertOrdersToIncreases({
        sizingCandidates: [suggestion(type)],
        openOrders: [{ ...plannedOrder, orderType }],
        changeActions: [],
        toleranceDays: TOLERANCE,
        todayDate: TODAY
      });
      expect(result).toEqual([suggestion(type)]);
    }
  );
});

describe("diffPlanningActions", () => {
  const candidate: PlanningActionCandidate = {
    itemId: "item-1",
    locationId: "loc-1",
    periodId: "p1",
    type: "Order",
    suggestedQuantity: 10,
    suggestedDate: "2026-10-05",
    horizonDate: "2026-10-05",
    latestOrderDate: "2026-09-30",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: null,
    requiresManualAction: false,
    supplierId: "sup-1",
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: { safetyStock: 10 },
    assignee: "buyer-1"
  };

  const existing: ExistingPlanningAction = {
    id: "pla-1",
    itemId: "item-1",
    locationId: "loc-1",
    periodId: "p1",
    type: "Order",
    status: "Open",
    suggestedQuantity: 10,
    suggestedDate: "2026-10-05",
    horizonDate: "2026-10-05",
    latestOrderDate: "2026-09-30",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: null,
    requiresManualAction: false,
    supplierId: "sup-1",
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: { safetyStock: 10 },
    assignee: "buyer-1",
    assigneeOverridden: false
  };

  it("two identical runs produce zero changes (idempotency)", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("triggerValues equality ignores jsonb key order (idempotency)", () => {
    // jsonb returns keys length-then-bytewise; the candidate builds them in
    // insertion order — identical values must not produce an update.
    const diff = diffPlanningActions({
      existing: [
        {
          ...existing,
          triggerValues: { reorderPoint: 5, leadTime: 14, projectedStock: 2 }
        }
      ],
      candidates: [
        {
          ...candidate,
          triggerValues: { projectedStock: 2, reorderPoint: 5, leadTime: 14 }
        }
      ],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("triggerValues equality still detects a changed value", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, triggerValues: { safetyStock: 10 } }],
      candidates: [{ ...candidate, triggerValues: { safetyStock: 12 } }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { triggerValues: { safetyStock: 12 } } }
    ]);
  });

  it("inserts a new candidate, deletes a vanished row", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [{ ...candidate, periodId: "p2" }],
      toleranceDays: TOLERANCE
    });
    expect(diff.inserts).toHaveLength(1);
    expect(diff.deleteIds).toEqual(["pla-1"]);
  });

  it("updates an Open row in place when the suggestion changes", () => {
    const diff = diffPlanningActions({
      existing: [existing],
      candidates: [{ ...candidate, suggestedQuantity: 12 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { suggestedQuantity: 12 } }
    ]);
  });

  it("preserves a human-overridden assignee but still refreshes the suggestion", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, assignee: "lead-1", assigneeOverridden: true }],
      candidates: [{ ...candidate, suggestedQuantity: 12 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]?.patch).toEqual({ suggestedQuantity: 12 });
    expect(diff.updates[0]?.patch).not.toHaveProperty("assignee");
  });

  it("a Dismissed row stays dismissed across an unchanged run", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("refreshes the grid-facing dates on an Open row", () => {
    const diff = diffPlanningActions({
      existing: [
        { ...existing, horizonDate: "2026-10-12", latestOrderDate: null }
      ],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      {
        id: "pla-1",
        patch: { horizonDate: "2026-10-05", latestOrderDate: "2026-09-30" }
      }
    ]);
  });

  it("refreshes the grid-facing dates on a Dismissed row WITHOUT reopening it", () => {
    const diff = diffPlanningActions({
      existing: [
        { ...existing, status: "Dismissed", horizonDate: "2026-10-12" }
      ],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toEqual([
      { id: "pla-1", patch: { horizonDate: "2026-10-05" } }
    ]);
  });

  it("float noise in the candidate quantity is not a material change", () => {
    // 0.1 + 0.2 is 0.30000000000000004: the same need, re-summed in a
    // different row order, must not reopen a Dismissed row.
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed", suggestedQuantity: 0.3 }],
      candidates: [{ ...candidate, suggestedQuantity: 0.1 + 0.2 }],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("reopens a Dismissed row on a material change", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [{ ...candidate, suggestedQuantity: 20 }],
      toleranceDays: TOLERANCE
    });
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0]?.patch).toMatchObject({
      status: "Open",
      suggestedQuantity: 20
    });
  });

  it("deletes a Dismissed row whose need vanished so a returning need re-surfaces", () => {
    const diff = diffPlanningActions({
      existing: [{ ...existing, status: "Dismissed" }],
      candidates: [],
      toleranceDays: TOLERANCE
    });
    expect(diff.deleteIds).toEqual(["pla-1"]);
  });

  it("keys change actions by their target document", () => {
    const expediteA = naturalKey({
      itemId: "item-1",
      locationId: "loc-1",
      type: "Expedite",
      periodId: "p1",
      purchaseOrderLineId: "pol-a",
      jobId: null,
      plannedOrderId: null
    });
    const expediteB = naturalKey({
      itemId: "item-1",
      locationId: "loc-1",
      type: "Expedite",
      periodId: "p1",
      purchaseOrderLineId: "pol-b",
      jobId: null,
      plannedOrderId: null
    });
    expect(expediteA).not.toBe(expediteB);
  });

  // A project with project stock nets in its own segment, so one item and
  // week can hold a common Order and the project's Order.
  it("keys an action by its netting segment and its transfer owners", () => {
    const order = {
      itemId: "item-1",
      locationId: "loc-1",
      type: "Order",
      periodId: "p1",
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: null
    };
    expect(naturalKey(order)).toBe(
      naturalKey({ ...order, planningSegmentId: "" })
    );
    expect(naturalKey(order)).not.toBe(
      naturalKey({ ...order, planningSegmentId: "prj_1" })
    );

    const transfer = {
      ...order,
      type: "Transfer",
      planningSegmentId: "prj_1",
      toProjectId: "prj_1"
    };
    expect(naturalKey({ ...transfer, fromProjectId: null })).not.toBe(
      naturalKey({ ...transfer, fromProjectId: "prj_2" })
    );
  });

  it("keeps matching an existing common action on the next run", () => {
    const diff = diffPlanningActions({
      existing: [
        {
          ...existing,
          planningSegmentId: "",
          fromProjectId: null,
          toProjectId: null
        }
      ],
      candidates: [{ ...candidate, planningSegmentId: "" }],
      toleranceDays: TOLERANCE
    });
    expect(diff).toEqual({ inserts: [], updates: [], deleteIds: [] });
  });

  it("passes candidate fields (incl. assignee) through to inserts unchanged", () => {
    const diff = diffPlanningActions({
      existing: [],
      candidates: [candidate],
      toleranceDays: TOLERANCE
    });
    expect(diff.inserts[0]).toEqual(candidate);
  });

  // MRP puts current and overdue demand in the first week, a different week
  // every Sunday, and a change action's need moves with it. Keyed on the week,
  // each such action got a new row weekly, losing its dismissal and assignee.
  describe("identity across weeks", () => {
    const thisRun = PERIODS; // p1 is the current week
    const lastWeek = "p0"; // a week before this run's first

    it("keys a change action by its order, whatever week its need is in", () => {
      const expedite = (periodId: string) =>
        naturalKey({
          itemId: "item-1",
          locationId: "loc-1",
          type: "Expedite",
          periodId,
          purchaseOrderLineId: "pol-a",
          jobId: null,
          plannedOrderId: null
        });
      expect(expedite("p1")).toBe(expedite("p2"));
    });

    it("keys every week up to the current one as one 'now', later weeks apart", () => {
      const keyPeriod = keyPeriodFor(thisRun);
      expect(keyPeriod(lastWeek)).toBe("now");
      expect(keyPeriod("p1")).toBe("now");
      expect(keyPeriod("p2")).toBe("p2");
    });

    it("moves a dismissed change action to its new week instead of replacing it", () => {
      const dismissed: ExistingPlanningAction = {
        ...existing,
        type: "Expedite",
        status: "Dismissed",
        periodId: "p1",
        purchaseOrderLineId: "pol-a"
      };
      const diff = diffPlanningActions({
        existing: [dismissed],
        candidates: [
          {
            ...candidate,
            type: "Expedite",
            periodId: "p2",
            purchaseOrderLineId: "pol-a"
          }
        ],
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.inserts).toEqual([]);
      expect(diff.deleteIds).toEqual([]);
      expect(diff.updates).toEqual([
        { id: "pla-1", patch: { periodId: "p2" } }
      ]);
    });

    it("keeps last week's current-week Order, and its assignee, when the shortage goes on", () => {
      const lastWeeksOrder: ExistingPlanningAction = {
        ...existing,
        periodId: lastWeek,
        assignee: "planner-2",
        assigneeOverridden: true
      };
      const diff = diffPlanningActions({
        existing: [lastWeeksOrder],
        candidates: [candidate], // p1
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.inserts).toEqual([]);
      expect(diff.deleteIds).toEqual([]);
      expect(diff.updates).toEqual([
        { id: "pla-1", patch: { periodId: "p1" } }
      ]);
    });

    it("keeps the row already on the current week when two share 'now'", () => {
      const diff = diffPlanningActions({
        existing: [
          { ...existing, id: "pla-old", periodId: lastWeek },
          { ...existing, id: "pla-now", periodId: "p1" }
        ],
        candidates: [candidate],
        periods: thisRun,
        toleranceDays: TOLERANCE
      });
      expect(diff.deleteIds).toEqual(["pla-old"]);
      expect(diff.updates).toEqual([]);
      expect(diff.inserts).toEqual([]);
    });
  });
});

// An Expedite and a new Order could both answer one shortage: sizing read the
// projection with the late order still in its old week. Sizing now reads the
// projection with every Expedite done.
describe("deriveReleaseActions", () => {
  const today = "2026-10-06";
  const periods = [
    { id: "w0", startDate: "2026-10-04" },
    { id: "w1", startDate: "2026-10-11" },
    { id: "w2", startDate: "2026-10-18" }
  ];
  const planned = (purchaseOrderLineId: string, releaseDate: string) => ({
    purchaseOrderLineId,
    quantity: 10,
    dueDate: "2026-10-20",
    requiresManualAction: false,
    release: { date: releaseDate, dueDate: "2026-10-20", leadTime: 7 }
  });

  it("raises one Release per planned order, dated its release day", () => {
    const [release] = deriveReleaseActions({
      openOrders: [planned("pol-1", "2026-10-12")],
      changeActions: [],
      periods,
      todayDate: "2026-10-11"
    });
    expect(release).toMatchObject({
      type: "Release",
      purchaseOrderLineId: "pol-1",
      suggestedDate: "2026-10-12",
      horizonDate: "2026-10-12",
      periodId: "w1",
      isASAP: false,
      latestOrderDate: null,
      requiresManualAction: false,
      reason: "Due 2026-10-20 with a 7-day lead time"
    });
  });

  it("flags a release due today or already late as ASAP", () => {
    const actions = deriveReleaseActions({
      openOrders: [planned("today", today), planned("late", "2026-10-01")],
      changeActions: [],
      periods,
      todayDate: today
    });
    expect(
      actions.map((a) => [a.purchaseOrderLineId, a.isASAP, a.periodId])
    ).toEqual([
      ["today", true, "w0"],
      ["late", true, "w0"]
    ]);
  });

  it("waits until the day before the release day", () => {
    const actions = deriveReleaseActions({
      openOrders: [
        planned("tomorrow", "2026-10-07"),
        planned("in-two-days", "2026-10-08"),
        planned("next-week", "2026-10-12")
      ],
      changeActions: [],
      periods,
      todayDate: today
    });
    expect(actions.map((a) => [a.purchaseOrderLineId, a.isASAP])).toEqual([
      ["tomorrow", false]
    ]);
  });

  it("raises nothing for an order past Planned", () => {
    expect(
      deriveReleaseActions({
        openOrders: [{ ...planned("pol-1", today), release: null }],
        changeActions: [],
        periods,
        todayDate: today
      })
    ).toEqual([]);
  });

  it("raises nothing for an order MRP would cancel", () => {
    expect(
      deriveReleaseActions({
        openOrders: [planned("pol-1", today)],
        changeActions: [
          {
            type: "Cancel",
            purchaseOrderLineId: "pol-1",
            jobId: null,
            plannedOrderId: null
          }
        ],
        periods,
        todayDate: today
      })
    ).toEqual([]);
  });

  it("raises nothing for a planned order MRP holds", () => {
    expect(
      deriveReleaseActions({
        openOrders: [
          {
            plannedOrderId: "plo-1",
            quantity: 10,
            dueDate: "2026-10-20",
            requiresManualAction: false,
            release: { date: today, dueDate: "2026-10-20", leadTime: 7 }
          }
        ],
        changeActions: [],
        periods,
        todayDate: today
      })
    ).toEqual([]);
  });

  it("keeps a Release beside a change to the same order", () => {
    expect(
      deriveReleaseActions({
        openOrders: [planned("pol-1", today)],
        changeActions: [
          {
            type: "Increase",
            purchaseOrderLineId: "pol-1",
            jobId: null,
            plannedOrderId: null
          }
        ],
        periods,
        todayDate: today
      })
    ).toHaveLength(1);
  });
});

describe("loadSegmentOnHand", () => {
  // One item and location with three project stock stripes: common (''), a
  // project with project stock, and a project whose project stock was turned
  // off (its stripe nets in common). The driver answers like Postgres for
  // equality predicates.
  const STOCK: Record<string, unknown>[] = [
    {
      itemId: "itm_1",
      locationId: "loc_1",
      projectId: "",
      companyId: "co_1",
      quantityOnHand: 5
    },
    {
      itemId: "itm_1",
      locationId: "loc_1",
      projectId: "prj_1",
      companyId: "co_1",
      quantityOnHand: 3
    },
    {
      itemId: "itm_1",
      locationId: "loc_1",
      projectId: "prj_2",
      companyId: "co_1",
      quantityOnHand: 2
    }
  ];
  const PROJECTS: Record<string, unknown>[] = [
    { id: "prj_1", companyId: "co_1", projectStock: true },
    { id: "prj_2", companyId: "co_1", projectStock: false }
  ];

  class StockTableDriver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <R>(
          query: CompiledQuery
        ): Promise<QueryResult<R>> => {
          const table = query.sql.includes('from "project"') ? PROJECTS : STOCK;
          const predicates = [...query.sql.matchAll(/"(\w+)" = \$(\d+)/g)];
          const rows = table.filter((row) =>
            predicates.every(
              ([, column, n]) =>
                row[column!] === query.parameters[Number(n) - 1]
            )
          );
          return { rows: rows as R[] };
        },
        // oxlint-disable-next-line require-yield -- never streamed
        streamQuery: async function* () {
          throw new Error("not streamed");
        }
      };
    }
  }

  it("sums each stripe into its netting segment", async () => {
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new StockTableDriver(),
        createIntrospector: (k) => new PostgresIntrospector(k),
        createQueryCompiler: () => new PostgresQueryCompiler()
      }
    });

    const onHand = await loadSegmentOnHand(db, "co_1");

    expect(onHand.get(itemLocationSegmentKey("itm_1", "loc_1"))).toBe(7);
    expect(onHand.get(itemLocationSegmentKey("itm_1", "loc_1", "prj_1"))).toBe(
      3
    );
    expect(onHand.size).toBe(2);
  });
});

describe("deriveRowActions in a project segment", () => {
  // The spec case: P-101 needs 20 in week 1 and holds 5. The common segment
  // has 8 it does not need within the horizon, so MRP drew 8.
  const projectRow = (weeks: number[]) =>
    ({
      id: "item-1",
      planningSegmentId: "prj_1",
      reorderingPolicy: "Fixed Reorder Quantity",
      reorderPoint: 10,
      reorderQuantity: 50,
      minimumOrderQuantity: 0,
      maximumOrderQuantity: 0,
      orderMultiple: 0,
      lotSize: 0,
      maximumInventoryQuantity: 0,
      demandAccumulationPeriod: 1,
      demandAccumulationSafetyStock: 0,
      leadTime: 0,
      quantityOnHand: 5,
      quantityToOrder: 15,
      preferredSupplierId: "sup-1",
      supersessionMode: null,
      minimumReserveQuantity: 0,
      ...Object.fromEntries(weeks.map((value, i) => [`week${i + 1}`, value]))
    }) as unknown as Parameters<typeof deriveRowActions>[0]["row"];

  const input = (draws: { periodId: string; quantity: number }[]) => ({
    row: projectRow([-15, -15, -15, -15, -15]),
    kind: "Order" as const,
    periods: PERIODS,
    demandByPeriod: new Map([["p1", 20]]),
    openOrders: [],
    onHand: 5,
    draws,
    toleranceDays: TOLERANCE,
    todayDate: TODAY
  });

  it("emits Transfer 8 and Order 7, both in the project's segment", () => {
    const actions = deriveRowActions(input([{ periodId: "p1", quantity: 8 }]));

    expect(
      actions.map((a) => ({
        type: a.type,
        periodId: a.periodId,
        quantity: a.suggestedQuantity,
        segment: a.planningSegmentId,
        from: a.fromProjectId ?? null,
        to: a.toProjectId ?? null
      }))
    ).toEqual([
      {
        type: "Order",
        periodId: "p1",
        quantity: 7,
        segment: "prj_1",
        from: null,
        to: null
      },
      {
        type: "Transfer",
        periodId: "p1",
        quantity: 8,
        segment: "prj_1",
        from: null,
        to: "prj_1"
      }
    ]);
    const transfer = actions.find((a) => a.type === "Transfer");
    expect(transfer?.reason).toBe("Common stock not needed within the horizon");
    expect(transfer?.suggestedDate).toBe("2026-10-05");
  });

  // Lot-for-lot: the row's reorder point of 10 and quantity of 50 do not apply.
  it("orders the shortfall alone, with no reorder policy", () => {
    const actions = deriveRowActions(input([]));
    expect(actions.map((a) => [a.type, a.suggestedQuantity])).toEqual([
      ["Order", 15]
    ]);
    expect(actions[0]?.policyName).toBe("Lot-for-Lot");
  });
});

// Projects Phase 3: a member short by 4, with a sibling that needs its 6 in 3
// weeks, gets a Borrow action in the group's segment.
describe("memberMoveCandidates", () => {
  it("emits a Borrow in the group segment and moves the stock in the peg input", () => {
    const result = memberMoveCandidates(
      {
        inputs: [
          {
            planningGroupId: "plg-1",
            itemId: "item-1",
            locationId: "loc-1",
            demands: [
              {
                projectId: "p-101",
                projectElementId: null,
                priority: 100,
                sourceType: "Project Material",
                sourceId: "pem-1",
                needDate: "2026-10-19",
                quantity: 4
              },
              {
                projectId: "p-102",
                projectElementId: null,
                priority: 100,
                sourceType: "Project Material",
                sourceId: "pem-2",
                needDate: "2026-11-02",
                quantity: 6
              }
            ],
            supplies: [
              {
                supplyType: "Stock",
                supplyId: "p-102",
                ownerProjectId: "p-102",
                availableDate: "2026-10-12",
                quantity: 6
              }
            ]
          }
        ],
        planningGroups: [{ id: "plg-1", memberProjectIds: ["p-101", "p-102"] }],
        priorityRuleByGroup: { "plg-1": "Earliest Need" },
        priorityByProject: { "p-101": 100, "p-102": 100 },
        leadTimeByItemLocation: new Map([["item-1\x1floc-1", 5]]),
        periods: [
          { id: "w1", startDate: "2026-10-11" },
          { id: "w2", startDate: "2026-10-18" },
          { id: "w3", startDate: "2026-10-25" },
          // the horizon ends 2026-11-07, so p-102's need is inside it
          { id: "w4", startDate: "2026-11-01" }
        ],
        todayDate: "2026-10-12",
        assigneeOf: () => "emp-1"
      },
      pegging
    );
    expect(result.candidates).toEqual([
      expect.objectContaining({
        type: "Borrow",
        itemId: "item-1",
        locationId: "loc-1",
        periodId: "w2",
        suggestedQuantity: 4,
        suggestedDate: "2026-10-19",
        planningSegmentId: "plg-1",
        fromProjectId: "p-102",
        toProjectId: "p-101",
        triggerValues: { paybackDueDate: "2026-10-28" },
        assignee: "emp-1"
      })
    ]);
    expect(
      result.inputs[0]?.supplies.map((supply) => [
        supply.ownerProjectId,
        supply.quantity
      ])
    ).toEqual([
      ["p-102", 2],
      ["p-101", 4]
    ]);
  });
});

// MRP v2: a row the engine planned with planned orders takes its new supply
// from the engine; the RPC row only sizes rows the engine did not plan.
describe("deriveRowActions with the engine's new supply", () => {
  const commonRow = {
    id: "item-1",
    planningSegmentId: "",
    reorderingPolicy: "Demand-Based Reorder",
    reorderPoint: 0,
    reorderQuantity: 0,
    minimumOrderQuantity: 0,
    maximumOrderQuantity: 0,
    orderMultiple: 0,
    lotSize: 0,
    maximumInventoryQuantity: 0,
    demandAccumulationPeriod: 1,
    demandAccumulationSafetyStock: 0,
    leadTime: 0,
    quantityOnHand: 0,
    quantityToOrder: 15,
    supersessionMode: null,
    minimumReserveQuantity: 0,
    week1: -15,
    week2: -15,
    week3: -15,
    week4: -15,
    week5: -15
  } as unknown as Parameters<typeof deriveRowActions>[0]["row"];

  const input = (engineSupply?: ChangeCandidate[]) => ({
    row: commonRow,
    kind: "Make" as const,
    periods: PERIODS,
    demandByPeriod: new Map([["p1", 15]]),
    openOrders: [],
    onHand: 0,
    draws: [],
    toleranceDays: TOLERANCE,
    todayDate: TODAY,
    engine: engineSupply
      ? { supply: engineSupply, changeActions: [] }
      : undefined
  });

  const summary = (actions: ChangeCandidate[]) =>
    actions.map((a) => [a.type, a.periodId, a.suggestedQuantity]);

  it("sizes the RPC row when the engine did not plan it", () => {
    expect(summary(deriveRowActions(input()))).toEqual([["Make", "p1", 15]]);
  });

  // A lot size of 40 on the planned order: the engine's number wins, and the
  // two planned orders of week p2 are one Make with no planned order named.
  it("uses the engine's orders, summed per week, naming no planned order", () => {
    const make = (
      quantity: number,
      plannedOrderKey: string
    ): ChangeCandidate => ({
      type: "Make",
      periodId: "p2",
      suggestedQuantity: quantity,
      suggestedDate: "2026-10-12",
      horizonDate: "2026-10-12",
      latestOrderDate: "2026-10-12",
      isASAP: false,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId: null,
      requiresManualAction: false,
      supplierId: null,
      policyName: "Demand-Based Reorder",
      reason: null,
      triggerValues: null,
      plannedOrderKey
    });
    const actions = deriveRowActions(
      input([make(40, "key-0"), make(40, "key-1")])
    );
    expect(summary(actions)).toEqual([["Make", "p2", 80]]);
    expect(actions[0]).not.toHaveProperty("plannedOrderKey");
    expect(actions[0]?.plannedOrderId).toBeNull();
  });

  // A held planned order is part of its week's Make: the action covers it
  // and the new order of the week, and names neither.
  it("sums a held planned order into its week's Make", () => {
    const make = (
      quantity: number,
      plannedOrderId: string | null
    ): ChangeCandidate => ({
      type: "Make",
      periodId: "p2",
      suggestedQuantity: quantity,
      suggestedDate: "2026-10-12",
      horizonDate: "2026-10-12",
      latestOrderDate: "2026-10-05",
      isASAP: false,
      purchaseOrderLineId: null,
      jobId: null,
      plannedOrderId,
      requiresManualAction: false,
      supplierId: null,
      policyName: "Demand-Based Reorder",
      reason: null,
      triggerValues: null,
      plannedOrderKey: `key-${plannedOrderId}`
    });
    const actions = deriveRowActions(input([make(40, null), make(5, "plo_1")]));
    expect(summary(actions)).toEqual([["Make", "p2", 45]]);
    expect(actions[0]?.plannedOrderId).toBeNull();
  });
});

describe("plannedOrderActions", () => {
  const order: ChangeCandidate = {
    type: "Make",
    periodId: "p3",
    suggestedQuantity: 20,
    suggestedDate: "2026-10-19",
    horizonDate: "2026-10-19",
    latestOrderDate: "2026-10-12",
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: null,
    requiresManualAction: false,
    supplierId: null,
    policyName: "Demand-Based Reorder",
    reason: null,
    triggerValues: null,
    plannedOrderKey: ["item-1", "loc-1", "", "Make", "p3", "0"].join(KEY_SEP)
  };
  const cancel = {
    itemId: "item-9",
    locationId: "loc-1",
    planningSegmentId: "",
    type: "Cancel" as const,
    periodId: "p2",
    suggestedQuantity: 5,
    suggestedDate: "2026-10-12",
    horizonDate: "2026-10-12",
    latestOrderDate: null,
    isASAP: false,
    purchaseOrderLineId: null,
    jobId: null,
    plannedOrderId: "plo-held",
    requiresManualAction: false,
    supplierId: null,
    policyName: null,
    reason: "No remaining requirement for this order",
    triggerValues: null
  };
  const base = (
    overrides: Partial<Parameters<typeof plannedOrderActions>[0]>
  ) =>
    plannedOrderActions({
      changeActions: [],
      signals: [],
      newSupplyByRow: new Map([
        [itemLocationSegmentKey("item-1", "loc-1"), [order]]
      ]),
      plannedOrderIdByKey: new Map([[order.plannedOrderKey!, "plo-new"]]),
      heldPlannedOrderIds: new Set(["plo-held"]),
      periods: PERIODS,
      todayDate: "2026-10-01",
      ...overrides
    });

  // The fence moved the order from its need on Oct 5 to Oct 19.
  it("turns a fence signal into an Expedite on the planned order", () => {
    expect(
      base({
        signals: [
          { naturalKey: order.plannedOrderKey!, expediteTo: "2026-10-05" }
        ]
      })
    ).toEqual([
      {
        itemId: "item-1",
        locationId: "loc-1",
        planningSegmentId: "",
        type: "Expedite",
        periodId: "p1",
        suggestedQuantity: 20,
        suggestedDate: "2026-10-05",
        horizonDate: "2026-10-05",
        latestOrderDate: null,
        isASAP: false,
        purchaseOrderLineId: null,
        jobId: null,
        plannedOrderId: "plo-new",
        requiresManualAction: false,
        supplierId: null,
        policyName: null,
        reason: expect.any(String),
        triggerValues: null
      }
    ]);
  });

  // A Firm order may share the new order's natural key (only Planned rows are
  // unique on it); the Expedite is still the new order's 20, not the Firm 9.
  it("sizes a fence Expedite by the new order, not a Firm order on its key", () => {
    const firm = { ...order, suggestedQuantity: 9, plannedOrderId: "plo-firm" };
    const [expedite] = base({
      signals: [
        { naturalKey: order.plannedOrderKey!, expediteTo: "2026-10-05" }
      ],
      newSupplyByRow: new Map([
        [itemLocationSegmentKey("item-1", "loc-1"), [order, firm]]
      ])
    });
    expect([expedite?.plannedOrderId, expedite?.suggestedQuantity]).toEqual([
      "plo-new",
      20
    ]);
  });

  // A held order with no demand has no planning row; its Cancel still goes out.
  it("raises a held order's Cancel with no planning row, and drops one on an order not held", () => {
    expect(
      base({
        changeActions: [cancel, { ...cancel, plannedOrderId: "plo-other" }]
      })
    ).toEqual([cancel]);
  });

  // The engine plans past the worklist's weeks: a Firm order due after the
  // last one still gets its Cancel, in the last week, with its own date.
  it("puts a held order's action due after the last week in the last week", () => {
    const late = {
      ...cancel,
      periodId: "p60",
      suggestedDate: "2027-11-01",
      horizonDate: "2027-11-01"
    };
    expect(base({ changeActions: [late] })).toEqual([
      { ...late, periodId: "p5" }
    ]);
  });

  it("keeps one action per planned order: a Cancel beats an Expedite", () => {
    const expedite = { ...cancel, type: "Expedite" as const };
    const decrease = { ...cancel, type: "Decrease" as const };
    const order = { ...cancel, type: "Make" as const, plannedOrderId: null };
    expect(onePerPlannedOrder([expedite, order, cancel, decrease])).toEqual([
      order,
      cancel
    ]);
  });
});
