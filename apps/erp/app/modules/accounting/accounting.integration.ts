import { createHash } from "node:crypto";
import type { JournalEntryImportEntry } from "./accounting.models";

/**
 * Pure, DB-independent helpers for the v1 integration surface
 * (.ai/specs/2026-07-04-integration-surface.md).
 *
 * Kept free of Supabase/Kysely so they are unit-testable without a running
 * stack and reusable across the REST routes and the MCP executor.
 */

// --- Idempotency -----------------------------------------------------------

/**
 * Deterministic JSON serialization with recursively sorted object keys, so two
 * semantically-identical request bodies hash to the same value regardless of
 * key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** sha256 (hex) of the canonicalized request body — the idempotency fingerprint. */
export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(canonicalJson(body)).digest("hex");
}

// --- Keyset pagination cursor ---------------------------------------------

/** Opaque cursor over `account.number` for trial-balance keyset pagination. */
export function encodeCursor(accountNumber: string): string {
  return Buffer.from(accountNumber, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): string | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

// --- Import entry structural validation ------------------------------------

export type ImportEntryError = {
  path: string;
  message: string;
};

/**
 * Cross-line structural checks the per-line zod validator cannot express: the
 * entry must balance to the cent. Per-line debit/credit exclusivity and the
 * <=500-line cap are already enforced by `journalEntryImportValidator`; this is
 * the money-balance gate that mirrors `postJournalEntry`'s tolerance (0.001).
 *
 * Account-number and dimension resolution are NOT done here — they require the
 * company's chart of accounts and belong in the service layer.
 */
export function validateImportEntryBalance(
  entry: Pick<JournalEntryImportEntry, "lines">
): ImportEntryError[] {
  const errors: ImportEntryError[] = [];

  const totalDebit = entry.lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
  const totalCredit = entry.lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    errors.push({
      path: "lines",
      message: `Entry does not balance: debits ${totalDebit.toFixed(
        2
      )} != credits ${totalCredit.toFixed(2)}`
    });
  }

  return errors;
}

// --- Trial balance row shaping ---------------------------------------------

/** Row shape returned by the `trialBalance` RPC. */
export type TrialBalanceRpcRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountClass: string | null;
  incomeBalance: string | null;
  debitBalance: number | string | null;
  creditBalance: number | string | null;
  netChange: number | string | null;
};

/** Stable-identifier envelope row keyed by `accountNumber` (the bolt-on key). */
export type TrialBalanceApiRow = {
  accountNumber: string;
  accountId: string;
  accountName: string;
  class: string | null;
  debits: number;
  credits: number;
  netChange: number;
  currencyCode: string;
};

function num(value: number | string | null): number {
  if (value === null) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Keyset pagination over `accountNumber`. Sorts ascending, drops rows at or
 * before the decoded cursor, takes `limit`, and returns the next cursor when
 * more rows remain. Deterministic and DB-independent.
 */
export function paginateByAccountNumber<T extends { accountNumber: string }>(
  rows: T[],
  opts: { cursor?: string | null; limit: number }
): { page: T[]; nextCursor: string | null } {
  const after = decodeCursor(opts.cursor);
  // Filter must use the SAME comparator as the sort, or a page boundary can
  // skip/duplicate rows when account numbers are non-numeric (mixed case /
  // punctuation), where localeCompare and JS `>` disagree.
  const sorted = rows
    .slice()
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
    .filter((row) =>
      after ? row.accountNumber.localeCompare(after) > 0 : true
    );

  const page = sorted.slice(0, opts.limit);
  const hasMore = sorted.length > opts.limit;
  const nextCursor =
    hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1]!.accountNumber)
      : null;

  return { page, nextCursor };
}

export function toTrialBalanceRow(
  row: TrialBalanceRpcRow,
  currencyCode: string
): TrialBalanceApiRow {
  return {
    accountNumber: row.accountNumber,
    accountId: row.accountId,
    accountName: row.accountName,
    class: row.accountClass,
    debits: num(row.debitBalance),
    credits: num(row.creditBalance),
    netChange: num(row.netChange),
    currencyCode
  };
}
