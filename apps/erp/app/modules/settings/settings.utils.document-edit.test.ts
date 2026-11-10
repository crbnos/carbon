// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { documentEditPermissions } from "./settings.utils";

describe("documentEditPermissions", () => {
  it("asks Edit on the page that owns each document's record", () => {
    expect(documentEditPermissions).toEqual({
      purchaseOrder: { "purchasing.purchaseOrders": "Edit" },
      purchaseReturnOrder: { "purchasing.returns": "Edit" },
      purchasingRfq: { "purchasing.rfqs": "Edit" },
      quote: { "sales.quotes": "Edit" },
      salesOrder: { "sales.salesOrders": "Edit" },
      salesReturnOrder: { "sales.returns": "Edit" },
      salesInvoice: { "invoicing.salesInvoices": "Edit" },
      packingSlip: { "inventory.shipments": "Edit" },
      stockTransfer: { "inventory.stockTransfers": "Edit" },
      jobTraveler: { "production.jobs": "Edit" },
      issue: { "quality.issues": "Edit" }
    });
  });
});
