// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { describe, expect, it } from "vitest";
import { getLineDescription as getQuoteLineDescription } from "./quote";
import { getLineDescription as getInvoiceLineDescription } from "./sales-invoice";
import {
  getLineDescription as getOrderLineDescription,
  getLineDescriptionDetails as getOrderLineDetails
} from "./sales-order";

type QuoteLine = Database["public"]["Views"]["quoteLines"]["Row"];
type OrderLine = Database["public"]["Views"]["salesOrderLines"]["Row"];
type InvoiceLine = Database["public"]["Views"]["salesInvoiceLines"]["Row"];

const orderLine = (overrides: Partial<OrderLine>) =>
  ({
    salesOrderLineType: "Part",
    itemReadableId: "P000123.B",
    ...overrides
  }) as OrderLine;

describe("sales order line part numbers", () => {
  it("prints the line's copy, not the live cross-reference", () => {
    expect(
      getOrderLineDescription(
        orderLine({
          customerPartId: "C-100",
          customerPartRevision: "3",
          customerPartIdFromCustomer: "C-101",
          customerPartRevisionFromCustomer: "4",
          partNumberDisplay: "Ours First"
        })
      )
    ).toBe("P000123.B (C-100 Rev 3)");
  });

  it("prints the live cross-reference when the line has no copy", () => {
    expect(
      getOrderLineDescription(
        orderLine({
          customerPartId: null,
          customerPartRevision: null,
          customerPartIdFromCustomer: "C-101",
          customerPartRevisionFromCustomer: "4",
          partNumberDisplay: null
        })
      )
    ).toBe("P000123.B (C-101 Rev 4)");
  });

  it("never prints the customer part number in the details", () => {
    const details = getOrderLineDetails(
      orderLine({
        description: "Bracket",
        customerPartId: "C-100",
        customerPartRevision: "3",
        customerPartIdFromCustomer: "C-101"
      })
    );
    expect(details).toBe("Bracket");
    expect(details).not.toContain("C-10");
  });
});

describe("quote line part numbers", () => {
  it("prints no space before the bracket when theirs has no revision", () => {
    expect(
      getQuoteLineDescription({
        itemReadableId: "P000123.B",
        customerPartId: "C-200",
        customerPartRevision: null,
        partNumberDisplay: null
      } as QuoteLine)
    ).toBe("P000123.B (C-200)");
  });

  it("prints a legacy line as before: ours, then the customer's with its revision", () => {
    expect(
      getQuoteLineDescription({
        itemReadableId: "P000123.B",
        customerPartId: "C-100",
        customerPartRevision: "3",
        partNumberDisplay: null
      } as QuoteLine)
    ).toBe("P000123.B (C-100 Rev 3)");
  });
});

describe("sales invoice line part numbers", () => {
  it("prints a legacy line as before: our part number only", () => {
    expect(
      getInvoiceLineDescription({
        invoiceLineType: "Part",
        itemId: "item_1",
        itemReadableId: "P000123.B",
        customerPartId: "C-100",
        customerPartRevision: "3",
        partNumberDisplay: null
      } as InvoiceLine)
    ).toBe("P000123.B");
  });

  it("prints the modal's draft over the line's choice", () => {
    expect(
      getInvoiceLineDescription(
        {
          invoiceLineType: "Part",
          itemId: "item_1",
          itemReadableId: "P000123.B",
          customerPartId: "C-100",
          customerPartRevision: "3",
          partNumberDisplay: "Theirs Only"
        } as InvoiceLine,
        "Ours Only"
      )
    ).toBe("P000123.B");
  });
});
