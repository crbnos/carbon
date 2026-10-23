// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// sales.models' module graph transitively loads @carbon/content/glossary and
// @carbon/onboarding, both of which build Lingui `msg` descriptors at module
// load. The macro isn't transformed under plain vitest, so raw `msg` throws.
// Stub it to a plain string builder; the validator under test is untouched.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  contractBillingMethodsFor,
  contractRevenueMethodsFor,
  contractTermFromServicePeriods,
  customerContractValidator,
  laborCategoriesWithoutBillRate,
  projectContractFunded,
  projectContractGaps,
  quoteLineValidator,
  quoteValidator,
  rentalAgreementChargeValidator,
  salesOrderLineValidator
} = await import("./sales.models");

// `quote.internalNotes` is a `json` column that the sales-order conversion
// copies through Kysely. A bare string stored there (which `notes: z.any()`
// allowed from the MCP / API tool) made every conversion of that quote fail
// with `invalid input syntax for type json`. The validator must now turn
// whatever a caller sends into a tiptap document object.

const base = { customerId: "cust_1", locationId: "loc_1" };

describe("quoteValidator.notes", () => {
  it("stores plain-text notes as a tiptap document", () => {
    const parsed = quoteValidator.parse({ ...base, notes: "rush order" });
    expect(parsed.notes).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "rush order" }] }
      ]
    });
  });

  it("keeps a tiptap document as sent", () => {
    const notes = { type: "doc", content: [] };
    expect(quoteValidator.parse({ ...base, notes }).notes).toEqual(notes);
  });

  it("leaves notes undefined when not sent", () => {
    expect(quoteValidator.parse(base).notes).toBeUndefined();
  });

  it("rejects a non-document scalar instead of storing it", () => {
    expect(quoteValidator.safeParse({ ...base, notes: 42 }).success).toBe(
      false
    );
  });
});

// A service period on a line is either absent or a complete, ordered pair:
// revenue recognition schedules from it, so a lone start or an end before the
// start must be refused at validation rather than stored. Only a Service line
// has one — every other item type is a physical good, earned when it ships.

const lineBase = {
  salesOrderId: "so_1",
  salesOrderLineType: "Service" as const,
  itemId: "item_1",
  locationId: "loc_1",
  methodType: "Pull from Inventory" as const,
  taxPercent: 0
};

describe("salesOrderLineValidator service dates", () => {
  it("rejects a service end before the service start", () => {
    const result = salesOrderLineValidator.safeParse({
      ...lineBase,
      serviceStartDate: "2026-03-01",
      serviceEndDate: "2026-02-01"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["serviceEndDate"]);
      expect(result.error.issues[0]?.message).toBe(
        "Service end must be on or after service start"
      );
    }
  });

  it("rejects a service start without a service end", () => {
    expect(
      salesOrderLineValidator.safeParse({
        ...lineBase,
        serviceStartDate: "2026-03-01"
      }).success
    ).toBe(false);
  });

  it("accepts a service start and end in order", () => {
    const parsed = salesOrderLineValidator.parse({
      ...lineBase,
      serviceStartDate: "2026-03-01",
      serviceEndDate: "2026-03-31"
    });
    expect(parsed.serviceStartDate).toBe("2026-03-01");
    expect(parsed.serviceEndDate).toBe("2026-03-31");
  });

  it("accepts a line with no service period", () => {
    expect(salesOrderLineValidator.safeParse(lineBase).success).toBe(true);
  });

  it("rejects a service period on a Part line", () => {
    const result = salesOrderLineValidator.safeParse({
      ...lineBase,
      salesOrderLineType: "Part",
      serviceStartDate: "2026-03-01",
      serviceEndDate: "2026-03-31"
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["serviceStartDate"]);
      expect(result.error.issues[0]?.message).toBe(
        "Service dates only apply to Service lines"
      );
    }
  });
});

// A charge's type is never the caller's: `Rent` is billed from the schedule and
// `Purchase Option` only by Sell to Customer, whose guards a posted type would
// skip. The form validator must not carry one through.
describe("rentalAgreementChargeValidator", () => {
  it("drops a posted chargeType", () => {
    const result = rentalAgreementChargeValidator.safeParse({
      rentalAgreementLineId: "ral_1",
      chargeType: "Purchase Option",
      chargeDate: "2026-09-23",
      description: "Damage",
      amount: "100",
      taxPercent: "0"
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("chargeType");
  });

  it("reads invoiceSeparately from a checkbox, off when unchecked", () => {
    const base = {
      rentalAgreementLineId: "ral_1",
      chargeDate: "2026-09-23",
      description: "Damage",
      amount: "500",
      taxPercent: "0"
    };
    expect(rentalAgreementChargeValidator.parse(base).invoiceSeparately).toBe(
      false
    );
    expect(
      rentalAgreementChargeValidator.parse({ ...base, invoiceSeparately: "on" })
        .invoiceSeparately
    ).toBe(true);
  });
});

describe("salesOrderLineValidator priceTrace", () => {
  const line = {
    salesOrderId: "so1",
    salesOrderLineType: "Part",
    itemId: "item1",
    methodType: "Pull from Inventory",
    locationId: "loc1",
    taxPercent: "0"
  };
  const trace = [
    { step: "Base Price", source: "Item Unit Sale Price", amount: 100 },
    { step: "Final Price", source: "Resolved", amount: 100 }
  ];

  const parse = (priceTrace?: string) =>
    salesOrderLineValidator.parse(
      priceTrace === undefined ? line : { ...line, priceTrace }
    ).priceTrace;

  it("keeps a posted trace", () => {
    expect(parse(JSON.stringify(trace))).toEqual(trace);
  });

  it('clears the trace when "null" is posted for a typed price', () => {
    expect(parse("null")).toBeNull();
  });

  it("leaves the stored trace alone when the field is not posted", () => {
    expect(parse()).toBeUndefined();
  });

  it("rejects a trace that is not a list of steps", () => {
    expect(() => parse(JSON.stringify({ step: "Base Price" }))).toThrow();
  });
});

// quoteLinePrice is keyed by (quoteLineId, quantity), so two equal breaks on a
// line would share one price row and edit together.
describe("quoteLineValidator.quantity", () => {
  it("rejects repeated quantity breaks", () => {
    const result = quoteLineValidator.shape.quantity.safeParse([10, 10, 25]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Each quantity must be different"
    );
  });

  it("accepts distinct quantity breaks", () => {
    expect(
      quoteLineValidator.shape.quantity.safeParse([10, 20, 25]).success
    ).toBe(true);
  });
});

// Create Contract on a sales order starts the contract when the order's
// service starts. Before this it always started today, for 12 months, and the
// service dates typed on the order were silently dropped.
describe("contractTermFromServicePeriods", () => {
  const undated = { serviceStartDate: null, serviceEndDate: null };

  it("is null when no line has a service period", () => {
    expect(contractTermFromServicePeriods([undated])).toBeNull();
    expect(contractTermFromServicePeriods([])).toBeNull();
  });

  it("uses a month preset when the period is exactly N months", () => {
    expect(
      contractTermFromServicePeriods([
        { serviceStartDate: "2027-01-01", serviceEndDate: "2027-12-31" },
        undated
      ])
    ).toEqual({ startDate: "2027-01-01", duration: "12" });
  });

  it("covers every line: earliest start, latest end", () => {
    expect(
      contractTermFromServicePeriods([
        { serviceStartDate: "2027-02-01", serviceEndDate: "2027-02-14" },
        { serviceStartDate: "2027-01-15", serviceEndDate: "2027-07-14" }
      ])
    ).toEqual({ startDate: "2027-01-15", duration: "6" });
  });

  it("falls back to a custom end date", () => {
    expect(
      contractTermFromServicePeriods([
        { serviceStartDate: "2027-01-01", serviceEndDate: "2027-03-15" }
      ])
    ).toEqual({
      startDate: "2027-01-01",
      duration: "custom",
      endDate: "2027-03-15"
    });
  });
});

// A project contract has a period of performance, not a term: it takes no
// duration, renewal or billing timing, but it needs a project and an end date.
describe("customerContractValidator billing basis", () => {
  const header = {
    name: "Phase 2 support",
    customerId: "cust_1",
    closeDate: "2026-10-21",
    startDate: "2026-11-01",
    renewalUplift: "0",
    currencyCode: "USD"
  };

  it("parses a project contract with no duration and no renewal", () => {
    const result = customerContractValidator.safeParse({
      ...header,
      billingBasis: "Project",
      projectId: "proj_1",
      endDate: "2027-10-31"
    });
    expect(result.success).toBe(true);
  });

  it("refuses a project contract without a project", () => {
    const result = customerContractValidator.safeParse({
      ...header,
      billingBasis: "Project",
      endDate: "2027-10-31"
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(
      "projectId"
    );
  });

  it("refuses a project contract without an end date", () => {
    const result = customerContractValidator.safeParse({
      ...header,
      billingBasis: "Project",
      projectId: "proj_1"
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(
      "endDate"
    );
  });

  it("still requires the term of a service contract", () => {
    const result = customerContractValidator.safeParse(header);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining([
        "duration",
        "renewal",
        "billingFrequency",
        "billingAlignment",
        "billingTiming"
      ])
    );
  });

  it("parses a service contract with its term", () => {
    const result = customerContractValidator.safeParse({
      ...header,
      duration: "12",
      renewal: "Renew",
      billingFrequency: "Month",
      billingAlignment: "Calendar",
      billingTiming: "Advance"
    });
    expect(result.success).toBe(true);
  });
});

describe("contractBillingMethodsFor", () => {
  it("offers only Fixed on a service contract", () => {
    expect(contractBillingMethodsFor("Schedule")).toEqual(["Fixed"]);
  });

  it("offers every billing method on a project contract", () => {
    expect(contractBillingMethodsFor("Project")).toEqual([
      "Fixed",
      "Time & Materials",
      "Cost Plus"
    ]);
  });
});

describe("contractRevenueMethodsFor", () => {
  it("keeps every Fixed method on a service contract", () => {
    expect(contractRevenueMethodsFor("Schedule", "Fixed")).toEqual([
      "Daily",
      "Even Period",
      "Percent Complete"
    ]);
  });

  it("offers Daily and Percent Complete for a Fixed Price line", () => {
    expect(contractRevenueMethodsFor("Project", "Fixed")).toEqual([
      "Daily",
      "Percent Complete"
    ]);
  });

  it("follows the billing method for a billing line", () => {
    expect(contractRevenueMethodsFor("Project", "Time & Materials")).toEqual([
      "Right to Invoice"
    ]);
    expect(contractRevenueMethodsFor("Project", "Cost Plus")).toEqual([
      "Percent Complete",
      "Right to Invoice"
    ]);
  });
});

describe("projectContractGaps", () => {
  type Input = Parameters<typeof projectContractGaps>[0];
  const tm = {
    id: "line_tm",
    billingMethod: "Time & Materials" as const,
    revenueMethod: "Right to Invoice" as const,
    projectId: "proj_1" as string | null,
    projectElementId: "el_1"
  };
  const fixed = {
    id: "line_fixed",
    billingMethod: "Fixed" as const,
    revenueMethod: "Daily" as const,
    projectId: null,
    projectElementId: null
  };
  const clean: Input = {
    lines: [tm, fixed],
    currencyCode: "USD",
    baseCurrencyCode: "USD",
    costTreatmentByProject: { proj_1: "Contract" },
    billingElementById: { el_1: { projectId: "proj_1", isBilling: true } },
    residuals: { line_fixed: 0 },
    laborCategoriesWithoutBillRate: [],
    emptyAccountDefaults: []
  };
  const keys = (input: Input) =>
    projectContractGaps(input).map((gap) => [gap.key, gap.blocking]);

  it("finds no gap on a ready contract", () => {
    expect(projectContractGaps(clean)).toEqual([]);
  });

  it("blocks a contract with no line", () => {
    expect(keys({ ...clean, lines: [] })).toEqual([["noLines", true]]);
  });

  it("blocks a billing line with no billing element", () => {
    expect(
      projectContractGaps({
        ...clean,
        lines: [{ ...tm, projectElementId: null }]
      })
    ).toEqual([{ key: "noBillingElement", blocking: true, lineId: "line_tm" }]);
  });

  it("blocks a billing line with no project of its own, as Confirm does", () => {
    expect(
      projectContractGaps({ ...clean, lines: [{ ...tm, projectId: null }] })
    ).toEqual([{ key: "noBillingElement", blocking: true, lineId: "line_tm" }]);
  });

  it("blocks a billing element that is not on the line's project", () => {
    expect(
      projectContractGaps({
        ...clean,
        costTreatmentByProject: { proj_1: "Contract", proj_2: "Contract" },
        billingElementById: { el_1: { projectId: "proj_2", isBilling: true } }
      })
    ).toEqual([
      { key: "elementNotOnProject", blocking: true, lineId: "line_tm" }
    ]);
  });

  it("blocks an element that is not a billing element", () => {
    expect(
      projectContractGaps({
        ...clean,
        billingElementById: { el_1: { projectId: "proj_1", isBilling: false } }
      })
    ).toEqual([
      {
        key: "notBillingElement",
        blocking: true,
        lineId: "line_tm",
        projectId: "proj_1",
        elementId: "el_1"
      }
    ]);
  });

  it("gives no element gap for an element it could not read", () => {
    expect(projectContractGaps({ ...clean, billingElementById: {} })).toEqual(
      []
    );
  });

  it("blocks once per project whose cost treatment is not Contract", () => {
    expect(
      keys({
        ...clean,
        lines: [tm, { ...tm, id: "line_tm_2" }],
        costTreatmentByProject: { proj_1: "Expense" },
        billingElementById: { el_1: { projectId: "proj_1", isBilling: false } }
      })
    ).toEqual([["costTreatment", true]]);
  });

  it("blocks a contract in a foreign currency", () => {
    expect(projectContractGaps({ ...clean, currencyCode: "EUR" })).toEqual([
      { key: "currency", blocking: true, baseCurrencyCode: "USD" }
    ]);
  });

  it("ignores the currency when only Fixed Daily lines bill", () => {
    expect(
      projectContractGaps({ ...clean, lines: [fixed], currencyCode: "EUR" })
    ).toEqual([]);
  });

  it("blocks a Fixed Price line whose billing events miss its price", () => {
    expect(
      projectContractGaps({ ...clean, residuals: { line_fixed: 250 } })
    ).toEqual([
      {
        key: "billingEvents",
        blocking: true,
        lineId: "line_fixed",
        residual: 250
      }
    ]);
  });

  it("warns about labor categories with no bill rate on a T&M contract", () => {
    expect(
      projectContractGaps({
        ...clean,
        laborCategoriesWithoutBillRate: ["Engineer", "Technician"]
      })
    ).toEqual([{ key: "laborBillRate", blocking: false, count: 2 }]);
    expect(
      projectContractGaps({
        ...clean,
        lines: [fixed],
        laborCategoriesWithoutBillRate: ["Engineer"]
      })
    ).toEqual([]);
  });

  it("warns about each empty default account, and not when unknown", () => {
    expect(
      keys({
        ...clean,
        emptyAccountDefaults: ["projectWorkInProgressAccount"]
      })
    ).toEqual([["accountDefault", false]]);
    expect(
      projectContractGaps({ ...clean, emptyAccountDefaults: null })
    ).toEqual([]);
  });
});

describe("laborCategoriesWithoutBillRate", () => {
  const categories = [
    {
      id: "lc_eng",
      name: "Engineer",
      active: true,
      rates: [{ billRate: 150 }]
    },
    {
      id: "lc_tech",
      name: "Technician",
      active: true,
      rates: [{ billRate: null }]
    },
    { id: "lc_old", name: "Retired", active: false, rates: [] }
  ];

  it("lists active categories with no bill rate", () => {
    expect(
      laborCategoriesWithoutBillRate({
        categories,
        timeAndMaterialsLineIds: ["line_1"],
        lineRates: []
      })
    ).toEqual(["Technician"]);
  });

  it("counts a contract labor rate on every T&M line as covered", () => {
    expect(
      laborCategoriesWithoutBillRate({
        categories,
        timeAndMaterialsLineIds: ["line_1", "line_2"],
        lineRates: [
          { customerContractLineId: "line_1", laborCategoryId: "lc_tech" }
        ]
      })
    ).toEqual(["Technician"]);
    expect(
      laborCategoriesWithoutBillRate({
        categories,
        timeAndMaterialsLineIds: ["line_1"],
        lineRates: [
          { customerContractLineId: "line_1", laborCategoryId: "lc_tech" }
        ]
      })
    ).toEqual([]);
  });

  it("lists nothing without a T&M line", () => {
    expect(
      laborCategoriesWithoutBillRate({
        categories,
        timeAndMaterialsLineIds: [],
        lineRates: []
      })
    ).toEqual([]);
  });
});

describe("projectContractFunded", () => {
  it("adds billing lines' funding and Fixed Price lines' prices", () => {
    expect(
      projectContractFunded([
        {
          id: "line_tm",
          amendsLineId: null,
          billingMethod: "Time & Materials",
          fundedAmount: 50000,
          quantity: 1,
          rate: 0
        },
        {
          id: "line_cp",
          amendsLineId: null,
          billingMethod: "Cost Plus",
          fundedAmount: null,
          quantity: 1,
          rate: 0
        },
        {
          id: "line_fixed",
          amendsLineId: null,
          billingMethod: "Fixed",
          fundedAmount: null,
          quantity: 1,
          rate: 90000
        }
      ])
    ).toBe(140000);
  });

  it("counts an amended line once, at its new terms", () => {
    expect(
      projectContractFunded([
        {
          id: "line_fixed",
          amendsLineId: null,
          billingMethod: "Fixed",
          fundedAmount: null,
          quantity: 1,
          rate: 90000
        },
        {
          id: "line_fixed_2",
          amendsLineId: "line_fixed",
          billingMethod: "Fixed",
          fundedAmount: null,
          quantity: 1,
          rate: 120000
        },
        {
          id: "line_tm",
          amendsLineId: null,
          billingMethod: "Time & Materials",
          fundedAmount: 50000,
          quantity: 1,
          rate: 0
        },
        {
          id: "line_tm_2",
          amendsLineId: "line_tm",
          billingMethod: "Time & Materials",
          fundedAmount: 80000,
          quantity: 1,
          rate: 0
        }
      ])
    ).toBe(200000);
  });
});
