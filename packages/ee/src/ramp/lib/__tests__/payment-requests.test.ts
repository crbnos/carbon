// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  paymentRequestInvoiceNumber,
  paymentRequestMemo
} from "../payment-requests";

describe("paymentRequestInvoiceNumber", () => {
  it("suffixes the supplier's number so each Ramp bill is distinct", () => {
    expect(
      paymentRequestInvoiceNumber({
        supplierReference: " INV-7731 ",
        readableId: "APV-000500",
        requestNumber: 1
      })
    ).toBe("INV-7731-R1");
  });

  it("falls back to Carbon's number without a supplier reference", () => {
    expect(
      paymentRequestInvoiceNumber({
        supplierReference: null,
        readableId: "PO-000300",
        requestNumber: 2
      })
    ).toBe("PO-000300-R2");
  });
});

describe("paymentRequestMemo", () => {
  it("names the invoice, its orders and the request", () => {
    expect(
      paymentRequestMemo({
        readableId: "APV-000500",
        purchaseOrderReadableIds: ["PO-000300"],
        requestNumber: 2,
        description: null
      })
    ).toBe("APV-000500 · PO-000300 · request 2");
  });

  it("does not repeat a deposit request's order", () => {
    expect(
      paymentRequestMemo({
        readableId: "PO-000300",
        purchaseOrderReadableIds: ["PO-000300"],
        requestNumber: 1,
        description: "50% deposit"
      })
    ).toBe("PO-000300 · request 1 · 50% deposit");
  });
});
