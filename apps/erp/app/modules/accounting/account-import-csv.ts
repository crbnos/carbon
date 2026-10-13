// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two files of a chart of accounts import. The chart says which accounts
// exist; the default accounts file says which of them each default role uses.
// Pure: the route plans and applies the rows
// (.ai/specs/2026-10-12-chart-of-accounts-import.md).

import {
  ACCOUNT_DEFAULT_COLUMNS,
  type AccountImportContext,
  type AccountType,
  assetClassKey,
  assetClassLabel,
  type ChartImportRow,
  classOfAccountType,
  type DefaultImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  normalizeAccountClass,
  normalizeAccountType,
  ROLE_NAMES,
  requiredRoles
} from "@carbon/database/account-import";
import { parseCsv } from "@carbon/files/csv";

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
  | { code: "missing-columns"; columns: string[] }
  | { code: "missing-number"; line: number }
  | { code: "missing-name"; line: number }
  | { code: "missing-group"; line: number }
  | { code: "missing-key"; line: number }
  | { code: "invalid-class"; line: number; value: string };

type CsvResult<Row> =
  | { rows: Row[]; errors: null }
  | { rows: null; errors: AccountImportCsvError[] };

const text = (value: unknown) => String(value ?? "").trim();
const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

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

function matchColumns(fields: string[]) {
  const columns: Partial<Record<ChartField, string>> = {};
  const used = new Set<string>();
  for (const field of Object.keys(CHART_COLUMN_ALIASES) as ChartField[]) {
    for (const alias of CHART_COLUMN_ALIASES[field]) {
      const match = fields.find(
        (header) => !used.has(header) && normalize(header) === alias
      );
      if (match) {
        columns[field] = match;
        used.add(match);
        break;
      }
    }
  }
  return columns;
}

const INACTIVE = new Set(["inactive", "archived", "false", "no", "0"]);

/** The customer's chart of accounts: one row per account. */
export function parseChartCsv(csv: string): CsvResult<ChartImportRow> {
  if (csv.trim() === "")
    return { rows: null, errors: [{ code: "empty-file" }] };
  const parsed = parseCsv<Record<string, unknown>>(csv);
  const columns = matchColumns(parsed.fields);
  const missing = (["number", "name", "group"] as const)
    .filter((field) => !columns[field])
    .map((field) => CHART_FIELD_LABELS[field]);
  if (missing.length > 0) {
    return {
      rows: null,
      errors: [{ code: "missing-columns", columns: missing }]
    };
  }
  if (parsed.rows.length === 0) {
    return { rows: null, errors: [{ code: "empty-file" }] };
  }

  const read = (row: Record<string, unknown>, field: ChartField) => {
    const column = columns[field];
    return column ? text(row[column]) : "";
  };

  const errors: AccountImportCsvError[] = [];
  const rows: ChartImportRow[] = [];
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    // An inactive account in the export is not part of the new chart.
    if (INACTIVE.has(normalize(read(row, "status")))) return;
    const number = read(row, "number");
    const name = read(row, "name");
    const group = read(row, "group");
    if (!number) errors.push({ code: "missing-number", line });
    if (!name) errors.push({ code: "missing-name", line });
    if (!group) errors.push({ code: "missing-group", line });

    // Exports often put a type ("Bank") in the class column.
    const classValue = read(row, "class");
    const namedClass = classValue ? normalizeAccountClass(classValue) : null;
    const typeInClass =
      classValue && !namedClass ? normalizeAccountType(classValue) : null;
    const accountClass =
      namedClass ?? (typeInClass ? classOfAccountType(typeInClass) : null);
    if (classValue && !accountClass) {
      errors.push({ code: "invalid-class", line, value: classValue });
    }
    // A detail type Carbon has no type for falls back to the class's default.
    const typeValue = read(row, "type");
    const accountType: AccountType | null =
      (typeValue ? normalizeAccountType(typeValue) : null) ?? typeInClass;

    if (!number || !name || !group) return;
    rows.push({ line, number, name, class: accountClass, accountType, group });
  });

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}

/** The default accounts file: one row per default role, with the number of
 *  the customer's account that takes it. */
export function parseDefaultsCsv(csv: string): CsvResult<DefaultImportRow> {
  if (csv.trim() === "")
    return { rows: null, errors: [{ code: "empty-file" }] };
  const parsed = parseCsv<Record<string, unknown>>(csv);
  const find = (name: string) =>
    parsed.fields.find((header) => normalize(header) === normalize(name));
  // The key is what the template writes; a hand-made file may name the
  // default by its label instead.
  const keyColumn = find("Key") ?? find("Default");
  const numberColumn = find("Account Number");
  const missing = [
    ...(keyColumn ? [] : ["Key"]),
    ...(numberColumn ? [] : ["Account Number"])
  ];
  if (missing.length > 0 || !keyColumn || !numberColumn) {
    return {
      rows: null,
      errors: [{ code: "missing-columns", columns: missing }]
    };
  }
  if (parsed.rows.length === 0) {
    return { rows: null, errors: [{ code: "empty-file" }] };
  }

  const errors: AccountImportCsvError[] = [];
  const rows: DefaultImportRow[] = [];
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const key = text(row[keyColumn]);
    if (!key) {
      errors.push({ code: "missing-key", line });
      return;
    }
    rows.push({ line, key, number: text(row[numberColumn]) || null });
  });

  return errors.length > 0 ? { rows: null, errors } : { rows, errors: null };
}
