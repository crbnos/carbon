// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type AccountDefaultsRow,
  type AccountImportContext,
  type AccountImportRow,
  type AccountUsage,
  type ChartAccount,
  planAccountImport,
  requiredRoles
} from "./account-import";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared";
import { hasDefaultFallback } from "./journal-posting-status";

const group = (
  id: string,
  name: string,
  cls: ChartAccount["class"],
  parentId: string | null,
  isSystem = false
): ChartAccount => ({
  id,
  number: null,
  name,
  class: cls,
  accountType: null,
  incomeBalance:
    cls === "Revenue" || cls === "Expense"
      ? "Income Statement"
      : "Balance Sheet",
  parentId,
  isGroup: true,
  isSystem,
  active: true
});

const leaf = (
  number: string,
  name: string,
  cls: NonNullable<ChartAccount["class"]>,
  parentId: string,
  accountType: string,
  active = true
): ChartAccount => ({
  id: `a${number}`,
  number,
  name,
  class: cls,
  accountType,
  incomeBalance:
    cls === "Revenue" || cls === "Expense"
      ? "Income Statement"
      : "Balance Sheet",
  parentId,
  isGroup: false,
  isSystem: false,
  active
});

const CHART: ChartAccount[] = [
  group("bs", "Balance Sheet", null, null, true),
  group("is", "Income Statement", null, null, true),
  group("ca", "Current Assets", "Asset", "bs"),
  group("rev", "Revenue", "Revenue", "is"),
  group("eq", "Equity", "Equity", "bs"),
  leaf("1010", "Cash", "Asset", "ca", "Bank"),
  leaf("1110", "Receivables", "Asset", "ca", "Accounts Receivable"),
  leaf("1310", "Raw Materials", "Asset", "ca", "Inventory"),
  leaf("1320", "Finished Goods", "Asset", "ca", "Inventory"),
  leaf("1900", "Petty Cash", "Asset", "ca", "Cash"),
  leaf("3400", "Migration Clearing", "Equity", "eq", "Equity - No Close"),
  leaf("3900", "Retained Earnings", "Equity", "eq", "Retained Earnings"),
  leaf("4010", "Sales", "Revenue", "rev", "Income"),
  leaf("4050", "Shipping Revenue", "Revenue", "rev", "Income"),
  leaf("4090", "Old Sales", "Revenue", "rev", "Income", false)
];

function defaults(): AccountDefaultsRow {
  const row = Object.fromEntries(
    ACCOUNT_DEFAULT_COLUMNS.map((c) => [c, null])
  ) as AccountDefaultsRow;
  row.receivablesAccount = "a1110";
  row.rawMaterialsAccount = "a1310";
  row.finishedGoodsAccount = "a1320";
  row.salesAccount = "a4010";
  row.salesShippingRevenueAccount = "a4050";
  row.migrationClearingAccount = "a3400";
  row.retainedEarningsAccount = "a3900";
  return row;
}

function context(
  usage: Record<string, Partial<AccountUsage>> = {}
): AccountImportContext {
  return {
    chart: CHART,
    companies: [
      { id: "c1", name: "One", hasCutover: false },
      { id: "c2", name: "Two", hasCutover: true }
    ],
    defaultsByCompany: { c1: defaults(), c2: defaults() },
    usage: Object.fromEntries(
      Object.entries(usage).map(([id, u]) => [
        id,
        {
          hasPostedLines: false,
          reclassBalanceByCompany: {},
          movableReferencesByCompany: {},
          historyReferences: 0,
          ...u
        }
      ])
    ),
    importingCompanyId: "c1"
  };
}

/** One row per ACTIVE leaf, naming itself: an unchanged download. */
function templateRows(): AccountImportRow[] {
  const groupName = new Map(
    CHART.filter((a) => a.isGroup).map((a) => [a.id, a.name])
  );
  return CHART.filter((a) => !a.isGroup && a.active).map((a, i) => ({
    line: i + 2,
    number: a.number!,
    name: a.name,
    class: a.class,
    accountType: a.accountType,
    group: groupName.get(a.parentId!)!,
    carbonAccounts: [a.number!]
  }));
}

const NONE = { targets: {} };
const lineOf = (rows: AccountImportRow[], number: string) =>
  rows.find((r) => r.carbonAccounts.includes(number))!.line;
const without = (rows: AccountImportRow[], number: string) =>
  rows.filter((r) => r.number !== number);
const edit = (
  rows: AccountImportRow[],
  number: string,
  patch: Partial<AccountImportRow>
) => rows.map((r) => (r.number === number ? { ...r, ...patch } : r));
const newRow = (
  line: number,
  patch: Partial<AccountImportRow> = {}
): AccountImportRow => ({
  line,
  number: "6010",
  name: "Office Supplies",
  class: "Expense",
  accountType: "Expense",
  group: "Operating Expenses",
  carbonAccounts: [],
  ...patch
});

describe("planAccountImport", () => {
  it("1. an unchanged download plans nothing", () => {
    const plan = planAccountImport(templateRows(), context(), NONE);
    expect(plan).toMatchObject({
      renames: [],
      creates: [],
      merges: [],
      retires: [],
      roleMoves: [],
      reclasses: [],
      groupCreates: [],
      companies: [],
      errors: [],
      exceptions: []
    });
  });

  it("2. a renumber and rename renames in place", () => {
    const rows = edit(templateRows(), "1110", {
      number: "1200",
      name: "Accounts Receivable"
    });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.renames).toEqual([
      expect.objectContaining({
        accountId: "a1110",
        number: "1200",
        name: "Accounts Receivable",
        reactivate: false
      })
    ]);
    expect(plan.merges).toEqual([]);
    expect(plan.retires).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it("3. two accounts may swap numbers", () => {
    let rows = edit(templateRows(), "1010", { number: "x" });
    rows = edit(rows, "1110", { number: "1010" });
    rows = edit(rows, "x", { number: "1110" });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toEqual([]);
    expect(plan.renames.map((r) => [r.accountId, r.number])).toEqual([
      ["a1010", "1110"],
      ["a1110", "1010"]
    ]);
  });

  it("4. two names on one row merge, and the roles follow", () => {
    const rows = edit(without(templateRows(), "4050"), "4010", {
      carbonAccounts: ["4010", "4050"]
    });
    const plan = planAccountImport(rows, context(), NONE);
    const line = lineOf(rows, "4010");
    expect(plan.merges).toEqual([{ sourceId: "a4050", targetLine: line }]);
    expect(plan.roleMoves).toEqual([
      {
        companyId: "c1",
        role: "salesShippingRevenueAccount",
        fromAccountId: "a4050",
        toLine: line
      },
      {
        companyId: "c2",
        role: "salesShippingRevenueAccount",
        fromAccountId: "a4050",
        toLine: line
      }
    ]);
    expect(plan.retires).toEqual([{ accountId: "a4050", mode: "delete" }]);
    expect(plan.exceptions).toEqual([]);
  });

  it("5. control accounts with no history may merge", () => {
    const rows = edit(without(templateRows(), "1320"), "1310", {
      name: "Inventory",
      carbonAccounts: ["1310", "1320"]
    });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toEqual([]);
    expect(plan.merges).toEqual([
      { sourceId: "a1320", targetLine: lineOf(rows, "1310") }
    ]);
  });

  it("6. a control account with posted lines cannot merge", () => {
    const rows = edit(without(templateRows(), "1320"), "1310", {
      carbonAccounts: ["1310", "1320"]
    });
    const plan = planAccountImport(
      rows,
      context({ a1320: { hasPostedLines: true } }),
      NONE
    );
    expect(plan.errors).toContainEqual({
      code: "control-account-with-history",
      accountId: "a1320",
      role: "finishedGoodsAccount"
    });
  });

  it("7. an unclaimed account behind a required role needs a target", () => {
    expect(hasDefaultFallback("salesShippingRevenueAccount")).toBe(false);
    expect(requiredRoles()).toContain("salesShippingRevenueAccount");
    const plan = planAccountImport(
      without(templateRows(), "4050"),
      context(),
      NONE
    );
    expect(plan.exceptions).toEqual([
      {
        code: "account-needs-target",
        accountId: "a4050",
        reasons: ["required-role"],
        companyIds: ["c1", "c2"]
      }
    ]);
    expect(plan.retires).toEqual([]);
  });

  it("8. a picked target turns the account into a merge source", () => {
    const rows = without(templateRows(), "4050");
    const line = lineOf(rows, "4010");
    const plan = planAccountImport(rows, context(), {
      targets: { a4050: line }
    });
    expect(plan.exceptions).toEqual([]);
    expect(plan.merges).toEqual([{ sourceId: "a4050", targetLine: line }]);
    expect(plan.roleMoves.map((m) => [m.role, m.toLine])).toEqual([
      ["salesShippingRevenueAccount", line],
      ["salesShippingRevenueAccount", line]
    ]);
    expect(plan.retires).toEqual([{ accountId: "a4050", mode: "delete" }]);
  });

  it("9. an unused account with no roles is deleted", () => {
    const plan = planAccountImport(
      without(templateRows(), "1900"),
      context(),
      NONE
    );
    expect(plan.exceptions).toEqual([]);
    expect(plan.retires).toEqual([{ accountId: "a1900", mode: "delete" }]);
  });

  it("10. an unclaimed account with movable references needs a target", () => {
    const plan = planAccountImport(
      without(templateRows(), "1900"),
      context({ a1900: { movableReferencesByCompany: { c1: 2 } } }),
      NONE
    );
    expect(plan.exceptions).toEqual([
      {
        code: "account-needs-target",
        accountId: "a1900",
        reasons: ["references"],
        companyIds: ["c1"]
      }
    ]);
    expect(plan.retires).toEqual([]);
  });

  it("11. with a target, its references move and it is deleted", () => {
    const rows = without(templateRows(), "1900");
    const line = lineOf(rows, "1010");
    const plan = planAccountImport(
      rows,
      context({ a1900: { movableReferencesByCompany: { c1: 2 } } }),
      { targets: { a1900: line } }
    );
    expect(plan.merges).toEqual([{ sourceId: "a1900", targetLine: line }]);
    expect(plan.retires).toEqual([{ accountId: "a1900", mode: "delete" }]);
    expect(plan.companies).toEqual([
      { companyId: "c1", repointedReferences: 2, roleMoves: 0, reclasses: 0 }
    ]);
  });

  it("12. a posted balance is reclassed and the account deactivated", () => {
    const rows = without(templateRows(), "1900");
    const line = lineOf(rows, "1010");
    const plan = planAccountImport(
      rows,
      context({
        a1900: { hasPostedLines: true, reclassBalanceByCompany: { c2: 500 } }
      }),
      { targets: { a1900: line } }
    );
    expect(plan.reclasses).toEqual([
      { companyId: "c2", sourceId: "a1900", targetLine: line, amount: 500 }
    ]);
    expect(plan.retires).toEqual([{ accountId: "a1900", mode: "deactivate" }]);
  });

  it("13. Superseded-only history deactivates with no reclass", () => {
    const plan = planAccountImport(
      without(templateRows(), "1900"),
      context({ a1900: { hasPostedLines: true } }),
      NONE
    );
    expect(plan.exceptions).toEqual([]);
    expect(plan.reclasses).toEqual([]);
    expect(plan.retires).toEqual([{ accountId: "a1900", mode: "deactivate" }]);
  });

  it("14. a row with no Carbon account creates an account", () => {
    const rows = [
      ...templateRows(),
      newRow(99, { group: "Revenue", class: "Revenue", accountType: "Income" })
    ];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.creates).toEqual([
      {
        line: 99,
        number: "6010",
        name: "Office Supplies",
        class: "Revenue",
        accountType: "Income",
        group: "Revenue"
      }
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("15. a new row needs a class", () => {
    const rows = [...templateRows(), newRow(99, { class: null })];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({ code: "missing-class", line: 99 });
  });

  it("16. duplicate numbers are refused", () => {
    const rows = [...templateRows(), newRow(99, { number: "1010" })];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "duplicate-number",
      line: 99,
      firstLine: lineOf(rows, "1010"),
      value: "1010"
    });
  });

  it("17. one Carbon account cannot back two rows", () => {
    const rows = [...templateRows(), newRow(99, { carbonAccounts: ["1110"] })];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "carbon-account-claimed-twice",
      line: 99,
      firstLine: lineOf(rows, "1110"),
      accountId: "a1110"
    });
  });

  it("18. a role name resolves through the importing company's defaults", () => {
    const rows = edit(templateRows(), "1110", {
      number: "1200",
      carbonAccounts: ["Accounts Receivable"]
    });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toEqual([]);
    expect(plan.renames).toEqual([
      expect.objectContaining({ accountId: "a1110", number: "1200" })
    ]);
  });

  it("19. an unknown Carbon account is refused", () => {
    const rows = [...templateRows(), newRow(99, { carbonAccounts: ["9999"] })];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "unknown-carbon-account",
      line: 99,
      value: "9999"
    });
  });

  it("20. a role-backed account cannot change class", () => {
    const rows = edit(templateRows(), "4010", { class: "Asset" });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "class-mismatch",
      line: lineOf(rows, "4010"),
      accountId: "a4010"
    });
  });

  it("21. Migration Clearing must stay Equity", () => {
    const rows = edit(templateRows(), "3400", {
      class: "Revenue",
      group: "Revenue"
    });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "migration-clearing-not-equity",
      line: lineOf(rows, "3400")
    });
  });

  it("22. an unknown group is created with the row's class", () => {
    const rows = edit(templateRows(), "1900", { group: "Other Assets" });
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.groupCreates).toEqual([
      { name: "Other Assets", class: "Asset" }
    ]);
    expect(plan.renames).toEqual([
      expect.objectContaining({ accountId: "a1900", group: "Other Assets" })
    ]);
  });

  it("23. an inactive account's number is taken", () => {
    const rows = [
      ...templateRows(),
      newRow(99, { number: "4090", class: "Revenue", group: "Revenue" })
    ];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "taken-by-inactive-account",
      line: 99,
      field: "number",
      accountId: "a4090",
      retiredByThisImport: false
    });
  });

  it("24. naming an inactive account reactivates it", () => {
    const rows = [
      ...templateRows(),
      newRow(99, {
        number: "4090",
        name: "Old Sales",
        class: "Revenue",
        accountType: "Income",
        group: "Revenue",
        carbonAccounts: ["4090"]
      })
    ];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toEqual([]);
    expect(plan.renames).toEqual([
      expect.objectContaining({ accountId: "a4090", reactivate: true })
    ]);
  });

  it("25. a number this import deactivates is taken", () => {
    const rows = [
      ...without(templateRows(), "1900"),
      newRow(99, { number: "1900", class: "Asset", group: "Current Assets" })
    ];
    const plan = planAccountImport(
      rows,
      context({ a1900: { hasPostedLines: true } }),
      NONE
    );
    expect(plan.errors).toContainEqual({
      code: "taken-by-inactive-account",
      line: 99,
      field: "number",
      accountId: "a1900",
      retiredByThisImport: true
    });
  });

  it("26. an unclaimed inactive account is left alone", () => {
    const plan = planAccountImport(templateRows(), context(), NONE);
    expect(plan.retires.find((r) => r.accountId === "a4090")).toBeUndefined();
  });

  it("refuses an account type the database does not know", () => {
    const rows = [...templateRows(), newRow(99, { accountType: "Bogus" })];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "invalid-type",
      line: 99,
      value: "Bogus"
    });
  });

  it("refuses a row whose class differs from its group's", () => {
    const rows = [
      ...templateRows(),
      newRow(99, { class: "Expense", group: "Revenue" })
    ];
    const plan = planAccountImport(rows, context(), NONE);
    expect(plan.errors).toContainEqual({
      code: "group-class-mismatch",
      line: 99,
      group: "Revenue"
    });
  });

  it("refuses a target line that is not in the sheet", () => {
    const plan = planAccountImport(without(templateRows(), "4050"), context(), {
      targets: { a4050: 999 }
    });
    expect(plan.errors).toContainEqual({
      code: "target-not-in-sheet",
      accountId: "a4050",
      line: 999
    });
  });
});
