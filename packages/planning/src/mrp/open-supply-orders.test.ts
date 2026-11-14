// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildOpenSupplyOrders,
  itemLocationSegmentKey,
  type OpenProductionOrderRow,
  type OpenPurchaseOrderLineRow
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

  it("measures a job in good units, not the view's quantity with scrap", () => {
    // view: 80 good + 4 scrap = 84 to receive; 10 received → 70 good units left
    const result = build({
      jobRows: [job()],
      jobDetailsById: new Map([
        [
          "job_1",
          { status: "Planned", quantity: 80, quantityReceivedToInventory: 10 }
        ]
      ])
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
