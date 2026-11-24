// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";

// The Carbon memo source both QuickBooks memo syncers read (credit memo,
// vendor credit): its shape, its tax facts and its loader.

/** A settlement that applies this memo to an open document. */
export type QboMemoSettlementRow = {
  id: string;
  /**
   * Exact source-document principal, in the MEMO's own currency — the amount a
   * QBO application must carry. `appliedAmount` is BASE currency
   * (`.claude/rules/numeric-precision.md`), so sending it against a foreign
   * credit memo over-applies by the exchange rate.
   */
  sourceAmount: number | null;
  appliedAmount: number;
  appliedDate: string;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  discountAmount: number;
  writeOffAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
};

/** The Carbon `memo` header as both memo syncers read it. */
export type QboMemoSource = {
  id: string;
  memoId: string;
  direction: Database["public"]["Enums"]["memoDirection"];
  status: Database["public"]["Enums"]["memoStatus"];
  customerId: string | null;
  supplierId: string | null;
  memoDate: string;
  postingDate: string | null;
  currencyCode: string;
  exchangeRate: number;
  /** Gross, document currency: what hits AR or AP. */
  amount: number;
  /** The tax inside `amount`, document currency. */
  taxAmount: number;
  /** The Carbon tax code of the memo's tax; null on a memo without tax. */
  taxCodeId: string | null;
  /** The memo currency's decimals; loaded for a memo with tax, else null. */
  decimalPlaces: number | null;
  reasonAccount: string | null;
  reference: string | null;
  notes: string | null;
  updatedAt: string;
  settlements: QboMemoSettlementRow[];
};

/** Does the memo carry tax to send? A memo without both goes out as before. */
export function qboMemoHasTax(memo: QboMemoSource): boolean {
  return memo.taxAmount !== 0 || memo.taxCodeId !== null;
}

/** The memo's net (gross less its tax), at its currency's decimals. */
export function qboMemoNetAmount(memo: QboMemoSource): {
  netAmount: number;
  decimalPlaces: number;
} {
  if (memo.decimalPlaces == null) {
    throw new Error(
      `Cannot sync memo ${memo.memoId}: its currency ${memo.currencyCode} has no precision`
    );
  }
  return {
    netAmount: round(memo.amount - memo.taxAmount, memo.decimalPlaces),
    decimalPlaces: memo.decimalPlaces
  };
}

/**
 * Load Carbon memo headers + their settlements for one party side. Shared by
 * both memo syncers (`party` selects the non-null party column).
 */
export async function loadQboMemoSources(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; ids: string[]; party: "customer" | "supplier" }
): Promise<Map<string, QboMemoSource>> {
  if (args.ids.length === 0) return new Map();

  const rows = await database
    .selectFrom("memo")
    .select([
      "id",
      "memoId",
      "direction",
      "status",
      "customerId",
      "supplierId",
      "memoDate",
      "postingDate",
      "currencyCode",
      "exchangeRate",
      "amount",
      "taxAmount",
      "taxCodeId",
      "reasonAccount",
      "reference",
      "notes",
      "postedAt",
      "createdAt",
      "updatedAt"
    ])
    .where("id", "in", args.ids)
    .where("companyId", "=", args.companyId)
    .where(
      args.party === "customer" ? "customerId" : "supplierId",
      "is not",
      null
    )
    .execute();

  if (rows.length === 0) return new Map();

  // Currency precision, for the memos whose tax is sent.
  const taxedCurrencies = [
    ...new Set(
      rows
        .filter((row) => row.taxCodeId || Number(row.taxAmount))
        .map((row) => row.currencyCode)
    )
  ];
  const decimalPlacesByCurrency = new Map(
    taxedCurrencies.length > 0
      ? (
          await database
            .selectFrom("currency")
            .innerJoin(
              "company",
              "company.companyGroupId",
              "currency.companyGroupId"
            )
            .select(["currency.code", "currency.decimalPlaces"])
            .where("company.id", "=", args.companyId)
            .where("currency.code", "in", taxedCurrencies)
            .execute()
        ).map((row) => [row.code, row.decimalPlaces] as const)
      : []
  );

  const settlementRows = await database
    .selectFrom("invoiceSettlement")
    .select([
      "id",
      "memoId",
      "sourceAmount",
      "appliedAmount",
      "appliedDate",
      "targetSalesInvoiceId",
      "targetPurchaseInvoiceId",
      "targetMemoId",
      "discountAmount",
      "writeOffAmount",
      "sourceExchangeRate",
      "targetExchangeRate"
    ])
    .where(
      "memoId",
      "in",
      rows.map((row) => row.id)
    )
    .where("companyId", "=", args.companyId)
    .execute();

  const settlementsByMemo = new Map<string, QboMemoSettlementRow[]>();
  for (const row of settlementRows) {
    if (!row.memoId) continue;
    const existing = settlementsByMemo.get(row.memoId) ?? [];
    existing.push({
      id: row.id,
      sourceAmount: row.sourceAmount === null ? null : Number(row.sourceAmount),
      appliedAmount: Number(row.appliedAmount) || 0,
      appliedDate: toDateString(row.appliedDate),
      targetSalesInvoiceId: row.targetSalesInvoiceId,
      targetPurchaseInvoiceId: row.targetPurchaseInvoiceId,
      targetMemoId: row.targetMemoId,
      discountAmount: Number(row.discountAmount) || 0,
      writeOffAmount: Number(row.writeOffAmount) || 0,
      sourceExchangeRate: Number(row.sourceExchangeRate) || 1,
      targetExchangeRate: Number(row.targetExchangeRate) || 1
    });
    settlementsByMemo.set(row.memoId, existing);
  }

  const result = new Map<string, QboMemoSource>();
  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      memoId: row.memoId,
      direction: row.direction,
      status: row.status,
      customerId: row.customerId,
      supplierId: row.supplierId,
      memoDate: toDateString(row.memoDate),
      postingDate: row.postingDate ? toDateString(row.postingDate) : null,
      currencyCode: row.currencyCode,
      exchangeRate: Number(row.exchangeRate) || 1,
      amount: Number(row.amount) || 0,
      taxAmount: Number(row.taxAmount) || 0,
      taxCodeId: row.taxCodeId,
      decimalPlaces: decimalPlacesByCurrency.get(row.currencyCode) ?? null,
      reasonAccount: row.reasonAccount,
      reference: row.reference,
      notes: row.notes,
      // A settlement never bumps memo.updatedAt, so the fallback chain must be
      // STABLE — `new Date()` here would defeat the base syncer's
      // already-synced bailout and re-push every drain.
      updatedAt: toTimestampString(
        row.updatedAt ?? row.postedAt ?? row.createdAt
      ),
      settlements: (settlementsByMemo.get(row.id) ?? []).sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    });
  }

  return result;
}

/** Kysely's pg driver returns DATE columns as JS Dates; QBO wants YYYY-MM-DD. */
function toDateString(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
