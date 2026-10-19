// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two files of a chart of accounts import. The chart says which accounts
// exist; the default accounts file says which of them each default role uses.
// Pure: the route plans and applies the rows
// (.ai/specs/2026-10-12-chart-of-accounts-import.md).

import {
  ACCOUNT_DEFAULT_COLUMNS,
  ACCOUNT_TYPES,
  type AccountImportContext,
  type AccountType,
  assetClassKey,
  assetClassLabel,
  type ChartImportRow,
  classOfAccountType,
  type DefaultImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  ROLE_NAMES,
  requiredRoles
} from "@carbon/database/account-import";
import type { AccountClass } from "@carbon/database/ledger";
import { type CsvLine, parseCsvLines } from "@carbon/files/csv";

/** The columns of the chart template, in order. */
export const CHART_CSV_COLUMNS = [
  "Account Number",
  "Account Name",
  "Class",
  "Type",
  "Group"
] as const;

type ChartTemplateRow = Record<(typeof CHART_CSV_COLUMNS)[number], string>;

/** The chart template: the group's active accounts, by number, under their
 *  group. Uploaded unchanged, it keeps every account as it is. */
export function chartTemplate(ctx: AccountImportContext): ChartTemplateRow[] {
  const groupName = new Map(
    ctx.chart.filter((a) => a.isGroup).map((a) => [a.id, a.name])
  );
  return ctx.chart
    .filter((a) => !a.isGroup && a.active)
    .sort((a, b) =>
      (a.number ?? "").localeCompare(b.number ?? "", undefined, {
        numeric: true
      })
    )
    .map((a) => ({
      "Account Number": a.number ?? "",
      "Account Name": a.name,
      Class: a.class ?? "",
      Type: a.accountType ?? "",
      Group: a.parentId ? (groupName.get(a.parentId) ?? "") : ""
    }));
}

/** The columns of the default accounts template, in order. */
export const DEFAULT_ACCOUNTS_CSV_COLUMNS = [
  "Key",
  "Default",
  "Required",
  "Current Account",
  "Account Number"
] as const;

type DefaultAccountsTemplateRow = Record<
  (typeof DEFAULT_ACCOUNTS_CSV_COLUMNS)[number],
  string
>;

/** The default accounts template: one row per default role of the importing
 *  company, then one per account of each fixed asset class in the group. The
 *  Account Number column is left blank for the customer's numbers. */
export function defaultAccountsTemplate(
  ctx: AccountImportContext
): DefaultAccountsTemplateRow[] {
  const accountById = new Map(ctx.chart.map((a) => [a.id, a]));
  const label = (accountId: string | null | undefined) => {
    const account = accountId ? accountById.get(accountId) : undefined;
    if (!account) return "";
    return account.number ? `${account.number} ${account.name}` : account.name;
  };
  const required = new Set<string>(requiredRoles());
  const defaults = ctx.defaultsByCompany[ctx.importingCompanyId];

  const roles = ACCOUNT_DEFAULT_COLUMNS.map((column) => ({
    Key: column,
    Default: ROLE_NAMES[column],
    Required: required.has(column) ? "Yes" : "No",
    "Current Account": label(defaults?.[column]),
    "Account Number": ""
  }));

  // Every class name of the group: the planner needs each one's accounts.
  // The importing company's class shows its current accounts.
  const classByName = new Map<string, (typeof ctx.fixedAssetClasses)[number]>();
  for (const fac of ctx.fixedAssetClasses) {
    const seen = classByName.get(fac.name);
    if (!seen || fac.companyId === ctx.importingCompanyId) {
      classByName.set(fac.name, fac);
    }
  }
  const assetClasses = [...classByName.values()].flatMap((fac) =>
    FIXED_ASSET_CLASS_COLUMNS.map((column) => ({
      Key: assetClassKey(fac.name, column),
      Default: assetClassLabel(fac.name, column),
      Required: "Yes",
      "Current Account": label(fac.accounts[column]),
      "Account Number": ""
    }))
  );

  return [...roles, ...assetClasses];
}

/** Why a file was not read. `line` is the line in the file; the header is 1. */
export type AccountImportCsvError =
  | { code: "empty-file" }
  | { code: "unreadable-file" }
  | { code: "too-large" }
  | { code: "missing-columns"; columns: string[] }
  | { code: "missing-number"; line: number }
  | { code: "missing-name"; line: number }
  | { code: "missing-group"; line: number }
  | { code: "missing-key"; line: number }
  | { code: "invalid-class"; line: number; value: string };

type CsvResult<Row> =
  | { rows: Row[]; errors: null }
  | { rows: null; errors: AccountImportCsvError[] };

const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const CLASS_SYNONYMS: Record<string, AccountClass> = {
  asset: "Asset",
  assets: "Asset",
  liability: "Liability",
  liabilities: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  revenues: "Revenue",
  income: "Revenue",
  "other income": "Revenue",
  expense: "Expense",
  expenses: "Expense",
  "other expense": "Expense",
  "cost of goods sold": "Expense",
  "cost of sales": "Expense"
};

/** An account class from the words a chart export uses, or null. */
export function normalizeAccountClass(value: string): AccountClass | null {
  return CLASS_SYNONYMS[normalize(value)] ?? null;
}

const TYPE_SYNONYMS: Record<string, AccountType> = {
  "accounts receivable (a/r)": "Accounts Receivable",
  "accounts payable (a/p)": "Accounts Payable",
  "current asset": "Other Current Asset",
  "current assets": "Other Current Asset",
  "other current assets": "Other Current Asset",
  "fixed assets": "Fixed Asset",
  "other assets": "Other Asset",
  "current liability": "Other Current Liability",
  "current liabilities": "Other Current Liability",
  "other current liabilities": "Other Current Liability",
  "credit card": "Other Current Liability",
  "long term liabilities": "Long Term Liability",
  "long-term liability": "Long Term Liability",
  equity: "Equity - No Close",
  "cost of sales": "Cost of Goods Sold",
  cogs: "Cost of Goods Sold",
  expenses: "Expense",
  "other expenses": "Other Expense",
  revenue: "Income"
};

/** A Carbon account type from the words a chart export uses, or null. */
export function normalizeAccountType(value: string): AccountType | null {
  const wanted = normalize(value);
  const exact = ACCOUNT_TYPES.find((t) => normalize(t) === wanted);
  return exact ?? TYPE_SYNONYMS[wanted] ?? null;
}

/** The header and the records after it, or why the file cannot be read. */
function readCsv(
  csv: string
):
  | { header: string[]; records: CsvLine[]; error: null }
  | { error: AccountImportCsvError } {
  const { lines, errors } = parseCsvLines(csv);
  if (errors.some((e) => e.type === "Quotes")) {
    return { error: { code: "unreadable-file" } };
  }
  const [header, ...records] = lines;
  if (!header) return { error: { code: "empty-file" } };
  return {
    header: header.cells.map(normalize),
    records,
    error: null
  };
}

// Header names other systems export, in the order they are tried. A column
// is used once, so "Account" names the number when both could match.
const CHART_COLUMN_ALIASES = {
  number: [
    "account number",
    "account code",
    "account no",
    "account num",
    "acct number",
    "acct code",
    "acct no",
    "gl account",
    "gl account number",
    "gl code",
    "code",
    "number",
    "no",
    "account"
  ],
  name: [
    "account name",
    "name",
    "account description",
    "account title",
    "description",
    "title",
    "full name"
  ],
  class: [
    "class",
    "account class",
    "account type",
    "category",
    "account category",
    "classification",
    "type"
  ],
  type: [
    "account subtype",
    "subtype",
    "sub type",
    "detail type",
    "account detail type",
    "type"
  ],
  group: [
    "group",
    "group name",
    "account group",
    "parent grouping",
    "parent group",
    "grouping",
    "parent account",
    "parent",
    "report group"
  ],
  status: ["status", "active", "is active", "account status"]
} as const;

type ChartField = keyof typeof CHART_COLUMN_ALIASES;

const CHART_FIELD_LABELS: Record<"number" | "name" | "group", string> = {
  number: "Account Number",
  name: "Account Name",
  group: "Group"
};

/** The column index of each field: the first unused header that matches. */
function matchColumns(header: string[]) {
  const columns: Partial<Record<ChartField, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(CHART_COLUMN_ALIASES) as ChartField[]) {
    for (const alias of CHART_COLUMN_ALIASES[field]) {
      const index = header.findIndex((h, i) => !used.has(i) && h === alias);
      if (index !== -1) {
        columns[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return columns;
}

const INACTIVE = new Set(["inactive", "archived", "false", "no", "0"]);

/** The customer's chart of accounts: one row per account. */
export function parseChartCsv(csv: string): CsvResult<ChartImportRow> {
  const file = readCsv(csv);
  if (file.error) return { rows: null, errors: [file.error] };
  const columns = matchColumns(file.header);
  const missing = (["number", "name", "group"] as const)
    .filter((field) => columns[field] === undefined)
    .map((field) => CHART_FIELD_LABELS[field]);
  if (missing.length > 0) {
    return {
      rows: null,
      errors: [{ code: "missing-columns", columns: missing }]
    };
  }
  if (file.records.length === 0) {
    return { rows: null, errors: [{ code: "empty-file" }] };
  }

  const errors: AccountImportCsvError[] = [];
  const rows: ChartImportRow[] = [];
  for (const { line, cells } of file.records) {
    const read = (field: ChartField) => {
      const index = columns[field];
      return index === undefined ? "" : (cells[index] ?? "");
    };
    // An inactive account in the export is not part of the new chart.
    if (INACTIVE.has(normalize(read("status")))) continue;
    const number = read("number");
    const name = read("name");
    const group = read("group");
    if (!number) errors.push({ code: "missing-number", line });
    if (!name) errors.push({ code: "missing-name", line });
    if (!group) errors.push({ code: "missing-group", line });

    // Exports often put a type ("Bank") in the class column.
    const classValue = read("class");
    const namedClass = classValue ? normalizeAccountClass(classValue) : null;
    const typeInClass =
      classValue && !namedClass ? normalizeAccountType(classValue) : null;
    const accountClass =
      namedClass ?? (typeInClass ? classOfAccountType(typeInClass) : null);
    if (classValue && !accountClass) {
      errors.push({ code: "invalid-class", line, value: classValue });
    }
    // A detail type Carbon has no type for falls back to the class's default.
    const typeValue = read("type");
    const accountType: AccountType | null =
      (typeValue ? normalizeAccountType(typeValue) : null) ?? typeInClass;

    if (!number || !name || !group) continue;
    rows.push({ line, number, name, class: accountClass, accountType, group });
  }

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}

/** The default accounts file: one row per default role, with the number of
 *  the customer's account that takes it. */
export function parseDefaultsCsv(csv: string): CsvResult<DefaultImportRow> {
  const file = readCsv(csv);
  if (file.error) return { rows: null, errors: [file.error] };
  // The key is what the template writes; a hand-made file may name the
  // default by its label instead.
  const keyIndex = [
    file.header.indexOf("key"),
    file.header.indexOf("default")
  ].find((i) => i !== -1);
  const numberIndex = file.header.indexOf("account number");
  if (keyIndex === undefined || numberIndex === -1) {
    return {
      rows: null,
      errors: [
        {
          code: "missing-columns",
          columns: [
            ...(keyIndex === undefined ? ["Key"] : []),
            ...(numberIndex === -1 ? ["Account Number"] : [])
          ]
        }
      ]
    };
  }
  if (file.records.length === 0) {
    return { rows: null, errors: [{ code: "empty-file" }] };
  }

  const errors: AccountImportCsvError[] = [];
  const rows: DefaultImportRow[] = [];
  for (const { line, cells } of file.records) {
    const key = cells[keyIndex] ?? "";
    if (!key) {
      errors.push({ code: "missing-key", line });
      continue;
    }
    rows.push({ line, key, number: cells[numberIndex] || null });
  }

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}
