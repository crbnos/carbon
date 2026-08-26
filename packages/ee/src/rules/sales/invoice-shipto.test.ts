// Ship-to resolution for the sales-invoice document gate.
//
// An invoice raised with no upstream document is the bypass this surface
// exists to close: a standalone line has no ship-to and none may be invented,
// so a destination rule must fail CLOSED (required-field violation) rather
// than pass — and must never fall back to the bill-to, which is a different
// address and frequently a different country. An order-derived line resolves
// the real destination through its source order, drop-ship included.
//
// These tests drive the real document evaluator against a fake PostgREST
// client, so a future "fix" that substitutes the bill-to — or reads the order
// header instead of the drop shipment — fails here.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../plan.server", () => ({
  companyHasPlan: async () => true
}));

import { evaluateSalesRulesForSalesDocument } from "./server";

const COMPANY_ID = "co_1";

/**
 * Minimal PostgREST double that APPLIES `.eq()` / `.in()` filters against the
 * fixture rows (the evaluator selects specific rows by id, so recording alone
 * is not enough). Embeds are served by storing the embedded object inline on
 * the fixture row.
 */
function makeClient(rows: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let matched = rows[table] ?? [];
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          matched = matched.filter((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          matched = matched.filter((r) => vals.includes(r[col]));
          return builder;
        },
        order: () => builder,
        maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
        single: async () =>
          matched[0]
            ? { data: matched[0], error: null }
            : { data: null, error: { message: `no row in ${table}` } },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: matched, error: null })
      };
      return builder;
    }
  } as any;
}

// Permitted state: the destination country is NOT embargoed. Shipping to "IR"
// fails the predicate; an unresolvable country trips required-field semantics.
const COUNTRY_RULE = {
  id: "rule_embargo",
  companyId: COMPANY_ID,
  family: "sales",
  name: "Embargoed destinations",
  message: "Cannot sell {item.name} to this destination",
  severity: "error",
  conditionAst: {
    kind: "all",
    conditions: [
      { field: "customer.location.countryCode", op: "notIn", value: ["IR"] }
    ]
  },
  surfaces: ["salesInvoiceLine"],
  targetType: "item",
  appliesToAll: false,
  filteredItemTypes: [],
  filteredItemGroupIds: [],
  filteredItemMatchAll: false,
  active: true,
  updatedAt: "2026-08-26T00:00:00Z"
};

const BASE_ROWS: Record<string, Record<string, unknown>[]> = {
  enforcementRule: [COUNTRY_RULE],
  enforcementRuleItemAssignment: [],
  customer: [
    {
      id: "cust_1",
      companyId: COMPANY_ID,
      customerTypeId: null,
      customerStatusId: null,
      customFields: null
    }
  ],
  customerLocation: [
    { id: "loc_us", address: { countryCode: "US" } },
    { id: "loc_ir", address: { countryCode: "IR" } }
  ],
  item: [
    {
      id: "item_1",
      companyId: COMPANY_ID,
      readableIdWithRevision: "WIDGET-1",
      name: "Widget",
      type: "Part",
      replenishmentSystem: "Buy",
      itemTrackingType: "Inventory",
      itemCost: null
    }
  ]
};

function evaluateInvoice(rows: Record<string, Record<string, unknown>[]>) {
  return evaluateSalesRulesForSalesDocument({
    client: makeClient(rows),
    companyId: COMPANY_ID,
    userId: "user_1",
    documentType: "salesInvoice",
    documentId: "inv_1"
  });
}

describe("sales invoice ship-to resolution", () => {
  it("a standalone line fails closed with the required-field violation — never the bill-to", async () => {
    const { violations } = await evaluateInvoice({
      ...BASE_ROWS,
      salesInvoice: [
        {
          id: "inv_1",
          companyId: COMPANY_ID,
          customerId: "cust_1",
          // A safe-country bill-to on the invoice. If someone later "fixes"
          // the missing ship-to by substituting it, the rule clears and this
          // test fails — which is the point.
          invoiceCustomerLocationId: "loc_us"
        }
      ],
      salesInvoiceLine: [
        {
          id: "line_standalone",
          companyId: COMPANY_ID,
          invoiceId: "inv_1",
          itemId: "item_1",
          quantity: 2,
          salesOrderId: null
        }
      ]
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "rule_embargo",
      severity: "error",
      message: "Customer country is required",
      lineId: "line_standalone"
    });
  });

  it("an order-derived line resolves the ship-to through its source order", async () => {
    const rows = {
      ...BASE_ROWS,
      salesInvoice: [
        { id: "inv_1", companyId: COMPANY_ID, customerId: "cust_1" }
      ],
      salesInvoiceLine: [
        {
          id: "line_so",
          companyId: COMPANY_ID,
          invoiceId: "inv_1",
          itemId: "item_1",
          quantity: 1,
          salesOrderId: "so_1"
        }
      ],
      salesOrder: [
        {
          id: "so_1",
          companyId: COMPANY_ID,
          customerId: "cust_1",
          customerLocationId: "loc_us"
        }
      ],
      salesOrderShipment: []
    };

    // Order ships to a permitted country → no violation.
    expect((await evaluateInvoice(rows)).violations).toEqual([]);

    // Same shape, order ships to the embargoed country → the rule fires with
    // its own message (the country RESOLVED — this is not the required-field
    // path).
    const { violations } = await evaluateInvoice({
      ...rows,
      salesOrder: [
        {
          id: "so_1",
          companyId: COMPANY_ID,
          customerId: "cust_1",
          customerLocationId: "loc_ir"
        }
      ]
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "rule_embargo",
      message: "Cannot sell Widget to this destination",
      lineId: "line_so"
    });
  });

  it("a drop shipment's destination overrides the order header", async () => {
    const { violations } = await evaluateInvoice({
      ...BASE_ROWS,
      salesInvoice: [
        { id: "inv_1", companyId: COMPANY_ID, customerId: "cust_1" }
      ],
      salesInvoiceLine: [
        {
          id: "line_drop",
          companyId: COMPANY_ID,
          invoiceId: "inv_1",
          itemId: "item_1",
          quantity: 1,
          salesOrderId: "so_1"
        }
      ],
      // Header points at a permitted country; the drop shipment is the real
      // destination and it is embargoed.
      salesOrder: [
        {
          id: "so_1",
          companyId: COMPANY_ID,
          customerId: "cust_1",
          customerLocationId: "loc_us"
        }
      ],
      salesOrderShipment: [
        {
          id: "so_1",
          companyId: COMPANY_ID,
          dropShipment: true,
          customerId: "cust_1",
          customerLocationId: "loc_ir"
        }
      ]
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      ruleId: "rule_embargo",
      message: "Cannot sell Widget to this destination",
      lineId: "line_drop"
    });
  });

  it("mixed standalone and order-derived lines each evaluate against their own destination", async () => {
    const { violations } = await evaluateInvoice({
      ...BASE_ROWS,
      salesInvoice: [
        { id: "inv_1", companyId: COMPANY_ID, customerId: "cust_1" }
      ],
      salesInvoiceLine: [
        {
          id: "line_standalone",
          companyId: COMPANY_ID,
          invoiceId: "inv_1",
          itemId: "item_1",
          quantity: 1,
          salesOrderId: null
        },
        {
          id: "line_so",
          companyId: COMPANY_ID,
          invoiceId: "inv_1",
          itemId: "item_1",
          quantity: 1,
          salesOrderId: "so_1"
        }
      ],
      salesOrder: [
        {
          id: "so_1",
          companyId: COMPANY_ID,
          customerId: "cust_1",
          customerLocationId: "loc_us"
        }
      ],
      salesOrderShipment: []
    });

    // Only the standalone line violates (required field); the order-derived
    // line resolved a permitted destination.
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      lineId: "line_standalone",
      message: "Customer country is required"
    });
  });
});
