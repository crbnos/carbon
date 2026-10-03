// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ProductionEvent } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import {
  availableWorkTypes,
  closedDurations,
  eventIdsFrom,
  needsUnit,
  openEvents,
  parentTrackingType,
  parseQuantity,
  remainingQuantity,
  reportTargetFor,
  trackingFields,
  untrackedIssueBody
} from "./logic";
import { elapsedSince, formatElapsed } from "./useTimer";

/**
 * The decisions on this screen that are worth pinning, all of them pure
 * functions over plain values.
 *
 * Each one is here because getting it wrong is silent: a work type that is
 * offered when the operation plans no time for it, a quantity field that
 * accepts "1e3", an elapsed timer that counts a closed event twice. None of
 * those throw — they just report the wrong thing, and what they report becomes
 * an operator's hours or a job's cost.
 */

const event = (over: Partial<ProductionEvent>): ProductionEvent => ({
  id: "evt",
  type: "Labor",
  startTime: "2026-10-02T08:00:00.000Z",
  ...over
});

describe("availableWorkTypes", () => {
  it("offers only the types the operation plans time for", () => {
    expect(
      availableWorkTypes({
        id: "op",
        setupDuration: 0,
        laborDuration: 3_600_000,
        machineDuration: 0
      })
    ).toEqual(["Labor"]);

    expect(
      availableWorkTypes({
        id: "op",
        setupDuration: 600_000,
        laborDuration: 3_600_000,
        machineDuration: 1_800_000
      })
    ).toEqual(["Setup", "Labor", "Machine"]);
  });

  it("still offers Labor when the operation plans no time at all", () => {
    // A dock with nothing to press would strand the operator, so this is a
    // deliberate fallback rather than an empty list. It matches the web.
    expect(availableWorkTypes({ id: "op" })).toEqual(["Labor"]);
  });
});

describe("openEvents", () => {
  it("picks the one open event of each type and ignores closed ones", () => {
    const open = openEvents([
      event({ id: "a", type: "Setup", endTime: "2026-10-02T08:30:00.000Z" }),
      event({ id: "b", type: "Labor" }),
      event({ id: "c", type: "Machine", endTime: null })
    ]);
    expect(open.Setup).toBeUndefined();
    expect(open.Labor?.id).toBe("b");
    // `endTime: null` is open — the column is nullable, and treating null as
    // "ended" would show Start for a timer that is actually running.
    expect(open.Machine?.id).toBe("c");
  });
});

describe("closedDurations", () => {
  it("banks only ended events, using the server's stored duration", () => {
    const totals = closedDurations([
      event({ type: "Labor", endTime: "x", duration: 1000 }),
      event({ type: "Labor", endTime: "x", duration: 2000 }),
      // Open: its time is still ticking and belongs to the live timer, not
      // the banked total, or the two would be added together.
      event({ type: "Labor", duration: 9999 }),
      event({ type: "Setup", endTime: "x", duration: 500 }),
      // A closed event the server stored no duration for contributes nothing
      // rather than NaN, which would blank the whole row.
      event({ type: "Machine", endTime: "x", duration: null })
    ]);
    expect(totals).toEqual({ Labor: 3000, Setup: 500, Machine: 0 });
  });
});

describe("formatElapsed", () => {
  it("is zero-padded hh:mm:ss with uncapped hours", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
    expect(formatElapsed(1_000)).toBe("00:00:01");
    expect(formatElapsed(61_000)).toBe("00:01:01");
    expect(formatElapsed(3_600_000)).toBe("01:00:00");
    // A timer left running over a weekend must read as hours, not wrap to
    // zero the way a %24 would.
    expect(formatElapsed(108_000_000)).toBe("30:00:00");
  });

  it("truncates rather than rounding up to a second that has not passed", () => {
    expect(formatElapsed(1_999)).toBe("00:00:01");
  });
});

describe("elapsedSince", () => {
  it("floors a start time in the future at zero", () => {
    // A device clock behind the server's produces a negative elapsed;
    // "-00:00:14" reads as a bug, zero reads as "it just started".
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(elapsedSince(future)).toBe(0);
  });

  it("returns zero for an unparseable instant instead of throwing", () => {
    // The alternative is a screen that crashes on one malformed row.
    expect(elapsedSince("not a time")).toBe(0);
  });

  it("measures a past instant", () => {
    const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
    const elapsed = elapsedSince(tenSecondsAgo);
    expect(elapsed).toBeGreaterThanOrEqual(9_000);
    expect(elapsed).toBeLessThan(12_000);
  });
});

describe("remainingQuantity", () => {
  it("is the shortfall, floored at zero", () => {
    expect(
      remainingQuantity({ operationQuantity: 40, quantityComplete: 12 })
    ).toBe(28);
    // Over-reporting happens (a batch that yielded more than planned). A
    // negative "remaining" would render as "-5 remaining" under the keypad.
    expect(
      remainingQuantity({ operationQuantity: 40, quantityComplete: 45 })
    ).toBe(0);
    expect(remainingQuantity({})).toBe(0);
  });
});

describe("reportTargetFor", () => {
  const detail = (over: Record<string, unknown>) =>
    ({
      operation: { id: "op", operationQuantity: 10, quantityComplete: 3 },
      job: {},
      events: [],
      quantities: { scrap: 0, production: 0, rework: 0 },
      batch: null,
      isFirstOperation: true,
      ...over
    }) as Parameters<typeof reportTargetFor>[0];

  it("names the parent's tracking, serial before batch", () => {
    expect(parentTrackingType({ requiresSerialTracking: true })).toBe("Serial");
    expect(parentTrackingType({ requiresBatchTracking: true })).toBe("Batch");
    expect(
      parentTrackingType({
        requiresSerialTracking: true,
        requiresBatchTracking: true
      })
    ).toBe("Serial");
    expect(parentTrackingType({})).toBeUndefined();
    expect(parentTrackingType(null)).toBeUndefined();
  });

  it("carries the unit and the tracking type for a serial parent", () => {
    // Without `trackingType` the server takes the untracked branch: the
    // serial is never completed, no next unit is minted, no label prints.
    const target = reportTargetFor(
      detail({
        trackedEntityId: "te_1",
        jobMakeMethod: { requiresSerialTracking: true }
      })
    );
    expect(trackingFields(target)).toEqual({
      trackedEntityId: "te_1",
      trackingType: "Serial"
    });
    expect(needsUnit(target)).toBe(false);
  });

  it("does not send an untracked job's stray entity", () => {
    // An untracked make method can still carry an inventory entity. It is not
    // the thing being built, and web's QuantityModal does not send it either.
    const target = reportTargetFor(
      detail({ trackedEntityId: "te_stray", jobMakeMethod: {} })
    );
    expect(trackingFields(target)).toEqual({
      trackedEntityId: undefined,
      trackingType: undefined
    });
  });

  it("treats a payload with no make method as untracked", () => {
    // An older server does not send `jobMakeMethod` at all.
    expect(reportTargetFor(detail({})).trackingType).toBeUndefined();
  });

  it("asks for a unit before a serial parent can be reported", () => {
    const noUnit = reportTargetFor(
      detail({ jobMakeMethod: { requiresSerialTracking: true } })
    );
    expect(needsUnit(noUnit)).toBe(true);
    // A batch reports against the lot the server resolves; no unit to choose.
    expect(
      needsUnit(
        reportTargetFor(
          detail({ jobMakeMethod: { requiresBatchTracking: true } })
        )
      )
    ).toBe(false);
  });
});

describe("parseQuantity", () => {
  it("accepts what an operator can type on a decimal pad", () => {
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity(" 7 ")).toBe(7);
    expect(parseQuantity("0.75")).toBe(0.75);
    // Five decimals is the quantity kind's scale; nothing may round it away.
    expect(parseQuantity("0.00125")).toBe(0.00125);
  });

  it("rejects everything that is not a positive decimal", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-3")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
    // `Number()` would accept all three of these. A quantity field that
    // silently reads "0x10" as 16 is worse than one that refuses it.
    expect(parseQuantity("0x10")).toBeNull();
    expect(parseQuantity("1e3")).toBeNull();
    expect(parseQuantity(" ")).toBeNull();
  });
});

describe("eventIdsFrom", () => {
  it("carries each open event's id under its own field", () => {
    expect(
      eventIdsFrom({
        Setup: event({ id: "s", type: "Setup" }),
        Labor: undefined,
        Machine: event({ id: "m", type: "Machine" })
      })
    ).toEqual({
      setupProductionEventId: "s",
      laborProductionEventId: undefined,
      machineProductionEventId: "m"
    });
  });
});

describe("untrackedIssueBody", () => {
  it("issues with a NEGATIVE adjustment", () => {
    // Inventory's point of view: an issue takes stock out. `Positive Adjmt.`
    // is the return — it puts stock back and LOWERS `quantityIssued` — and
    // this app once sent it for every issue.
    expect(
      untrackedIssueBody({ itemId: "item_1", materialId: "jm_1", quantity: 2 })
    ).toEqual({
      itemId: "item_1",
      materialId: "jm_1",
      quantity: 2,
      adjustmentType: "Negative Adjmt."
    });
  });

  it("scopes an unplanned part to its step, and only then", () => {
    expect(
      untrackedIssueBody({
        itemId: "item_1",
        materialId: null,
        quantity: 1,
        jobOperationStepId: "step_1"
      })
    ).toEqual({
      itemId: "item_1",
      materialId: undefined,
      quantity: 1,
      adjustmentType: "Negative Adjmt.",
      jobOperationStepId: "step_1"
    });
    expect(
      untrackedIssueBody({ itemId: "item_1", quantity: 1 })
    ).not.toHaveProperty("jobOperationStepId");
  });
});
