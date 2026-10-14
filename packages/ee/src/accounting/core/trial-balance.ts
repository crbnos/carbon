// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { round } from "@carbon/utils";
import { ProviderID } from "./models";

/**
 * Trial balance pulled from the connected accounting provider, as of one
 * date, and mapped onto Carbon accounts. Used by the accounting activation
 * wizard to fill the prior system's balances as of the day before the
 * cutover.
 *
 * This file is PURE (no provider classes, no database) so the provider
 * adapters can import their parsers from here without a cycle, and the
 * tests need nothing but fixtures. The provider dispatch and the server
 * entry live in `remote-trial-balance.ts`.
 */

/**
 * One account line of a provider's trial balance. `debitSigned` is the
 * account's balance as at the report date: debit positive, credit negative.
 * `externalId` is the provider's account id (Xero AccountID, QBO Id) — null
 * for a computed line the provider does not tie to an account; such a line is
 * still returned so the user can see it.
 */
export type RemoteTrialBalanceRow = {
  externalId: string | null;
  code: string | null;
  name: string;
  debitSigned: number;
};

/**
 * The providers `fetchRemoteTrialBalance` can read a trial balance from. The
 * wizard offers the pull only for these; `remote-trial-balance.test.ts` pins
 * the two together.
 */
const TRIAL_BALANCE_PROVIDERS: ReadonlySet<string> = new Set<ProviderID>([
  ProviderID.XERO,
  ProviderID.QUICKBOOKS,
  ProviderID.RILLET
]);

export function isTrialBalanceProvider(id: string): id is ProviderID {
  return TRIAL_BALANCE_PROVIDERS.has(id);
}

export type RemoteTrialBalance =
  | { supported: false }
  | { supported: true; rows: RemoteTrialBalanceRow[] };

/**
 * Why a trial balance could not be pulled. The route turns each into a
 * message for the user; `message` is already written for the user.
 *
 * - `not_connected` — the company has no active integration for the provider
 * - `unsupported` — the provider has no trial balance reader
 * - `reconnect` — the provider refused the token (expired grant, or a token
 *   minted before the report scope was requested); reconnecting fixes it
 * - `rate_limited` — the provider throttled the request; retry later
 * - `failed` — anything else (provider error, unexpected report shape)
 */
export type TrialBalancePullErrorReason =
  | "not_connected"
  | "unsupported"
  | "reconnect"
  | "rate_limited"
  | "failed";

export class TrialBalancePullError extends Error {
  constructor(
    public readonly reason: TrialBalancePullErrorReason,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "TrialBalancePullError";
  }
}

export function isTrialBalancePullError(
  error: unknown
): error is TrialBalancePullError {
  return error instanceof TrialBalancePullError;
}

/**
 * Parse a report amount string. Reports send "" for an empty cell, and may
 * format with thousands separators or accounting parentheses for negatives.
 * An unreadable value throws: reading it as 0 would silently drop a balance.
 */
export function parseReportAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Unreadable report amount "${value}"`);
    }
    return value;
  }

  let text = value.trim().replace(/,/g, "");
  if (text === "") return 0;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  const amount = Number(text);
  if (text === "" || !Number.isFinite(amount)) {
    throw new Error(`Unreadable report amount "${value}"`);
  }

  return negative ? -amount : amount;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ---------------------------------------------------------------------------
// Xero — GET /Reports/TrialBalance?date=YYYY-MM-DD
// ---------------------------------------------------------------------------

export type XeroReportCell = {
  Value?: string | null;
  Attributes?: Array<{ Id?: string | null; Value?: string | null }> | null;
};

export type XeroReportRow = {
  RowType?: string | null;
  Title?: string | null;
  Cells?: XeroReportCell[] | null;
  Rows?: XeroReportRow[] | null;
};

export type XeroTrialBalanceResponse = {
  Reports?: Array<{
    ReportName?: string | null;
    ReportType?: string | null;
    Rows?: XeroReportRow[] | null;
  }> | null;
};

/** Xero writes an account as "Name (Code)"; a code-less account is just "Name". */
export function splitXeroAccountLabel(label: string): {
  name: string;
  code: string | null;
} {
  const match = /^(.*\S)\s*\(([^()]+)\)\s*$/.exec(label.trim());
  if (!match) return { name: label.trim(), code: null };
  return { name: match[1]!.trim(), code: match[2]!.trim() };
}

function xeroAccountId(cells: XeroReportCell[]): string | null {
  for (const cell of cells) {
    for (const attribute of cell.Attributes ?? []) {
      if (attribute.Id === "account" && attribute.Value) {
        return attribute.Value;
      }
    }
  }
  return null;
}

/**
 * Reduce Xero's Trial Balance report to one row per account.
 *
 * The report has five columns: Account, Debit, Credit, YTD Debit, YTD Credit.
 * Debit / Credit are the MOVEMENT in the month of the report date. YTD Debit /
 * YTD Credit are the balance as at the date: cumulative for balance sheet
 * accounts, fiscal-year-to-date for profit and loss accounts, with prior years
 * closed into Retained Earnings — the column pair that totals to a balanced
 * trial balance. So the balance is YTD Debit − YTD Credit. The columns are
 * found by their header titles, not by position.
 *
 * SummaryRow lines (section and grand totals) are skipped. A Row without an
 * `account` attribute is a line Xero computes; it is returned with a null
 * `externalId` so the caller can show it as unmapped.
 */
export function parseXeroTrialBalance(
  response: XeroTrialBalanceResponse
): RemoteTrialBalanceRow[] {
  const report = response.Reports?.[0];
  if (!report) {
    throw new Error("Xero returned no trial balance report");
  }

  const rows = report.Rows ?? [];
  const header = rows.find((row) => row.RowType === "Header");
  const titles = (header?.Cells ?? []).map((cell) =>
    normalizeTitle(cell.Value)
  );
  const debitIndex = titles.indexOf("ytd debit");
  const creditIndex = titles.indexOf("ytd credit");
  if (debitIndex < 0 || creditIndex < 0) {
    throw new Error(
      "Xero trial balance has no YTD Debit and YTD Credit columns"
    );
  }

  const result: RemoteTrialBalanceRow[] = [];

  const visit = (row: XeroReportRow) => {
    if (row.RowType === "Section") {
      for (const child of row.Rows ?? []) visit(child);
      return;
    }
    if (row.RowType !== "Row") return;

    const cells = row.Cells ?? [];
    const label = cells[0]?.Value?.trim() ?? "";
    const { name, code } = splitXeroAccountLabel(label);
    const debit = parseReportAmount(cells[debitIndex]?.Value);
    const credit = parseReportAmount(cells[creditIndex]?.Value);

    result.push({
      externalId: xeroAccountId(cells),
      code,
      name,
      debitSigned: round(debit - credit)
    });
  };

  for (const row of rows) visit(row);

  return result;
}

// ---------------------------------------------------------------------------
// QuickBooks Online — GET /reports/TrialBalance?end_date=YYYY-MM-DD
// ---------------------------------------------------------------------------

export type QboReportColData = {
  value?: string | null;
  id?: string | null;
};

export type QboReportRow = {
  type?: string | null;
  group?: string | null;
  ColData?: QboReportColData[] | null;
  Header?: { ColData?: QboReportColData[] | null } | null;
  Rows?: { Row?: QboReportRow[] | null } | null;
  Summary?: { ColData?: QboReportColData[] | null } | null;
};

export type QboTrialBalanceResponse = {
  Header?: Record<string, unknown> | null;
  Columns?: {
    Column?: Array<{
      ColTitle?: string | null;
      ColType?: string | null;
    }> | null;
  } | null;
  Rows?: { Row?: QboReportRow[] | null } | null;
};

/**
 * Reduce QuickBooks Online's TrialBalance report to one row per account.
 *
 * The report has an Account column and a Debit and a Credit column, found by
 * `ColTitle`. Account lines are Data rows (`ColData`, first cell carries the
 * account `id`); Section rows nest more rows under `Rows.Row`. Only Data rows
 * are read: a Section's `Header` is a label and its `Summary` is a total
 * (including the GrandTotal), so reading either would count balances twice.
 * QBO shows no account code on the row, so `code` is null and the caller
 * resolves by id.
 */
export function parseQboTrialBalance(
  response: QboTrialBalanceResponse
): RemoteTrialBalanceRow[] {
  const titles = (response.Columns?.Column ?? []).map((column) =>
    normalizeTitle(column.ColTitle)
  );
  const debitIndex = titles.indexOf("debit");
  const creditIndex = titles.indexOf("credit");
  if (debitIndex < 0 || creditIndex < 0) {
    throw new Error(
      "QuickBooks Online trial balance has no Debit and Credit columns"
    );
  }

  const result: RemoteTrialBalanceRow[] = [];

  const visit = (row: QboReportRow) => {
    for (const child of row.Rows?.Row ?? []) visit(child);

    const cells = row.ColData;
    if (!cells || cells.length === 0) return;

    const debit = parseReportAmount(cells[debitIndex]?.value);
    const credit = parseReportAmount(cells[creditIndex]?.value);
    const id = cells[0]?.id;

    result.push({
      externalId: id ? id : null,
      code: null,
      name: cells[0]?.value?.trim() ?? "",
      debitSigned: round(debit - credit)
    });
  };

  for (const row of response.Rows?.Row ?? []) visit(row);

  return result;
}

// ---------------------------------------------------------------------------
// Rillet — GET /reports/trial-balance?from_date&to_date[&subsidiary_id]
// ---------------------------------------------------------------------------

type RilletAmount = { amount?: string | null } | null | undefined;

export type RilletTrialBalanceAccount = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  beginning_balance?: RilletAmount;
  debit_total?: RilletAmount;
  credit_total?: RilletAmount;
  debit_fx_total?: RilletAmount;
  credit_fx_total?: RilletAmount;
  ending_balance?: RilletAmount;
};

export type RilletTrialBalanceResponse = {
  accounts?: RilletTrialBalanceAccount[] | null;
};

/** Rillet's account types; the natural side of each decides its sign. */
export type RilletAccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "EXPENSE"
  | "INCOME";

const RILLET_CREDIT_NATURED = new Set(["LIABILITY", "EQUITY", "INCOME"]);

/** Half a cent: report amounts are rounded to the currency's decimals. */
const REPORT_TOLERANCE = 0.005;

/**
 * Reduce Rillet's trial balance to one row per account, the balance at the
 * report's `to_date`.
 *
 * Rillet's docs do not say how `ending_balance` is signed, so the parser
 * reads it both ways — debit-signed, and positive on each account's natural
 * side (credit for LIABILITY, EQUITY and INCOME, by `accountTypes`) — and
 * keeps the reading that agrees with the report itself: every account's
 * `ending − beginning` must equal its period movement signed the same way,
 * and the debit-signed balances must total zero. When neither reading
 * agrees, or both do and give different balances, it throws rather than
 * guess.
 */
export function parseRilletTrialBalance(
  response: RilletTrialBalanceResponse,
  accountTypes: ReadonlyMap<string, string>
): RemoteTrialBalanceRow[] {
  const accounts = (response.accounts ?? []).map((account) => {
    const debits =
      parseReportAmount(account.debit_total?.amount) +
      parseReportAmount(account.debit_fx_total?.amount);
    const credits =
      parseReportAmount(account.credit_total?.amount) +
      parseReportAmount(account.credit_fx_total?.amount);
    const creditNatured = RILLET_CREDIT_NATURED.has(
      accountTypes.get(account.id ?? "") ?? ""
    );
    return {
      account,
      creditNatured,
      beginning: parseReportAmount(account.beginning_balance?.amount),
      ending: parseReportAmount(account.ending_balance?.amount),
      movement: debits - credits
    };
  });

  // A reading turns a reported amount into a debit-signed one.
  const readings = {
    debitSigned: (amount: number) => amount,
    natural: (amount: number, creditNatured: boolean) =>
      creditNatured ? -amount : amount
  };
  const agrees = (read: (amount: number, creditNatured: boolean) => number) => {
    let total = 0;
    for (const row of accounts) {
      const change =
        read(row.ending, row.creditNatured) -
        read(row.beginning, row.creditNatured);
      if (Math.abs(change - row.movement) > REPORT_TOLERANCE) return false;
      total += read(row.ending, row.creditNatured);
    }
    return Math.abs(total) <= REPORT_TOLERANCE * Math.max(accounts.length, 1);
  };

  const debitSignedAgrees = agrees(readings.debitSigned);
  const naturalAgrees = agrees(readings.natural);
  const toRows = (read: (amount: number, creditNatured: boolean) => number) =>
    accounts.map(({ account, creditNatured, ending }) => ({
      externalId: account.id ? account.id : null,
      code: account.code ? account.code : null,
      name: account.name?.trim() || account.code || "",
      debitSigned: round(read(ending, creditNatured))
    }));

  if (debitSignedAgrees && naturalAgrees) {
    const a = toRows(readings.debitSigned);
    const b = toRows(readings.natural);
    // Equal when no credit-natured account carries a balance.
    if (a.every((row, index) => row.debitSigned === b[index]!.debitSigned)) {
      return a;
    }
    throw new Error(
      "Rillet's trial balance can be read with either sign; enter the balances by hand"
    );
  }
  if (debitSignedAgrees) return toRows(readings.debitSigned);
  if (naturalAgrees) return toRows(readings.natural);
  throw new Error(
    "Rillet's trial balance does not balance as read; enter the balances by hand"
  );
}

// ---------------------------------------------------------------------------
// Mapping onto Carbon accounts
// ---------------------------------------------------------------------------

export type TrialBalanceAccountMapping = {
  accountId: string;
  externalId: string | null;
  externalCode: string | null;
};

export type TrialBalanceCarbonAccount = {
  id: string;
  number: string | null;
  isGroup: boolean;
  active: boolean;
};

/** A Carbon trial balance line: positive debit OR positive credit. */
export type PulledTrialBalanceLine = {
  accountId: string;
  debit: number;
  credit: number;
};

export type UnmappedTrialBalanceRow = {
  externalId: string | null;
  code: string | null;
  name: string;
  /** Debit-signed balance: debit positive, credit negative. */
  amount: number;
};

export type AmbiguousTrialBalanceRow = UnmappedTrialBalanceRow & {
  accountIds: string[];
};

export type MappedTrialBalance = {
  lines: PulledTrialBalanceLine[];
  unmapped: UnmappedTrialBalanceRow[];
  ambiguous: AmbiguousTrialBalanceRow[];
};

function addToIndex(
  index: Map<string, Set<string>>,
  key: string | null | undefined,
  accountId: string
) {
  if (!key) return;
  const set = index.get(key) ?? new Set<string>();
  set.add(accountId);
  index.set(key, set);
}

/**
 * Put a provider trial balance onto Carbon accounts.
 *
 * Each remote row resolves through the first of these that names at least
 * one active, non-group Carbon account:
 *   1. an account mapping on the row's external id
 *   2. an account mapping whose external code equals the row's code
 *   3. a Carbon account whose number equals the row's code
 * One account → the row's balance is added to it. Several → the row is
 * AMBIGUOUS (several Carbon accounts mapped to one remote account, or a
 * duplicated number) and is not guessed. None → UNMAPPED.
 *
 * Several remote rows on one Carbon account are summed, then rounded once.
 * Zero balances are dropped from every list.
 */
export function mapRemoteTrialBalance(
  rows: RemoteTrialBalanceRow[],
  mappings: TrialBalanceAccountMapping[],
  carbonAccounts: TrialBalanceCarbonAccount[]
): MappedTrialBalance {
  const postable = new Set(
    carbonAccounts
      .filter((account) => account.active && !account.isGroup)
      .map((account) => account.id)
  );

  const byExternalId = new Map<string, Set<string>>();
  const byExternalCode = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    if (!postable.has(mapping.accountId)) continue;
    addToIndex(byExternalId, mapping.externalId, mapping.accountId);
    addToIndex(byExternalCode, mapping.externalCode, mapping.accountId);
  }

  const byNumber = new Map<string, Set<string>>();
  for (const account of carbonAccounts) {
    if (!postable.has(account.id)) continue;
    addToIndex(byNumber, account.number, account.id);
  }

  const resolve = (row: RemoteTrialBalanceRow): string[] => {
    const tiers = [
      row.externalId ? byExternalId.get(row.externalId) : undefined,
      row.code ? byExternalCode.get(row.code) : undefined,
      row.code ? byNumber.get(row.code) : undefined
    ];
    for (const tier of tiers) {
      if (tier && tier.size > 0) return [...tier];
    }
    return [];
  };

  const netByAccount = new Map<string, number>();
  const unmapped: UnmappedTrialBalanceRow[] = [];
  const ambiguous: AmbiguousTrialBalanceRow[] = [];

  for (const row of rows) {
    const amount = round(row.debitSigned);
    if (amount === 0) continue;

    const remote = {
      externalId: row.externalId,
      code: row.code,
      name: row.name,
      amount
    };

    const accountIds = resolve(row);
    if (accountIds.length === 0) {
      unmapped.push(remote);
    } else if (accountIds.length > 1) {
      ambiguous.push({ ...remote, accountIds });
    } else {
      const accountId = accountIds[0]!;
      netByAccount.set(
        accountId,
        (netByAccount.get(accountId) ?? 0) + row.debitSigned
      );
    }
  }

  const lines: PulledTrialBalanceLine[] = [];
  for (const [accountId, total] of netByAccount) {
    const net = round(total);
    if (net === 0) continue;
    lines.push({
      accountId,
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0
    });
  }

  return { lines, unmapped, ambiguous };
}
