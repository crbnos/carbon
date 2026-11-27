// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildOpenSupplyOrders,
  earlierRelease,
  isCommittedJobStatus,
  isCommittedPurchaseOrderStatus,
  itemLocationSegmentKey,
  type OpenProductionOrderRow,
  type OpenPurchaseOrderLineRow,
  releaseByDate
} from "./open-supply-orders";

const TODAY = "2026-10-06";
const KEY = itemLocationSegmentKey("itm_1", "loc_1");

function poLine(
  overrides: Partial<OpenPurchaseOrderLineRow> = {}
): OpenPurchaseOrderLineRow {
  return {
    id: "pol_1",
    purchaseOrderId: "po_1",
    itemId: "itm_1",
    locationId: "loc_1",
    planningSegmentId: "",
    status: "Planned",
    quantityToReceive: 10,
    promisedDate: null,
    dueDate: "2026-10-20",
    orderDate: null,
    leadTime: 7,
    supplierId: "sup_1",
    ...overrides
  };
}

function job(
  overrides: Partial<OpenProductionOrderRow> = {}
): OpenProductionOrderRow {
  return {
    id: "job_1",
    itemId: "itm_1",
    locationId: "loc_1",
    planningSegmentId: "",
    quantityToReceive: 84,
    dueDate: "2026-10-20",
    deadlineType: "Hard Deadline",
    leadTime: 5,
    ...overrides
  };
}

function build(
  overrides: Partial<Parameters<typeof buildOpenSupplyOrders>[0]> = {}
) {
  return buildOpenSupplyOrders({
    poLineRows: [],
    jobRows: [],
    jobDetailsById: new Map(),
    conversionFactorByLineId: new Map(),
    todayDate: TODAY,
    ...overrides
  });
}

describe("buildOpenSupplyOrders", () => {
  it("gives every line of a Planned purchase order the release of the line needed first", () => {
    // line 1: due 10-20, lead 7 → release 10-12; line 2: due 10-15, lead 3 → 10-11
    const shared = { date: "2026-10-11", dueDate: "2026-10-15", leadTime: 3 };
    const result = build({
      poLineRows: [
        poLine(),
        poLine({
          id: "pol_2",
          dueDate: "2026-10-15",
          leadTime: 3,
          quantityToReceive: 4
        })
      ],
      conversionFactorByLineId: new Map([["pol_2", 12]])
    });

    expect([...result.keys()]).toEqual([KEY]);
    expect(result.get(KEY)).toEqual([
      {
        purchaseOrderLineId: "pol_1",
        quantity: 10,
        dueDate: "2026-10-20",
        requiresManualAction: false,
        dateIsPromised: false,
        supplierId: "sup_1",
        conversionFactor: 1,
        release: shared
      },
      {
        purchaseOrderLineId: "pol_2",
        quantity: 4,
        dueDate: "2026-10-15",
        requiresManualAction: false,
        dateIsPromised: false,
        supplierId: "sup_1",
        conversionFactor: 12,
        release: shared
      }
    ]);
  });

  it("marks a line of a sent purchase order for manual action, with no release", () => {
    const result = build({
      poLineRows: [poLine({ status: "To Receive", promisedDate: "2026-10-22" })]
    });

    expect(result.get(KEY)).toEqual([
      {
        purchaseOrderLineId: "pol_1",
        quantity: 10,
        dueDate: "2026-10-22",
        requiresManualAction: true,
        dateIsPromised: true,
        supplierId: "sup_1",
        conversionFactor: 1,
        release: null
      }
    ]);
  });

  it("takes a job's good units from the view and its Release from its status", () => {
    // the view reports good units left to receive (no scrap allowance)
    const result = build({
      jobRows: [job({ quantityToReceive: 70 })],
      jobDetailsById: new Map([["job_1", { status: "Planned" }]])
    });

    expect(result.get(KEY)).toEqual([
      {
        jobId: "job_1",
        quantity: 70,
        dueDate: "2026-10-20",
        requiresManualAction: false,
        // due 10-20, lead 5 → release 10-14
        release: { date: "2026-10-14", dueDate: "2026-10-20", leadTime: 5 }
      }
    ]);
  });
});

describe("commitment gates", () => {
  it("PO: Draft and Planned are NOT committed; sent statuses are", () => {
    expect(isCommittedPurchaseOrderStatus("Draft")).toBe(false);
    expect(isCommittedPurchaseOrderStatus("Planned")).toBe(false);
    for (const status of [
      "To Receive",
      "To Receive and Invoice",
      "To Invoice",
      "Completed",
      "Closed"
    ] as const) {
      expect(isCommittedPurchaseOrderStatus(status)).toBe(true);
    }
  });

  it("job: Ready and later are committed; Draft/Planned are not", () => {
    expect(isCommittedJobStatus("Draft")).toBe(false);
    expect(isCommittedJobStatus("Planned")).toBe(false);
    expect(isCommittedJobStatus("Ready")).toBe(true);
    expect(isCommittedJobStatus("In Progress")).toBe(true);
    expect(isCommittedJobStatus("Paused")).toBe(true);
  });
});

describe("releaseByDate", () => {
  it("is the day before the due date less the lead time", () => {
    // due in 8 days with a 7-day lead time: release today
    expect(releaseByDate("2026-10-14", 7)).toBe("2026-10-06");
  });

  it("is the day before the due date with no lead time", () => {
    expect(releaseByDate("2026-10-14", 0)).toBe("2026-10-13");
  });
});

describe("earlierRelease", () => {
  const release = (date: string) => ({ date, dueDate: date, leadTime: 0 });

  it("keeps the release that comes first, whichever is passed first", () => {
    expect(
      earlierRelease(release("2026-10-08"), release("2026-10-12")).date
    ).toBe("2026-10-08");
    expect(
      earlierRelease(release("2026-10-12"), release("2026-10-08")).date
    ).toBe("2026-10-08");
    expect(earlierRelease(null, release("2026-10-12")).date).toBe("2026-10-12");
  });
});
