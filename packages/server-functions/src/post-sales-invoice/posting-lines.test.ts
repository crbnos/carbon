// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sales invoice journal, built from facts with no database: account
// resolution before and after the cutover, an intercompany customer, a
// deferral line, a direct line's COGS pair, and the dimensions.

import type { Database } from "@carbon/database";
import { MissingAccountDefaultError } from "@carbon/database/journal-posting-status";
import type { SalesPostingAccount } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { journalLineDimensionRows } from "../lib/journal-line-dimensions";
import {
  planSalesInvoiceAccounts,
  resolveSalesInvoiceAccounts,
  type SalesInvoiceAccountNeeds,
  type SalesInvoiceAccounts
} from "./posting-accounts";
import {
  buildSalesInvoiceJournal,
  fillDirectCogs,
  postingAccountNeeds,
  postingLineRevenue,
  type SalesInvoiceJournalFacts,
  type SalesInvoiceLine,
  salesLineDimensions
} from "./posting-lines";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type Status = "Provisional" | "Posted";

const GROUP = "group-1";
const leaf = (id: string, accountClass: string): SalesPostingAccount => ({
  id,
  class: accountClass,
  active: true,
  isGroup: false,
  companyGroupId: GROUP
});
// The chart the account read returns, by id.
const CHART = [
  leaf("ar", "Asset"),
  leaf("ic-ar", "Asset"),
  leaf("sales", "Revenue"),
  leaf("shipping", "Revenue"),
  leaf("tax", "Liability"),
  leaf("deferred", "Liability"),
  leaf("cogs", "Expense"),
  leaf("raw", "Asset"),
  leaf("finished", "Asset"),
  leaf("retained", "Equity")
];

const defaultsWith = (overrides: Partial<AccountDefaults> = {}) =>
  ({
    receivablesAccount: "ar",
    intercompanyReceivablesAccount: "ic-ar",
    salesAccount: "sales",
    salesShippingRevenueAccount: "shipping",
    salesTaxPayableAccount: "tax",
    deferredRevenueAccount: "deferred",
    contractAssetAccount: null,
    rentalIncomeAccount: null,
    leaseRevenueAccount: null,
    netInvestmentInLeasesAccount: null,
    realizedExchangeGainAccount: null,
    realizedExchangeLossAccount: null,
    costOfGoodsSoldAccount: "cogs",
    rawMaterialsAccount: "raw",
    finishedGoodsAccount: "finished",
    retainedEarningsAccount: "retained",
    ...overrides
  }) as AccountDefaults;

const NO_NEEDS: SalesInvoiceAccountNeeds = {
  deferredRevenue: false,
  rental: null,
  contract: false,
  accountIds: []
};

/** Plans, reads (from CHART) and resolves the accounts. */
function accountsFor(
  defaults: AccountDefaults,
  postingStatus: Status,
  needs: SalesInvoiceAccountNeeds = NO_NEEDS
): SalesInvoiceAccounts {
  const plan = planSalesInvoiceAccounts(defaults, postingStatus, needs);
  return resolveSalesInvoiceAccounts(
    plan,
    CHART.filter((account) => plan.accountIds.includes(account.id)),
    GROUP
  );
}

const invoiceLine = (
  overrides: Partial<SalesInvoiceLine> = {}
): SalesInvoiceLine => ({
  id: "line-1",
  invoiceLineType: "Part",
  itemId: "item-1",
  quantity: 2,
  unitPrice: 50,
  discountPercent: 0,
  shippingCost: 0,
  addOnCost: 0,
  nonTaxableAddOnCost: 0,
  taxPercent: 0,
  salesOrderLineId: "so-line-1",
  methodType: "Pull from Inventory",
  locationId: "location-1",
  projectId: null,
  customerContractId: null,
  customerContractLineId: null,
  serviceStartDate: null,
  serviceEndDate: null,
  assetId: null,
  rentalAgreementLineId: null,
  rentalBillingPeriodId: null,
  rentalLineType: null,
  ...overrides
});

const facts = (
  accounts: SalesInvoiceAccounts,
  overrides: Partial<SalesInvoiceJournalFacts> = {}
): SalesInvoiceJournalFacts => ({
  companyId: "company-1",
  companyGroupId: GROUP,
  invoice: {
    id: "invoice-1",
    customerId: "customer-1",
    customerReference: "PO-7"
  },
  customerTypeId: "customer-type-1",
  intercompanyPartnerId: null,
  lines: [invoiceLine()],
  headerShipping: new Map(),
  items: new Map([
    ["item-1", { itemTrackingType: "Inventory", replenishmentSystem: "Make" }]
  ]),
  postingGroups: new Map([["item-1", "posting-group-1"]]),
  salesOrderLines: new Map(),
  assets: new Map(),
  rentalAgreementLines: new Map(),
  accounts,
  revenue: postingLineRevenue,
  directCost: () => 0,
  contract: null,
  rental: null,
  disposal: null,
  ...overrides
});

const summary = (
  lines: {
    accountId?: string | null;
    description?: string | null;
    amount?: number;
  }[]
) => lines.map((line) => [line.accountId, line.description, line.amount]);

describe("account resolution", () => {
  it("stands in for an empty optional default before the cutover", () => {
    const accounts = accountsFor(
      defaultsWith({ salesShippingRevenueAccount: null }),
      "Provisional"
    );
    expect(accounts.shippingAccountId).toBe(
      "stand-in:salesShippingRevenueAccount"
    );
    const journal = buildSalesInvoiceJournal(
      facts(accounts, { lines: [invoiceLine({ shippingCost: 10 })] })
    );
    expect(summary(journal.lines)).toEqual([
      ["sales", "Sales Account", 100],
      ["stand-in:salesShippingRevenueAccount", "Shipping Revenue", 10],
      ["ar", "Accounts Receivable", 110]
    ]);
    // Stored on Retained Earnings, naming the default it stands in for.
    expect(accounts.standIns.storedLine(journal.lines[1]!)).toMatchObject({
      accountId: "retained",
      accountDefaultRole: "salesShippingRevenueAccount"
    });
  });

  it("refuses a line that needs an empty optional default after the cutover", () => {
    const accounts = accountsFor(
      defaultsWith({ salesShippingRevenueAccount: null }),
      "Posted"
    );
    expect(accounts.shippingAccountId).toBeNull();
    expect(() =>
      buildSalesInvoiceJournal(
        facts(accounts, { lines: [invoiceLine({ shippingCost: 10 })] })
      )
    ).toThrow("Invalid or missing Shipping Revenue account");
    // A line with no shipping never needs it.
    expect(buildSalesInvoiceJournal(facts(accounts)).lines).toHaveLength(2);
  });

  it("refuses a deferral with no Deferred Revenue default in either state", () => {
    const defaults = defaultsWith({ deferredRevenueAccount: null });
    for (const status of ["Provisional", "Posted"] as const) {
      expect(() =>
        planSalesInvoiceAccounts(defaults, status, {
          ...NO_NEEDS,
          deferredRevenue: true
        })
      ).toThrow(MissingAccountDefaultError);
    }
    // A caller that books no deferral reads no deferral default.
    expect(() =>
      planSalesInvoiceAccounts(defaults, "Posted", NO_NEEDS)
    ).not.toThrow();
  });

  it("asks for the deferral default only when a Service line is dated", () => {
    const dated = invoiceLine({
      invoiceLineType: "Service",
      serviceStartDate: "2026-01-01",
      serviceEndDate: "2026-03-31"
    });
    expect(postingAccountNeeds([dated], []).deferredRevenue).toBe(true);
    expect(
      postingAccountNeeds([{ ...dated, invoiceLineType: "Part" }], [])
        .deferredRevenue
    ).toBe(false);
  });
});

describe("an intercompany customer", () => {
  it("books Inter-Company Receivables with the partner on the control line", () => {
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), {
        intercompanyPartnerId: "company-2"
      })
    );
    expect(journal.lines.at(-1)).toMatchObject({
      accountId: "ic-ar",
      description: "IC Receivables",
      amount: 100,
      intercompanyPartnerId: "company-2"
    });
  });

  it("falls back to receivables when the intercompany default is empty", () => {
    const accounts = accountsFor(
      defaultsWith({ intercompanyReceivablesAccount: null }),
      "Posted"
    );
    expect(accounts.receivablesAccountId(true)).toBe("ar");
    const journal = buildSalesInvoiceJournal(
      facts(accounts, { intercompanyPartnerId: "company-2" })
    );
    expect(journal.lines.at(-1)).toMatchObject({
      accountId: "ar",
      description: "IC Receivables"
    });
  });
});

describe("a deferral line", () => {
  const dated = invoiceLine({
    invoiceLineType: "Service",
    serviceStartDate: "2026-01-01",
    serviceEndDate: "2026-03-31"
  });

  it("credits Deferred Revenue and plans the schedule into Sales", () => {
    const accounts = accountsFor(defaultsWith(), "Posted", {
      ...NO_NEEDS,
      deferredRevenue: true
    });
    const journal = buildSalesInvoiceJournal(
      facts(accounts, { lines: [dated] })
    );
    expect(summary(journal.lines)).toEqual([
      ["deferred", "Deferred Revenue", 100],
      ["ar", "Accounts Receivable", 100]
    ]);
    expect(journal.deferrals).toEqual([
      {
        salesInvoiceLineId: "line-1",
        amountBase: 100,
        debitAccountId: "deferred",
        creditAccountId: "sales",
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      }
    ]);
  });

  it("books the caller's legs instead, with no schedule (the backfill)", () => {
    const accounts = accountsFor(defaultsWith(), "Provisional", {
      ...NO_NEEDS,
      accountIds: ["deferred"]
    });
    const journal = buildSalesInvoiceJournal(
      facts(accounts, {
        lines: [dated],
        revenue: () => ({
          book: "legs",
          legs: [
            {
              account: accounts.account("deferred"),
              accountClass: "Liability",
              description: "Deferred Revenue",
              amount: 60
            },
            {
              account: accounts.account("sales"),
              accountClass: "Revenue",
              description: "Sales Account"
            }
          ]
        })
      })
    );
    expect(summary(journal.lines)).toEqual([
      ["deferred", "Deferred Revenue", 60],
      ["sales", "Sales Account", 40],
      ["ar", "Accounts Receivable", 100]
    ]);
    expect(journal.deferrals).toEqual([]);
  });
});

describe("a direct inventory line's COGS pair", () => {
  const direct = invoiceLine({ salesOrderLineId: null });

  it("debits COGS and credits the item's inventory account at the cost", () => {
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), {
        lines: [direct],
        directCost: () => 30
      })
    );
    expect(summary(journal.lines.slice(2))).toEqual([
      ["cogs", "Cost of Goods Sold", 30],
      ["finished", "Finished Goods Account", -30]
    ]);
    expect(journal.lines[2]).toMatchObject({
      quantity: 2,
      documentType: "Invoice",
      documentId: "invoice-1",
      externalDocumentId: "PO-7"
    });
    // One reference for the pair, apart from the line's own.
    expect(journal.lines[2]!.journalLineReference).toBe(
      journal.lines[3]!.journalLineReference
    );
    expect(journal.lines[2]!.journalLineReference).not.toBe(
      journal.lines[0]!.journalLineReference
    );
    expect(journal.metadata[2]).toMatchObject({
      itemId: "item-1",
      itemPostingGroupId: "posting-group-1",
      projectId: null
    });
  });

  it("is written at zero and filled once the cost is relieved (the posting)", () => {
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), { lines: [direct] })
    );
    const reference = journal.directCogsReferences.get(direct.id);
    expect(fillDirectCogs(journal.lines, reference, 30)).toBe(true);
    expect(summary(journal.lines.slice(2))).toEqual([
      ["cogs", "Cost of Goods Sold", 30],
      ["finished", "Finished Goods Account", -30]
    ]);
    expect(fillDirectCogs(journal.lines, undefined, 30)).toBe(false);
  });

  it("fills each direct line's own pair when two lines share a quantity", () => {
    const first = invoiceLine({ id: "line-a", salesOrderLineId: null });
    const second = invoiceLine({ id: "line-b", salesOrderLineId: null });
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), { lines: [first, second] })
    );
    // The first line's cost is genuinely zero; the second's is 40.
    expect(
      fillDirectCogs(
        journal.lines,
        journal.directCogsReferences.get("line-a"),
        0
      )
    ).toBe(true);
    expect(
      fillDirectCogs(
        journal.lines,
        journal.directCogsReferences.get("line-b"),
        40
      )
    ).toBe(true);
    const cogs = (reference: string | undefined) =>
      journal.lines.find(
        (line) =>
          line.journalLineReference === reference &&
          line.description === "Cost of Goods Sold"
      )?.amount;
    expect(cogs(journal.directCogsReferences.get("line-a"))).toBe(0);
    expect(cogs(journal.directCogsReferences.get("line-b"))).toBe(40);
  });

  it("is not written for a sales-order, Make-to-Order, non-inventory or uncosted line", () => {
    const accounts = accountsFor(defaultsWith(), "Posted");
    const pairs = (overrides: Partial<SalesInvoiceJournalFacts>) =>
      buildSalesInvoiceJournal(facts(accounts, overrides)).lines.filter(
        (line) => line.description === "Cost of Goods Sold"
      );
    expect(pairs({ lines: [invoiceLine()] })).toEqual([]);
    expect(
      pairs({ lines: [{ ...direct, methodType: "Make to Order" }] })
    ).toEqual([]);
    expect(
      pairs({
        lines: [direct],
        items: new Map([
          [
            "item-1",
            { itemTrackingType: "Non-Inventory", replenishmentSystem: "Buy" }
          ]
        ])
      })
    ).toEqual([]);
    expect(pairs({ lines: [direct], directCost: () => null })).toEqual([]);
  });
});

describe("dimensions", () => {
  it("carry the project on the revenue side and the customer on every line", () => {
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), {
        lines: [invoiceLine({ projectId: "project-1" })]
      })
    );
    const [revenue, receivable] = journal.metadata.map((meta) =>
      salesLineDimensions(meta, "customer-1")
    );
    expect(revenue).toEqual({
      CustomerType: "customer-type-1",
      ItemPostingGroup: "posting-group-1",
      Location: "location-1",
      CostCenter: null,
      FixedAssetClass: null,
      Item: "item-1",
      Project: "project-1",
      Customer: "customer-1"
    });
    expect(receivable).toMatchObject({ Project: null, Customer: "customer-1" });
  });

  it("write a row per value whose entity type has an active dimension", () => {
    const journal = buildSalesInvoiceJournal(
      facts(accountsFor(defaultsWith(), "Posted"), {
        lines: [invoiceLine({ projectId: "project-1" })]
      })
    );
    const rows = journalLineDimensionRows({
      journalLineIds: ["jl-1", "jl-2"],
      lines: journal.metadata.map((meta) => ({
        dimensions: salesLineDimensions(meta, "customer-1")
      })),
      dimensionIdByEntity: new Map([
        ["Project", "dim-project"],
        ["Customer", "dim-customer"]
      ]),
      companyId: "company-1"
    });
    expect(
      rows.map((row) => [row.journalLineId, row.dimensionId, row.valueId])
    ).toEqual([
      ["jl-1", "dim-project", "project-1"],
      ["jl-1", "dim-customer", "customer-1"],
      ["jl-2", "dim-customer", "customer-1"]
    ]);
  });
});
