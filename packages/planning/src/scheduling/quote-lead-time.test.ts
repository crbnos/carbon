import { parseAbsolute } from "@internationalized/date";
import { it } from "vitest";
import {
  buildQuoteSimulation,
  calendarDaysFromNow,
  cloneFiniteContext,
  composeQuoteCause,
  type MaterialAvailability,
  type QuoteMakeMethodRow,
  type QuoteMaterialRow,
  type QuoteOperationRow,
  type QuoteScenarioSignals
} from "./quote-lead-time.ts";
import { assert, assertEquals } from "./test-helpers.ts";
import type { FiniteSchedulingContext } from "./work-center-selector.ts";

const ms = (iso: string) => parseAbsolute(iso, "UTC").toDate().getTime();
const DAY_MS = 24 * 3_600_000;

function makeQuoteOp(
  o: Partial<QuoteOperationRow> & {
    id: string;
    quoteMakeMethodId: string;
    order: number;
  }
): QuoteOperationRow {
  return {
    processId: "proc-1",
    workCenterId: null,
    operationOrder: "After Previous",
    operationType: null,
    description: null,
    setupTime: 1,
    setupUnit: "Total Hours",
    laborTime: 1,
    laborUnit: "Total Hours",
    machineTime: 0,
    machineUnit: "Total Hours",
    operationLeadTime: 0,
    ...o
  };
}

const emptyAvailability = (): MaterialAvailability => ({
  leadTimeDaysByItem: new Map(),
  onHandByItem: new Map()
});

it("a root method with two After Previous ops yields one edge and unscaled quantities", () => {
  const makeMethods: QuoteMakeMethodRow[] = [
    { id: "mm-root", parentMaterialId: null }
  ];
  const operations: QuoteOperationRow[] = [
    makeQuoteOp({ id: "op-1", quoteMakeMethodId: "mm-root", order: 1 }),
    makeQuoteOp({ id: "op-2", quoteMakeMethodId: "mm-root", order: 2 })
  ];

  const sim = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 5,
    makeMethods,
    materials: [],
    operations,
    availability: emptyAvailability(),
    now: 0
  });

  assertEquals(sim.jobId, "quote:ql1:5");
  assertEquals(sim.operations.length, 2);
  for (const op of sim.operations) {
    assertEquals(op.operationQuantity, 5);
  }
  assertEquals(sim.dependencies.length, 1);
  assertEquals(sim.dependencies[0]?.operationId, "op-2");
  assertEquals(sim.dependencies[0]?.dependsOnId, "op-1");
});

it("a sub-assembly scales child quantities and links to the consuming op", () => {
  const makeMethods: QuoteMakeMethodRow[] = [
    { id: "mm-root", parentMaterialId: null },
    { id: "mm-child", parentMaterialId: "mat-sub" }
  ];
  const materials: QuoteMaterialRow[] = [
    {
      id: "mat-sub",
      quoteMakeMethodId: "mm-root",
      itemId: "item-sub",
      itemReadableId: "SUB-1",
      methodType: "Make to Order",
      quantity: 2,
      quoteOperationId: "op-root-2"
    }
  ];
  const operations: QuoteOperationRow[] = [
    makeQuoteOp({ id: "op-root-1", quoteMakeMethodId: "mm-root", order: 1 }),
    makeQuoteOp({ id: "op-root-2", quoteMakeMethodId: "mm-root", order: 2 }),
    makeQuoteOp({ id: "op-child-1", quoteMakeMethodId: "mm-child", order: 1 }),
    makeQuoteOp({ id: "op-child-2", quoteMakeMethodId: "mm-child", order: 2 })
  ];

  const sim = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 5,
    makeMethods,
    materials,
    operations,
    availability: emptyAvailability(),
    now: 0
  });

  const byId = new Map(sim.operations.map((op) => [op.id, op]));
  assertEquals(byId.get("op-root-1")?.operationQuantity, 5);
  assertEquals(byId.get("op-child-1")?.operationQuantity, 10);
  assertEquals(byId.get("op-child-2")?.operationQuantity, 10);

  // The consuming op (op-root-2) depends on the child's last op (op-child-2).
  const assembly = sim.dependencies.find(
    (d) => d.operationId === "op-root-2" && d.dependsOnId === "op-child-2"
  );
  assert(assembly);
});

it("a sub-assembly material with no consuming op links to the parent's first op", () => {
  const makeMethods: QuoteMakeMethodRow[] = [
    { id: "mm-root", parentMaterialId: null },
    { id: "mm-child", parentMaterialId: "mat-sub" }
  ];
  const materials: QuoteMaterialRow[] = [
    {
      id: "mat-sub",
      quoteMakeMethodId: "mm-root",
      itemId: "item-sub",
      itemReadableId: "SUB-1",
      methodType: "Make to Order",
      quantity: 1,
      quoteOperationId: null
    }
  ];
  const operations: QuoteOperationRow[] = [
    makeQuoteOp({ id: "op-root-1", quoteMakeMethodId: "mm-root", order: 1 }),
    makeQuoteOp({ id: "op-root-2", quoteMakeMethodId: "mm-root", order: 2 }),
    makeQuoteOp({ id: "op-child-1", quoteMakeMethodId: "mm-child", order: 1 })
  ];

  const sim = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 1,
    makeMethods,
    materials,
    operations,
    availability: emptyAvailability(),
    now: 0
  });

  const assembly = sim.dependencies.find(
    (d) => d.operationId === "op-root-1" && d.dependsOnId === "op-child-1"
  );
  assert(assembly);
});

it("a Purchase to Order material floors its consuming op at now + lead time", () => {
  const now = ms("2026-01-05T00:00:00.000Z");
  const makeMethods: QuoteMakeMethodRow[] = [
    { id: "mm-root", parentMaterialId: null }
  ];
  const materials: QuoteMaterialRow[] = [
    {
      id: "mat-p",
      quoteMakeMethodId: "mm-root",
      itemId: "item-p",
      itemReadableId: "PUR-1",
      methodType: "Purchase to Order",
      quantity: 1,
      quoteOperationId: "op-1"
    }
  ];
  const operations: QuoteOperationRow[] = [
    makeQuoteOp({ id: "op-1", quoteMakeMethodId: "mm-root", order: 1 })
  ];

  const sim = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 1,
    makeMethods,
    materials,
    operations,
    availability: {
      leadTimeDaysByItem: new Map([["item-p", 10]]),
      onHandByItem: new Map()
    },
    now
  });

  assertEquals(sim.materialReadyDays, 10);
  assertEquals(sim.operations[0]?.materialReadyAt, now + 10 * DAY_MS);
});

it("a Pull from Inventory material floors only when on-hand is short", () => {
  const now = ms("2026-01-05T00:00:00.000Z");
  const makeMethods: QuoteMakeMethodRow[] = [
    { id: "mm-root", parentMaterialId: null }
  ];
  const operations: QuoteOperationRow[] = [
    makeQuoteOp({ id: "op-1", quoteMakeMethodId: "mm-root", order: 1 })
  ];
  const material: QuoteMaterialRow = {
    id: "mat-s",
    quoteMakeMethodId: "mm-root",
    itemId: "item-s",
    itemReadableId: "STK-1",
    methodType: "Pull from Inventory",
    quantity: 1,
    quoteOperationId: "op-1"
  };

  // On-hand >= required (1) → no floor.
  const stocked = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 1,
    makeMethods,
    materials: [material],
    operations,
    availability: {
      leadTimeDaysByItem: new Map([["item-s", 3]]),
      onHandByItem: new Map([["item-s", 5]])
    },
    now
  });
  assertEquals(stocked.materialReadyDays, 0);
  assertEquals(stocked.operations[0]?.materialReadyAt, undefined);

  // On-hand below required → floor at the item lead time.
  const short = buildQuoteSimulation({
    quoteLineId: "ql1",
    quantity: 1,
    makeMethods,
    materials: [material],
    operations,
    availability: {
      leadTimeDaysByItem: new Map([["item-s", 3]]),
      onHandByItem: new Map([["item-s", 0]])
    },
    now
  });
  assertEquals(short.materialReadyDays, 3);
  assertEquals(short.operations[0]?.materialReadyAt, now + 3 * DAY_MS);
});

it("cloneFiniteContext isolates reservation arrays from the original", () => {
  const baseCtx: FiniteSchedulingContext = {
    capacityByWorkCenter: new Map([
      [
        "wc1",
        {
          workCenter: { id: "wc1" },
          windows: [],
          reservations: [{ startAt: 1, endAt: 2 }]
        }
      ]
    ]),
    requirementByProcess: new Map(),
    employeesByAbility: new Map(),
    reservationsByEmployee: new Map([["e1", [{ startAt: 1, endAt: 2 }]]]),
    dependencies: [],
    now: 0,
    horizonDays: 365,
    windowsEnd: 0,
    peopleByWorkCenter: new Map(),
    assignmentsByEmployee: new Map(),
    requiresStaffing: false,
    peopleBudgets: new Map(),
    windowsByEmployee: new Map(),
    timeZone: "UTC",
    operationsWithEvents: new Set<string>()
  };

  const clone = cloneFiniteContext(baseCtx);
  clone.capacityByWorkCenter.get("wc1")!.reservations.push({
    startAt: 3,
    endAt: 4
  });
  clone.reservationsByEmployee.get("e1")!.push({ startAt: 3, endAt: 4 });

  assertEquals(baseCtx.capacityByWorkCenter.get("wc1")!.reservations.length, 1);
  assertEquals(baseCtx.reservationsByEmployee.get("e1")!.length, 1);
  assertEquals(clone.capacityByWorkCenter.get("wc1")!.reservations.length, 2);
  assertEquals(clone.reservationsByEmployee.get("e1")!.length, 2);
});

it("calendarDaysFromNow counts local calendar days, minimum 1", () => {
  const tz = "America/New_York";
  // Same local day (both 2026-01-06 in NY, though the finish is the next UTC
  // day) → 1. Proves the day count resolves in the location tz, not UTC.
  const nowSame = ms("2026-01-06T13:00:00.000Z"); // 2026-01-06 08:00 NY
  const finishSame = ms("2026-01-07T01:00:00.000Z"); // 2026-01-06 20:00 NY
  assertEquals(calendarDaysFromNow(finishSame, nowSame, tz), 1);

  // Two local days ahead → 2.
  const finishTwo = ms("2026-01-08T13:00:00.000Z"); // 2026-01-08 08:00 NY
  assertEquals(calendarDaysFromNow(finishTwo, nowSame, tz), 2);

  // Finish 23:30 NY vs now 00:30 the NEXT NY day (finish is earlier) → clamped
  // to 1, never 0 or negative.
  const finishLate = ms("2026-01-07T04:30:00.000Z"); // 2026-01-06 23:30 NY
  const nowNext = ms("2026-01-07T05:30:00.000Z"); // 2026-01-07 00:30 NY
  assertEquals(calendarDaysFromNow(finishLate, nowNext, tz), 1);
});

const signals = (
  o: Partial<QuoteScenarioSignals> = {}
): QuoteScenarioSignals => ({
  conflict: null,
  queueNote: null,
  bottleneckWorkCenter: null,
  bottleneckOperationCount: 0,
  ...o
});

it("composeQuoteCause: a conflict wins outright", () => {
  const cause = composeQuoteCause({
    scenario: "queued",
    materialDays: 60,
    materialItem: "GBX-80",
    ownProductionDays: 150,
    queueRemovableDays: 0,
    signals: signals({ conflict: "No qualified operator" })
  });
  assertEquals(cause, "No qualified operator");
});

it("composeQuoteCause: production volume dominates → names the bottleneck WC", () => {
  // qty 50 shape: 60d material, 300d own work, no removable queue → production.
  const cause = composeQuoteCause({
    scenario: "queued",
    materialDays: 60,
    materialItem: "GBX-80",
    ownProductionDays: 300,
    queueRemovableDays: 0,
    signals: signals({
      bottleneckWorkCenter: "5-Axis Mill",
      bottleneckOperationCount: 8,
      queueNote: "Waited 2d for the work center"
    })
  });
  assert(cause?.includes("5-Axis Mill"));
  assert(cause?.includes("8 operations"));
});

it("composeQuoteCause: material dominates → names the gating item", () => {
  const cause = composeQuoteCause({
    scenario: "bestCase",
    materialDays: 60,
    materialItem: "GBX-80",
    ownProductionDays: 5,
    queueRemovableDays: 0,
    signals: signals({ bottleneckWorkCenter: "5-Axis Mill" })
  });
  assertEquals(cause, "Gated by material — GBX-80 lead time is 60 days");
});

it("composeQuoteCause: queue dominates only in the queued scenario", () => {
  const args = {
    materialDays: 0,
    materialItem: null,
    ownProductionDays: 10,
    queueRemovableDays: 14,
    signals: signals({
      queueNote: "Queued behind J000001 (4 ops)",
      bottleneckWorkCenter: "Lathe",
      bottleneckOperationCount: 2
    })
  };
  // Queued: removable queue (14) beats own production (10) → the queue note.
  assertEquals(
    composeQuoteCause({ scenario: "queued", ...args }),
    "Queued behind J000001 (4 ops)"
  );
  // Best case: no queue component, so production wins instead.
  const best = composeQuoteCause({ scenario: "bestCase", ...args });
  assert(best?.includes("Lathe"));
});
