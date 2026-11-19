// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type {
  SalesInvoicePostCheckLine,
  SalesInvoicePostFacts
} from "./invoicing.utils";
import {
  salesInvoiceLineAmounts,
  salesInvoicePostChecks
} from "./invoicing.utils";

const line = (
  overrides: Partial<SalesInvoicePostCheckLine> = {}
): SalesInvoicePostCheckLine => ({
  id: "line-1",
  invoiceLineType: "Part",
  quantity: 10,
  unitPrice: 8,
  salesOrderId: null,
  salesOrderLineId: null,
  addOnCost: 0,
  nonTaxableAddOnCost: 0,
  shippingCost: 0,
  ...overrides
});

type OrderLineFacts = SalesInvoicePostFacts["orderLines"][number];

const orderLine = (
  overrides: Partial<Omit<OrderLineFacts, "charges">> & {
    addOn?: { charge: number; billed: number };
    shipping?: { charge: number; billed: number };
  } = {}
): OrderLineFacts => {
  const { addOn, shipping, ...rest } = overrides;
  return {
    salesOrderLineId: "sol-1",
    unitPrice: 8,
    orderedQuantity: 100,
    remainingQuantity: 100,
    unpostedQuantity: 0,
    otherInvoices: 0,
    billedByContract: false,
    charges: {
      addOnCost: addOn ?? { charge: 0, billed: 0 },
      nonTaxableAddOnCost: { charge: 0, billed: 0 },
      shippingCost: shipping ?? { charge: 0, billed: 0 }
    },
    ...rest
  };
};

const facts = (
  overrides: Partial<SalesInvoicePostFacts> = {}
): SalesInvoicePostFacts => ({
  orderLines: [],
  orders: [],
  currentExchangeRate: 1,
  ...overrides
});

const checks = (
  overrides: Partial<Parameters<typeof salesInvoicePostChecks>[0]> = {}
) =>
  salesInvoicePostChecks({
    lines: [line()],
    shippingCost: 0,
    currencyCode: "USD",
    exchangeRate: 1,
    baseCurrencyCode: "USD",
    decimals: 2,
    facts: null,
    ...overrides
  });

describe("salesInvoiceLineAmounts", () => {
  it("taxes merchandise, add-ons and line shipping, not the non-taxable add-on", () => {
    // 10 × $8 = 80, + 5 add-on + 15 shipping = 100 taxable; 10% = 10;
    // + 2 non-taxable add-on → subtotal 102, total 112.
    const amounts = salesInvoiceLineAmounts({
      quantity: 10,
      netUnitPrice: 8,
      convertedNetUnitPrice: 16,
      addOnCost: 5,
      convertedAddOnCost: 10,
      nonTaxableAddOnCost: 2,
      convertedNonTaxableAddOnCost: 4,
      shippingCost: 15,
      convertedShippingCost: 30,
      taxPercent: 0.1
    });

    expect(amounts).toMatchObject({
      merchandise: 80,
      subtotal: 102,
      tax: 10,
      total: 112,
      customerMerchandise: 160,
      customerSubtotal: 204,
      customerTax: 20,
      customerTotal: 224
    });
  });
});

describe("salesInvoicePostChecks", () => {
  it("raises nothing on a priced line with no order behind it", () => {
    expect(checks()).toEqual([]);
  });

  it("raises nothing for $0 shipping when the order has none to bill", () => {
    // Free and buyer-paid freight are normal; only a charge the order holds
    // is a mistake.
    expect(
      checks({
        lines: [line({ salesOrderId: "so-1", salesOrderLineId: "sol-1" })],
        facts: facts({
          orderLines: [orderLine()],
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 0 }
          ]
        })
      })
    ).toEqual([]);
  });

  it("never flags a Comment line", () => {
    expect(
      checks({
        lines: [line({ invoiceLineType: "Comment", quantity: 0, unitPrice: 0 })]
      })
    ).toEqual([]);
  });

  it("flags a $0 unit price even when an add-on gives the line an amount", () => {
    expect(checks({ lines: [line({ unitPrice: 0, addOnCost: 20 })] })).toEqual([
      { type: "noPrice", lineId: "line-1" }
    ]);
  });

  it("flags a $0 price on an order line the order priced", () => {
    // The order line is $8; the invoice line was zeroed.
    expect(
      checks({
        lines: [
          line({
            unitPrice: 0,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ unitPrice: 8 })] })
      })
    ).toEqual([{ type: "noPrice", lineId: "line-1" }]);
  });

  it("does not flag a $0 price the order line also has", () => {
    // A warranty or no-charge line agreed on the order.
    expect(
      checks({
        lines: [
          line({
            unitPrice: 0,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ unitPrice: 0 })] })
      })
    ).toEqual([]);
  });

  it("flags a $0 price when the order line was never priced", () => {
    expect(
      checks({
        lines: [
          line({
            unitPrice: 0,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ unitPrice: null })] })
      })
    ).toEqual([{ type: "noPrice", lineId: "line-1" }]);
  });

  it("does not guess at a $0 order line when the order's facts did not load", () => {
    expect(
      checks({
        lines: [
          line({
            unitPrice: 0,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: null
      })
    ).toEqual([]);
  });

  it("flags a line that bills no quantity, and not as unpriced too", () => {
    expect(checks({ lines: [line({ quantity: 0, unitPrice: 0 })] })).toEqual([
      { type: "noQuantity", lineId: "line-1" }
    ]);
  });

  it("flags billing more than the order line has left to invoice", () => {
    // Ordered 100, 60 invoiced: 40 left, this line bills 50.
    expect(
      checks({
        lines: [
          line({
            quantity: 50,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ remainingQuantity: 40 })] })
      })
    ).toEqual([
      { type: "overInvoiced", lineId: "line-1", remainingQuantity: 40 }
    ]);
  });

  it("counts what another Draft already bills against what is left", () => {
    // 100 left, another Draft bills 100 of it: this one's 100 doubles it.
    expect(
      checks({
        lines: [
          line({
            quantity: 100,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ unpostedQuantity: 100 })] })
      })
    ).toEqual([
      { type: "overInvoiced", lineId: "line-1", remainingQuantity: 0 }
    ]);
  });

  it("flags an order line a contract bills, though the order reads it as left to invoice", () => {
    expect(
      checks({
        lines: [line({ salesOrderId: "so-1", salesOrderLineId: "sol-1" })],
        facts: facts({ orderLines: [orderLine({ billedByContract: true })] })
      })
    ).toEqual([{ type: "billedByContract", lineId: "line-1" }]);
  });

  it("asks only to take a line a contract bills off, not to bill its charges", () => {
    // The order line's $50 add-on is not on the line, but the line should
    // come off the invoice, not bill more.
    expect(
      checks({
        lines: [line({ salesOrderId: "so-1", salesOrderLineId: "sol-1" })],
        facts: facts({
          orderLines: [
            orderLine({
              billedByContract: true,
              addOn: { charge: 50, billed: 0 }
            })
          ]
        })
      })
    ).toEqual([{ type: "billedByContract", lineId: "line-1" }]);
  });

  it("counts the freight on a line a contract bills toward its order's shipping", () => {
    // The order's $60 freight sits on the line: only the contract is wrong.
    expect(
      checks({
        lines: [
          line({
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            shippingCost: 60
          })
        ],
        facts: facts({
          orderLines: [orderLine({ billedByContract: true })],
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([{ type: "billedByContract", lineId: "line-1" }]);
  });

  it("judges two lines of one order line on their sum", () => {
    // 40 left; two lines of 30 bill 60 between them.
    expect(
      checks({
        lines: [
          line({
            id: "line-1",
            quantity: 30,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          }),
          line({
            id: "line-2",
            quantity: 30,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ remainingQuantity: 40 })] })
      })
    ).toEqual([
      { type: "overInvoiced", lineId: "line-1", remainingQuantity: 40 }
    ]);
  });

  it("puts a split order line's warning on the line that bills the quantity", () => {
    // 10 left; a 0 line and a 12 line: the 12 is the one that bills too much.
    expect(
      checks({
        lines: [
          line({
            id: "line-1",
            quantity: 0,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          }),
          line({
            id: "line-2",
            quantity: 12,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({ orderLines: [orderLine({ remainingQuantity: 10 })] })
      })
    ).toEqual([
      { type: "noQuantity", lineId: "line-1" },
      { type: "overInvoiced", lineId: "line-2", remainingQuantity: 10 }
    ]);
  });

  it("lets a partial invoice bill its quantity share of an order line's charges", () => {
    // $100 add-on on 100 ordered; this invoice ships 40 and bills $40 of it.
    expect(
      checks({
        lines: [
          line({
            quantity: 40,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 40
          })
        ],
        facts: facts({
          orderLines: [orderLine({ addOn: { charge: 100, billed: 0 } })]
        })
      })
    ).toEqual([]);
  });

  it("flags an order line charge a partial invoice leaves off", () => {
    // The same 40 of 100 with none of the $100 add-on: $40 is its share.
    expect(
      checks({
        lines: [
          line({
            quantity: 40,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({
          orderLines: [orderLine({ addOn: { charge: 100, billed: 0 } })]
        })
      })
    ).toEqual([{ type: "orderChargesLeftOff", lineId: "line-1", amount: 40 }]);
  });

  it("accepts the share a conversion gave while other converted invoices are still Draft", () => {
    // 3 ordered with a $100 add-on, three 1-unit shipment invoices all Draft:
    // nothing is posted, so this one's share is $33.33, not the rest.
    expect(
      checks({
        lines: [
          line({
            quantity: 1,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 33.33
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              orderedQuantity: 3,
              remainingQuantity: 3,
              unpostedQuantity: 2,
              addOn: { charge: 100, billed: 66.66 }
            })
          ]
        })
      })
    ).toEqual([]);
  });

  it("expects the rest of a charge on the invoice that bills the last of the quantity", () => {
    // 60 of 100 were invoiced with $60 of the add-on; this one bills the
    // last 40 with $30, leaving $10 off.
    expect(
      checks({
        lines: [
          line({
            quantity: 40,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 30
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              remainingQuantity: 40,
              addOn: { charge: 100, billed: 60 }
            })
          ]
        })
      })
    ).toEqual([{ type: "orderChargesLeftOff", lineId: "line-1", amount: 10 }]);
  });

  it("ignores the rounding the other invoices' shares leave", () => {
    // $100 over three 1-unit invoices: two posted at $33.33, this one the
    // last at $33.33 leaves $0.01 that no share could carry.
    expect(
      checks({
        lines: [
          line({
            quantity: 1,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 33.33
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              orderedQuantity: 3,
              remainingQuantity: 1,
              otherInvoices: 2,
              addOn: { charge: 100, billed: 66.66 }
            })
          ]
        })
      })
    ).toEqual([]);
  });

  it("ignores the rounding across several charge fields and many invoices", () => {
    // $10 add-on and $10 line shipping over 3 one-unit invoices converted as
    // Drafts: each got $3.33 + $3.33. Two posted; this last one bills the
    // same shares, leaving $0.01 of each that no share could carry.
    expect(
      checks({
        lines: [
          line({
            quantity: 1,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 3.33,
            shippingCost: 3.33
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              orderedQuantity: 3,
              remainingQuantity: 1,
              otherInvoices: 2,
              addOn: { charge: 10, billed: 6.66 },
              shipping: { charge: 10, billed: 6.66 }
            })
          ]
        })
      })
    ).toEqual([]);
  });

  it("still flags a charge an earlier invoice left off", () => {
    // 60 of 100 posted with none of the $100 add-on; this last 40 bills only
    // its $40 share, so $60 stays unbilled.
    expect(
      checks({
        lines: [
          line({
            quantity: 40,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 40
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              remainingQuantity: 40,
              otherInvoices: 1,
              addOn: { charge: 100, billed: 0 }
            })
          ]
        })
      })
    ).toEqual([{ type: "orderChargesLeftOff", lineId: "line-1", amount: 60 }]);
  });

  it("does not flag the line without the charge when its split twin bills it", () => {
    // 40 left of 100 with a $25 add-on, all of it due on this invoice; line 1
    // carries the $25, line 2 none.
    expect(
      checks({
        lines: [
          line({
            id: "line-1",
            quantity: 20,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: 25
          }),
          line({
            id: "line-2",
            quantity: 20,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              remainingQuantity: 40,
              addOn: { charge: 25, billed: 0 }
            })
          ]
        })
      })
    ).toEqual([]);
  });

  it("does not flag a credit line that takes back a charge", () => {
    expect(
      checks({
        lines: [
          line({
            quantity: -1,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            addOnCost: -10
          })
        ],
        facts: facts({
          orderLines: [
            orderLine({
              remainingQuantity: 0,
              addOn: { charge: 10, billed: 10 }
            })
          ]
        })
      })
    ).toEqual([]);
  });

  it("flags order shipping no invoice bills", () => {
    expect(
      checks({
        lines: [line({ salesOrderId: "so-1", salesOrderLineId: "sol-1" })],
        facts: facts({
          orderLines: [orderLine()],
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([
      {
        type: "orderShippingLeftOff",
        salesOrderReadableId: "SO0001",
        amount: 60
      }
    ]);
  });

  it("does not ask a credit invoice to bill the order's shipping", () => {
    expect(
      checks({
        lines: [
          line({
            quantity: -1,
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1"
          })
        ],
        facts: facts({
          orderLines: [orderLine({ remainingQuantity: 0 })],
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([]);
  });

  it("counts the order's freight billed on a line instead of the Shipping section", () => {
    expect(
      checks({
        lines: [
          line({
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            shippingCost: 60
          })
        ],
        facts: facts({
          orderLines: [orderLine()],
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([]);
  });

  it("counts the invoice's shipping against each order it bills, as the conversion does", () => {
    // $50 of shipping on an invoice billing two orders: each order counts it,
    // so neither is reported (`billedSalesOrderCharges` counts it the same way).
    expect(
      checks({
        lines: [
          line({ id: "line-1", salesOrderId: "so-1" }),
          line({ id: "line-2", salesOrderId: "so-2" })
        ],
        shippingCost: 50,
        facts: facts({
          orders: [
            {
              salesOrderId: "so-1",
              readableId: "SO0001",
              unbilledShipping: 30
            },
            { salesOrderId: "so-2", readableId: "SO0002", unbilledShipping: 40 }
          ]
        })
      })
    ).toEqual([]);
  });

  it("lets freight on one order's line cover only that order", () => {
    // SO0001's line carries $60 of freight beyond its share; SO0002's $60 is
    // still on no invoice.
    expect(
      checks({
        lines: [
          line({
            id: "line-1",
            salesOrderId: "so-1",
            salesOrderLineId: "sol-1",
            shippingCost: 60
          }),
          line({ id: "line-2", salesOrderId: "so-2" })
        ],
        facts: facts({
          orderLines: [orderLine()],
          orders: [
            {
              salesOrderId: "so-1",
              readableId: "SO0001",
              unbilledShipping: 60
            },
            { salesOrderId: "so-2", readableId: "SO0002", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([
      {
        type: "orderShippingLeftOff",
        salesOrderReadableId: "SO0002",
        amount: 60
      }
    ]);
  });

  it("lets freight on an order's line with no order line cover only that order", () => {
    // The SO0001 line carries the order but no order line: its $60 is
    // SO0001's freight, and SO0002's $60 is still on no invoice.
    expect(
      checks({
        lines: [
          line({ id: "line-1", salesOrderId: "so-1", shippingCost: 60 }),
          line({ id: "line-2", salesOrderId: "so-2" })
        ],
        facts: facts({
          orders: [
            {
              salesOrderId: "so-1",
              readableId: "SO0001",
              unbilledShipping: 60
            },
            { salesOrderId: "so-2", readableId: "SO0002", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([
      {
        type: "orderShippingLeftOff",
        salesOrderReadableId: "SO0002",
        amount: 60
      }
    ]);
  });

  it("reports the order shipping the invoice's shipping does not reach", () => {
    expect(
      checks({
        lines: [line({ salesOrderId: "so-1" })],
        shippingCost: 20,
        facts: facts({
          orders: [
            { salesOrderId: "so-1", readableId: "SO0001", unbilledShipping: 60 }
          ]
        })
      })
    ).toEqual([
      {
        type: "orderShippingLeftOff",
        salesOrderReadableId: "SO0001",
        amount: 40
      }
    ]);
  });

  it("flags a foreign currency left at 1 when today's rate is not", () => {
    expect(
      checks({
        currencyCode: "EUR",
        exchangeRate: 1,
        baseCurrencyCode: "USD",
        facts: facts({ currentExchangeRate: 0.92 })
      })
    ).toEqual([
      { type: "exchangeRateNotSet", currencyCode: "EUR", currentRate: 0.92 }
    ]);
  });

  it.each([
    ["a currency pegged to the base", 1],
    ["a rate that could not be read", null]
  ])("does not flag a rate of 1 for %s", (_, currentExchangeRate) => {
    expect(
      checks({
        currencyCode: "BSD",
        exchangeRate: 1,
        baseCurrencyCode: "USD",
        facts: facts({ currentExchangeRate })
      })
    ).toEqual([]);
  });

  it("accepts a foreign currency with a rate set", () => {
    expect(
      checks({
        currencyCode: "EUR",
        exchangeRate: 0.92,
        baseCurrencyCode: "USD",
        facts: facts({ currentExchangeRate: 0.92 })
      })
    ).toEqual([]);
  });
});
