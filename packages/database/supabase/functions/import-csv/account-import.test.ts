import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import {
  type ExistingAccount,
  type ImportPlan,
  isInvertedActiveHeader,
  type PlanContext,
  planChartOfAccounts,
} from "./account-import.ts";

// A miniature of the seeded chart: two system roots, class groups, a few
// typed sub-groups and posting accounts.
const seed = (): ExistingAccount[] => {
  const a = (
    id: string,
    number: string | null,
    name: string,
    isGroup: boolean,
    parentId: string | null,
    cls: ExistingAccount["class"],
    type: ExistingAccount["accountType"],
    extra: Partial<ExistingAccount> = {}
  ): ExistingAccount => ({
    id,
    number,
    name,
    isGroup,
    isSystem: false,
    parentId,
    class: cls,
    accountType: type,
    incomeBalance:
      cls === null
        ? name === "Balance Sheet"
          ? "Balance Sheet"
          : "Income Statement"
        : ["Asset", "Liability", "Equity"].includes(cls)
        ? "Balance Sheet"
        : "Income Statement",
    active: true,
    ...extra,
  });
  return [
    a("bs", null, "Balance Sheet", true, null, null, null, { isSystem: true }),
    a("is", null, "Income Statement", true, null, null, null, { isSystem: true }),
    a("assets", null, "Assets", true, "bs", "Asset", "Other Current Asset"),
    a("cash", null, "Cash & Bank", true, "assets", "Asset", "Bank"),
    a("recv", null, "Receivables", true, "assets", "Asset", "Accounts Receivable"),
    a("liab", null, "Liabilities", true, "bs", "Liability", "Other Current Liability"),
    a("equity", null, "Equity", true, "bs", "Equity", "Equity - No Close"),
    a("rev", null, "Revenue", true, "is", "Revenue", "Income"),
    a("cogs", null, "Cost of Goods Sold", true, "is", "Expense", "Cost of Goods Sold"),
    a("opex", null, "Operating Expenses", true, "is", "Expense", "Expense"),
    a("othexp", null, "Other Expenses", true, "is", "Expense", "Other Expense"),
    a("1010", "1010", "Bank - Cash", false, "cash", "Asset", "Bank"),
    a("1110", "1110", "Accounts Receivable", false, "recv", "Asset", "Accounts Receivable"),
    a("4010", "4010", "Sales", false, "rev", "Revenue", "Income"),
    a("5010", "5010", "Cost of Goods Sold", false, "cogs", "Expense", "Cost of Goods Sold"),
    a("6010", "6010", "Maintenance", false, "opex", "Expense", "Expense"),
  ];
};

const ctx = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  existing: seed(),
  externalIdMap: new Map(),
  postedAccountIds: new Set(),
  protectedAccountIds: new Set(["1110", "4010"]),
  ...overrides,
});

const byName = (plan: ImportPlan, name: string) => {
  const node = plan.nodes.find((n) => n.name === name);
  assert(node, `no node named ${name}`);
  return node;
};

const rows = (...list: Record<string, string>[]) => list;

Deno.test("grouping labels synthesize groups under the class anchor; a label matching a Carbon group adopts it", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "10000", name: "Checking - Mercury", accountType: "Bank", parent: "Cash Accounts" },
      { number: "10010", name: "Savings", accountType: "Bank", parent: "Cash Accounts" },
      { number: "12000", name: "Trade Debtors", accountType: "Accounts Receivable", parent: "Assets" },
      { number: "50000", name: "Materials", accountType: "Cost of Goods Sold", parent: "Direct Costs" }
    ),
    ctx()
  );
  assertEquals(plan.structure, "file");
  assertEquals(plan.signal, "parent");

  const cashGroup = byName(plan, "Cash Accounts");
  assertEquals(cashGroup.action, "create");
  assertEquals(cashGroup.kind, "group");
  assertEquals(cashGroup.class, "Asset");
  // Anchored under the shallowest group with the same accountType (Bank).
  assertEquals(cashGroup.parentId, "cash");
  assertEquals(cashGroup.anchorLabel, "Cash & Bank");

  // A label that names a Carbon group resolves straight to it: no node.
  assert(!plan.nodes.some((n) => n.name === "Assets"));
  const debtors = byName(plan, "Trade Debtors");
  assertEquals(debtors.parentId, "assets");
  assertEquals(debtors.action, "create");

  const direct = byName(plan, "Direct Costs");
  assertEquals(direct.parentId, "cogs");

  assertEquals(plan.summary.errors, 0);
  assertEquals(plan.summary.groupsToCreate, 2);
  assertEquals(plan.summary.accountsToCreate, 4);
});

Deno.test("colon paths split into groups; a parent that is also a row is promoted", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "1000", name: "Current Assets", accountType: "Other Current Asset" },
      { number: "1001", name: "Current Assets:Petty Cash", accountType: "Cash" },
      { number: "1002", name: "Current Assets:Bank:Operating", accountType: "Bank" }
    ),
    ctx()
  );
  assertEquals(plan.signal, "path");
  const current = byName(plan, "Current Assets");
  assertEquals(current.kind, "group");
  assertEquals(current.promoted, true);
  assertEquals(current.number, "1000");
  assertEquals(current.parentId, "assets");

  const petty = byName(plan, "Petty Cash");
  assertEquals(petty.parentKey, current.key);

  const bank = byName(plan, "Bank");
  assertEquals(bank.synthesized, true);
  assertEquals(bank.parentKey, current.key);
  const operating = byName(plan, "Operating");
  assertEquals(operating.parentKey, bank.key);
  assertEquals(plan.summary.errors, 0);

  // Parents precede children in plan order.
  const idx = (name: string) => plan.nodes.findIndex((n) => n.name === name);
  assert(idx("Current Assets") < idx("Petty Cash"));
  assert(idx("Bank") < idx("Operating"));
});

Deno.test("a flat file places leaves under Carbon's groups by account type, then by class", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "200", name: "Business Savings", accountType: "Bank" },
      { number: "820", name: "GST Payable", accountType: "Tax" },
      { number: "310", name: "Cost of Sales", accountType: "Cost of Goods Sold" },
      { number: "404", name: "Bank Fees", accountType: "Expense" },
      { number: "900", name: "Owner Draw", accountType: "Equity - Close" }
    ),
    ctx()
  );
  assertEquals(plan.structure, "carbon");
  assertEquals(byName(plan, "Business Savings").parentId, "cash");
  // Tax → Liability class by default; no Tax-typed group → the class anchor.
  assertEquals(byName(plan, "GST Payable").parentId, "liab");
  assertEquals(byName(plan, "Cost of Sales").parentId, "cogs");
  assertEquals(byName(plan, "Bank Fees").parentId, "opex");
  assertEquals(byName(plan, "Owner Draw").parentId, "equity");
  assertEquals(plan.summary.errors, 0);
});

Deno.test("Begin-Total / End-Total rows build the tree; headings use indentation; totals are skipped", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "1000", name: "ASSETS", rowKind: "Heading", indent: "0", class: "Asset" },
      { number: "1100", name: "Liquid Assets", rowKind: "Group", indent: "1" },
      { number: "1110", name: "Cash", accountType: "Cash", rowKind: "Account", indent: "2" },
      { number: "1120", name: "Bank, Checking", accountType: "Bank", rowKind: "Account", indent: "2" },
      { number: "1199", name: "Liquid Assets, Total", rowKind: "Total", indent: "1" },
      { number: "1200", name: "Inventory", accountType: "Inventory", rowKind: "Account", indent: "1" },
      { number: "2000", name: "LIABILITIES", rowKind: "Heading", indent: "0", class: "Liability" },
      { number: "2100", name: "Vendors", accountType: "Accounts Payable", rowKind: "Account", indent: "1" }
    ),
    ctx()
  );
  assertEquals(plan.signal, "rowKind");
  // A heading named like a Carbon group adopts it (case-insensitive).
  const assetsHeading = byName(plan, "ASSETS");
  assertEquals(assetsHeading.kind, "group");
  assertEquals(assetsHeading.action, "link");
  assertEquals(assetsHeading.existingId, "assets");
  const liquid = byName(plan, "Liquid Assets");
  assertEquals(liquid.parentKey, assetsHeading.key);
  assertEquals(byName(plan, "Cash").parentKey, liquid.key);
  assertEquals(byName(plan, "Liquid Assets, Total").action, "skip");
  // After the total, Inventory hangs off the heading again.
  assertEquals(byName(plan, "Inventory").parentKey, assetsHeading.key);
  // A new heading at indent 0 closes the previous one.
  const liabHeading = byName(plan, "LIABILITIES");
  assertEquals(liabHeading.action, "link");
  assertEquals(liabHeading.existingId, "liab");
  assertEquals(byName(plan, "Vendors").parentKey, liabHeading.key);
  assertEquals(plan.summary.errors, 0);
});

Deno.test("re-importing what Carbon already has reports every row unchanged", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "1010", name: "Bank - Cash", accountType: "Bank" },
      { number: "4010", name: "Sales", accountType: "Income" }
    ),
    ctx()
  );
  assertEquals(plan.summary.unchanged, 2);
  assertEquals(plan.summary.accountsToCreate, 0);
});

Deno.test("a number match renames; a name held by another account is a conflict with a link resolution", () => {
  const first = planChartOfAccounts(
    rows(
      { number: "1010", name: "Operating Account", accountType: "Bank" },
      { number: "11000", name: "Accounts Receivable", accountType: "Accounts Receivable" }
    ),
    ctx()
  );
  const renamed = byName(first, "Operating Account");
  assertEquals(renamed.action, "update");
  assertEquals(renamed.existingId, "1010");
  assertStringIncludes(renamed.changes?.[0] ?? "", "name:");

  const conflict = byName(first, "Accounts Receivable");
  assertEquals(conflict.action, "error");
  assertEquals(conflict.conflict?.existingId, "1110");
  assertEquals(conflict.conflict?.linkable, true);

  // Resolve by linking: Carbon's 1110 becomes the customer's 11000.
  const second = planChartOfAccounts(
    rows(
      { number: "1010", name: "Operating Account", accountType: "Bank" },
      { number: "11000", name: "Accounts Receivable", accountType: "Accounts Receivable" }
    ),
    ctx(),
    { resolutions: { "1": { action: "link", accountId: "1110" } } }
  );
  const linked = byName(second, "Accounts Receivable");
  assertEquals(linked.action, "update");
  assertEquals(linked.existingId, "1110");
  assert(linked.changes?.some((c) => c.startsWith("number: 1110 → 11000")));

  // Or by renaming.
  const third = planChartOfAccounts(
    rows({ number: "11000", name: "Accounts Receivable", accountType: "Accounts Receivable" }),
    ctx(),
    { resolutions: { "0": { action: "rename", name: "Accounts Receivable (11000)" } } }
  );
  assertEquals(byName(third, "Accounts Receivable (11000)").action, "create");
});

Deno.test("system roots are adopted, never written", () => {
  const plan = planChartOfAccounts(
    rows(
      { name: "Balance Sheet", isGroup: "true", class: "Liability" },
      { number: "1500", name: "Deposits", accountType: "Other Current Asset", parent: "Balance Sheet" },
      { number: "9999", name: "Income Statement", accountType: "Income" }
    ),
    ctx()
  );
  // A group row named like the root links to it whatever its class column
  // says, and rows naming it as their parent hang off that link.
  const root = byName(plan, "Balance Sheet");
  assertEquals(root.action, "link");
  assertEquals(root.existingId, "bs");
  assertEquals(byName(plan, "Deposits").parentKey, root.key);
  // A posting account may share a root's name (uniqueness is per kind).
  assertEquals(plan.nodes.find((n) => n.number === "9999")?.action, "create");

  // A numbered heading named like a root (Business Central exports number
  // their headings) links to the root; the file's number is not applied.
  const numbered = planChartOfAccounts(
    rows(
      { number: "10000", name: "BALANCE SHEET", rowKind: "Heading", indent: "0" },
      { number: "10001", name: "ASSETS", rowKind: "Group", indent: "1", class: "Asset" },
      { number: "10100", name: "Cash", accountType: "Cash", rowKind: "Account", indent: "2" }
    ),
    ctx()
  );
  const heading = byName(numbered, "BALANCE SHEET");
  assertEquals(heading.action, "link");
  assertEquals(heading.existingId, "bs");
  // A numbered group named like a Carbon group links to it the same way.
  const assetsGroup = byName(numbered, "ASSETS");
  assertEquals(assetsGroup.action, "link");
  assertEquals(assetsGroup.existingId, "assets");
  assertEquals(byName(numbered, "Cash").parentKey, assetsGroup.key);
  assertEquals(numbered.summary.errors, 0);

  // A link resolution pointing a posting row at a root is refused.
  const forced = planChartOfAccounts(
    rows({ number: "9999", name: "Income Statement", accountType: "Income" }),
    ctx(),
    { resolutions: { "0": { action: "link", accountId: "is" } } }
  );
  assertStringIncludes(forced.nodes[0].reason ?? "", "system account");
});

Deno.test("deactivating a posting default or a posted account is refused; an unmapped Active column changes nothing", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "1110", name: "Accounts Receivable", accountType: "Accounts Receivable", active: "false" },
      { number: "6010", name: "Maintenance", accountType: "Expense", active: "No" },
      { number: "1010", name: "Bank - Cash", accountType: "Bank" }
    ),
    ctx({ postedAccountIds: new Set(["6010"]) })
  );
  assertStringIncludes(byName(plan, "Accounts Receivable").reason ?? "", "posting default");
  assertStringIncludes(byName(plan, "Maintenance").reason ?? "", "journal lines");
  assertEquals(byName(plan, "Bank - Cash").action, "unchanged");

  const inactiveExisting = seed().map((a) => (a.id === "1010" ? { ...a, active: false } : a));
  const untouched = planChartOfAccounts(
    rows({ number: "1010", name: "Bank - Cash", accountType: "Bank" }),
    ctx({ existing: inactiveExisting })
  );
  assertEquals(byName(untouched, "Bank - Cash").action, "unchanged");
  const reactivated = planChartOfAccounts(
    rows({ number: "1010", name: "Bank - Cash", accountType: "Bank", active: "true" }),
    ctx({ existing: inactiveExisting })
  );
  assertEquals(byName(reactivated, "Bank - Cash").changes, ["reactivate"]);
});

Deno.test("an inverted Active header flips the meaning", () => {
  assert(isInvertedActiveHeader("Inactive"));
  assert(isInvertedActiveHeader("Is Hidden"));
  assert(!isInvertedActiveHeader("Active"));
  const plan = planChartOfAccounts(
    rows({ number: "1500", name: "Deposits", accountType: "Other Current Asset", active: "Yes" }),
    ctx(),
    { activeInverted: true }
  );
  assertEquals(byName(plan, "Deposits").active, false);
});

Deno.test("class changes on a posted account are refused; class mismatch with the parent errors the leaf", () => {
  const posted = planChartOfAccounts(
    rows({ number: "4010", name: "Sales", accountType: "Other Current Liability" }),
    ctx({ postedAccountIds: new Set(["4010"]) })
  );
  assertStringIncludes(byName(posted, "Sales").reason ?? "", "journal lines");

  const mixed = planChartOfAccounts(
    rows(
      { number: "7000", name: "Alpha", accountType: "Expense", parent: "Misc" },
      { number: "7001", name: "Beta", accountType: "Expense", parent: "Misc" },
      { number: "7002", name: "Gamma", accountType: "Other Income", parent: "Misc" }
    ),
    ctx()
  );
  assertEquals(byName(mixed, "Misc").class, "Expense");
  const gamma = byName(mixed, "Gamma");
  assertEquals(gamma.action, "error");
  assertStringIncludes(gamma.reason ?? "", "does not match the parent group");
});

Deno.test("moving an existing group under its own descendant is a cycle", () => {
  const existing = seed().concat([
    {
      id: "sub",
      number: null,
      name: "Sub Cash",
      isGroup: true,
      isSystem: false,
      parentId: "cash",
      class: "Asset",
      accountType: "Bank",
      incomeBalance: "Balance Sheet",
      active: true,
    },
  ]);
  const plan = planChartOfAccounts(
    rows(
      { name: "Cash & Bank", isGroup: "true", parent: "Sub Cash" },
      { name: "Sub Cash", isGroup: "true" }
    ),
    ctx({ existing })
  );
  const moved = byName(plan, "Cash & Bank");
  assertEquals(moved.action, "error");
  assertStringIncludes(moved.reason ?? "", "cycle");
});

Deno.test("in-file duplicates, missing names, unmapped types and skips are reported per row", () => {
  const plan = planChartOfAccounts(
    rows(
      { number: "1500", name: "Deposits", accountType: "Other Current Asset" },
      { number: "1500", name: "Deposits Again", accountType: "Other Current Asset" },
      { number: "1600", name: "", accountType: "Other Current Asset" },
      { number: "1700", name: "Mystery", accountType: "" },
      { number: "1800", name: "Skip me", accountType: "Cash" }
    ),
    ctx(),
    { resolutions: { "4": { action: "skip" } } }
  );
  assertStringIncludes(byName(plan, "Deposits Again").reason ?? "", "Duplicate account number");
  assertEquals(plan.nodes[2].action, "error");
  assertStringIncludes(byName(plan, "Mystery").reason ?? "", "Account type is required");
  assertEquals(byName(plan, "Skip me").action, "skip");
  assertEquals(plan.summary.errors, 3);
  assertEquals(plan.summary.skipped, 1);
});

Deno.test("a Source ID matches through the csv mapping and allows renumbering", () => {
  const plan = planChartOfAccounts(
    rows({ number: "1015", name: "Bank - Cash", accountType: "Bank", externalId: "ext-1" }),
    ctx({ externalIdMap: new Map([["ext-1", "1010"]]) })
  );
  const node = byName(plan, "Bank - Cash");
  assertEquals(node.action, "update");
  assertEquals(node.existingId, "1010");
  assertEquals(node.changes, ["number: 1010 → 1015"]);
});

Deno.test("structure=carbon drops file groups; structure=file without signals falls back with a warning", () => {
  const dropped = planChartOfAccounts(
    rows(
      { name: "My Group", isGroup: "true" },
      { number: "1500", name: "Deposits", accountType: "Other Current Asset", parent: "My Group" }
    ),
    ctx(),
    { structure: "carbon" }
  );
  assertEquals(byName(dropped, "My Group").action, "skip");
  assertEquals(byName(dropped, "Deposits").parentId, "assets");

  const fallback = planChartOfAccounts(
    rows({ number: "1500", name: "Deposits", accountType: "Other Current Asset" }),
    ctx(),
    { structure: "file" }
  );
  assertEquals(fallback.structure, "carbon");
  assertEquals(fallback.warnings.length, 1);
});
