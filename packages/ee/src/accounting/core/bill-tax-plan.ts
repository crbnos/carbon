// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  deriveRate,
  distributeRoundingResidual,
  equals,
  round,
  toDocumentAmount
} from "@carbon/utils";
import {
  type BillCostingResult,
  type BillTaxLedgerRow,
  type CostingLine,
  type CostingLineTax,
  toDocumentTaxTotal,
  toTransactionCurrencyLines
} from "./document-costing";
import { JournalEntrySyncError } from "./posting";

type Db = Kysely<KyselyDatabase> | KyselyTx;

/**
 * How a purchase document's tax goes to a provider that books tax natively
 * (Xero, QuickBooks Online outside the US): the bill planner and the
 * supplier-memo split share one algorithm (`allocateRecoverableTax`). The
 * recoverable net of a tax code comes from the tax ledger's taxable amount,
 * never from the tax divided by the rate, so per-line rounding of the
 * supplier's tax cannot push it past the lines.
 */

/** One provider line of a bill: part or all of one cost leg, in the bill's
 *  currency, and the tax it carries. */
export type BillTaxLine = {
  /** The leg it comes from, in the bill's currency: account, label, dimensions. */
  leg: CostingLine;
  /** Net of `tax.taxAmount`. */
  amount: number;
  /** null: no tax (Xero `NONE`, QuickBooks the non-taxable code). A code at
   *  0% carries `taxAmount` 0, so its net reaches the return. */
  tax: (CostingLineTax & { taxAmount: number }) | null;
  /** An untaxed part of a fully recoverable code's legs: header freight, or a
   *  variance that offsets it. A provider with a fallback rate for untaxed
   *  lines sends it there, as it does untaxed sales shipping. */
  untaxedPurchase?: true;
};

export type BillTaxPlan = {
  /** False: every leg, Tax Paid and reverse-charge legs included, is one
   *  line with no tax, exactly as before bills carried tax. */
  sendsTax: boolean;
  lines: BillTaxLine[];
  /** Σ of the lines' tax: the Tax Paid legs in the bill's currency. */
  recoverableTax: number;
};

/** A code's recoverable tax and the net it is charged on. */
export type RecoverableTax = {
  tax: number;
  net: number;
  /** All of the code's tax is recoverable: its legs carry no tax in cost. */
  fullyRecoverable?: boolean;
};

type BillTaxCosting = Pick<
  BillCostingResult,
  "lines" | "taxLedger" | "exchangeRate" | "documentTotal" | "decimalPlaces"
>;

/** A leg whose code is zero-rated or exempt. */
function isZeroRatedLeg(line: CostingLine): boolean {
  return Boolean(line.tax?.taxCodeId) && line.tax?.taxPercent === 0;
}

/** Does the bill have a leg of a Reverse Charge code? */
export function billHasReverseCharge(lines: readonly CostingLine[]): boolean {
  return lines.some((line) => line.reverseChargeLeg);
}

/**
 * Does the bill send tax to a provider that books it natively: recoverable
 * tax on Tax Paid legs, or a zero-rated coded leg whose net must reach the
 * return? A bill with neither goes out as it always has.
 *
 * Phase 1: a bill with a reverse-charge leg never sends tax. The provider
 * reverse-charge rates (Xero's reverse-charge TaxTypes, QuickBooks' reverse
 * charge codes) are UNVERIFIED, so such a bill replays every leg, its Tax
 * Paid and Reverse Charge Tax legs included, as account lines at no tax. That
 * keeps the provider's GL equal to Carbon's.
 */
export function billSendsTax(lines: readonly CostingLine[]): boolean {
  if (billHasReverseCharge(lines)) return false;
  return lines.some((line) => line.taxLeg || isZeroRatedLeg(line));
}

/** Every leg as one line with no tax, in the bill's currency. */
export function replayBillTaxNeutral(costing: BillTaxCosting): BillTaxLine[] {
  return toTransactionCurrencyLines(costing.lines, costing).map((leg) => ({
    leg,
    amount: leg.amount,
    tax: null
  }));
}

/**
 * Each tax code's recoverable tax and recoverable net, base currency, from a
 * posting's tax-ledger rows. The ledger has one row per line per component,
 * and a line's components share its taxable amount, so a line contributes
 * taxable × (recoverable ÷ tax) once. A fully recoverable line contributes
 * its whole net. A row with no line id stands alone.
 */
export function recoverableByCodeFromLedger(
  rows: readonly BillTaxLedgerRow[]
): Map<string | null, RecoverableTax> {
  const lines = new Map<
    string,
    {
      taxCodeId: string | null;
      taxable: number;
      tax: number;
      recoverable: number;
    }
  >();
  rows.forEach((row, index) => {
    const key = row.documentLineId
      ? `${row.documentLineId}:${row.taxCodeId ?? ""}`
      : `row:${index}`;
    const line = lines.get(key) ?? {
      taxCodeId: row.taxCodeId,
      taxable: row.taxableAmount,
      tax: 0,
      recoverable: 0
    };
    line.tax += row.taxAmount;
    line.recoverable += row.recoverableAmount;
    lines.set(key, line);
  });
  const byCode = new Map<
    string | null,
    { tax: number; net: number; charged: number }
  >();
  for (const line of lines.values()) {
    const total = byCode.get(line.taxCodeId) ?? { tax: 0, net: 0, charged: 0 };
    total.tax += line.recoverable;
    total.charged += line.tax;
    total.net +=
      line.tax === 0 ? 0 : (line.taxable * line.recoverable) / line.tax;
    byCode.set(line.taxCodeId, total);
  }
  return new Map(
    [...byCode].map(([taxCodeId, { tax, net, charged }]) => [
      taxCodeId,
      { tax, net, fullyRecoverable: equals(tax, charged) }
    ])
  );
}

/**
 * The provider lines of a bill, for a provider that books tax natively
 * (Xero, QuickBooks Online outside the US). A bill that does not send tax
 * (`billSendsTax`) replays every leg at no tax. Otherwise the Tax Paid legs
 * come out, and the lines carry that tax instead:
 * - The recoverable tax and net of each tax code come from the bill's tax
 *   ledger (`recoverableByCodeFromLedger`). The tax is converted so the codes
 *   sum exactly to the converted Tax Paid legs.
 * - `allocateRecoverableTax` puts each code's recoverable net on its legs.
 *
 * A data condition the plan cannot honour raises the retryable
 * UNMAPPED_TAX_CODES Warning; nothing is pushed.
 */
export function planBillTaxLines(
  costing: BillTaxCosting,
  document: { id: string; label: string }
): BillTaxPlan {
  if (!billSendsTax(costing.lines)) {
    return {
      sendsTax: false,
      lines: replayBillTaxNeutral(costing),
      recoverableTax: 0
    };
  }
  const { exchangeRate, decimalPlaces } = costing;
  const taxLegs = costing.lines.filter((line) => line.taxLeg);
  const legs = toTransactionCurrencyLines(
    costing.lines.filter((line) => !line.taxLeg),
    { ...costing, taxLegs }
  );
  const recoverableTax = toDocumentTaxTotal(
    taxLegs,
    exchangeRate,
    decimalPlaces
  );

  const codes = [
    ...recoverableByCodeFromLedger(costing.taxLedger ?? [])
  ].filter(([, amount]) => round(amount.tax) !== 0);
  if (codes.length === 0 && recoverableTax !== 0) {
    throw billTaxWarning(
      document,
      `its ${recoverableTax} of recoverable tax has no tax ledger rows. Repost the invoice, then retry`,
      { recoverableTax }
    );
  }
  let converted: number[];
  try {
    converted = distributeRoundingResidual(
      codes.map(([, amount]) => amount.tax * exchangeRate),
      recoverableTax,
      decimalPlaces
    );
  } catch {
    throw billTaxWarning(
      document,
      `the recoverable tax in its tax ledger does not add up to the ${recoverableTax} posted to Tax Paid. Repost the invoice, then retry`,
      { recoverableTax }
    );
  }

  return {
    sendsTax: true,
    recoverableTax,
    lines: allocateRecoverableTax({
      document,
      legs,
      recoverableByCode: new Map(
        codes.map(([taxCodeId, amount], index) => [
          taxCodeId,
          {
            tax: converted[index]!,
            net: toDocumentAmount(amount.net, exchangeRate, decimalPlaces),
            fullyRecoverable: amount.fullyRecoverable
          }
        ])
      ),
      decimalPlaces,
      // Each leg and each net is converted on its own; a foreign bill may
      // differ by a minor unit per leg.
      perLegTolerance: exchangeRate === 1 ? 0 : 10 ** -decimalPlaces
    })
  };
}

/**
 * Puts each tax code's recoverable tax R on the legs that carry that code
 * (the legs whose `tax` is that code; one rate per code). Pure.
 * - The recoverable net N (from the ledger, or net × share on a memo) fills
 *   the code's legs of the same sign as N, largest first, each up to its own
 *   amount. Each piece's tax starts at round(piece × the code's rate), and
 *   what is left of R goes one minor unit per piece, largest remainder first
 *   (`distributeRoundingResidual`). So the pieces' tax sums exactly to R and
 *   every piece stays within one minor unit of net × rate, which is what the
 *   provider check allows (`resolveProviderTaxRate`).
 * - Each piece is a line at the code's rate with its tax. The rest of the leg
 *   is a second line on the same account at no tax. On a fully recoverable
 *   code, that rest and the code's legs left whole are `untaxedPurchase`.
 * Every other leg is one line: at its code's rate with tax 0 when the code is
 * zero-rated, else at no tax (tax folded into cost, no code, or a leg that
 * cannot be tied to one tax). Lines keep the order of `legs`.
 *
 * `perLegTolerance` absorbs currency-conversion rounding: a leg within it of
 * the net still unplaced is taken whole, and a shortfall within it per leg
 * taken is accepted. Amounts are in the document's currency. A code the legs
 * cannot absorb raises the retryable UNMAPPED_TAX_CODES Warning.
 */
export function allocateRecoverableTax(args: {
  document: { id: string; label: string };
  legs: readonly CostingLine[];
  /** Document currency; codes with no recoverable tax may be left out. */
  recoverableByCode: ReadonlyMap<string | null, RecoverableTax>;
  decimalPlaces: number;
  perLegTolerance?: number;
}): BillTaxLine[] {
  const { document, decimalPlaces } = args;
  const tolerance = args.perLegTolerance ?? 0;
  const pieces = new Map<string, { amount: number; taxAmount: number }>();
  const fullyRecoverableCodes = new Set<string | null>();

  for (const [taxCodeId, recoverableAmounts] of args.recoverableByCode) {
    const recoverable = recoverableAmounts.tax;
    if (recoverable === 0) continue;
    if (recoverableAmounts.fullyRecoverable) {
      fullyRecoverableCodes.add(taxCodeId);
    }
    const codeName = taxCodeId ?? "with no tax code";
    const coded = args.legs.filter(
      (leg) => leg.tax && leg.tax.taxCodeId === taxCodeId
    );
    const rates = [...new Set(coded.map((leg) => leg.tax!.taxPercent))];
    if (rates.length !== 1 || rates[0] === 0) {
      throw billTaxWarning(
        document,
        rates.length === 0
          ? `no posted line can be tied to tax code ${codeName}, so its ${recoverable} of recoverable tax has no line to go on`
          : `the lines of tax code ${codeName} carry ${rates.length > 1 ? "more than one rate" : "a 0% rate"}, so its ${recoverable} of recoverable tax cannot be placed`,
        { taxCodeId, recoverableTax: recoverable }
      );
    }
    const net = round(recoverableAmounts.net, decimalPlaces);
    const sign = Math.sign(net);
    const candidates = coded
      .filter((leg) => Math.sign(leg.amount) === sign)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    let remaining = net;
    const taken: Array<{ leg: CostingLine; amount: number }> = [];
    for (const leg of candidates) {
      if (Math.abs(remaining) <= tolerance * taken.length) break;
      const whole = Math.abs(leg.amount) - Math.abs(remaining) <= tolerance;
      const amount = whole
        ? leg.amount
        : sign * Math.min(Math.abs(leg.amount), Math.abs(remaining));
      taken.push({ leg, amount });
      remaining = round(remaining - amount, decimalPlaces);
    }
    const placed = round(
      taken.reduce((sum, piece) => sum + piece.amount, 0),
      decimalPlaces
    );
    if (
      net === 0 ||
      placed === 0 ||
      Math.abs(remaining) > tolerance * taken.length + 1e-9
    ) {
      throw billTaxWarning(
        document,
        `the lines of tax code ${codeName} total less than the ${net} its ${recoverable} of recoverable tax is charged on`,
        { taxCodeId, recoverableTax: recoverable, recoverableNet: net }
      );
    }
    // Each piece starts at its own net × rate, so a large piece never absorbs
    // the small pieces' rounding; the leftover goes one minor unit per piece.
    const rate = rates[0]!;
    let taxes: number[];
    try {
      taxes = distributeRoundingResidual(
        taken.map((piece) => piece.amount * rate),
        recoverable,
        decimalPlaces
      );
    } catch {
      throw billTaxWarning(
        document,
        `the ${recoverable} of recoverable tax of tax code ${codeName} is more than one minor unit per line away from ${round(rate * 100)}% of the ${placed} it is charged on`,
        { taxCodeId, recoverableTax: recoverable, recoverableNet: placed }
      );
    }
    taken.forEach((piece, index) => {
      pieces.set(piece.leg.id, {
        amount: piece.amount,
        taxAmount: taxes[index]!
      });
    });
  }

  return args.legs.flatMap((leg): BillTaxLine[] => {
    const piece = pieces.get(leg.id);
    const untaxed: BillTaxLine = {
      leg,
      amount: leg.amount,
      tax: null,
      ...(leg.tax && fullyRecoverableCodes.has(leg.tax.taxCodeId)
        ? { untaxedPurchase: true as const }
        : {})
    };
    if (piece) {
      const rest = round(leg.amount - piece.amount, decimalPlaces);
      return [
        {
          leg,
          amount: piece.amount,
          tax: {
            taxCodeId: leg.tax!.taxCodeId,
            taxPercent: leg.tax!.taxPercent,
            taxAmount: piece.taxAmount
          }
        },
        ...(rest !== 0 ? [{ ...untaxed, amount: rest }] : [])
      ];
    }
    if (isZeroRatedLeg(leg)) {
      return [
        {
          leg,
          amount: leg.amount,
          tax: { taxCodeId: leg.tax!.taxCodeId, taxPercent: 0, taxAmount: 0 }
        }
      ];
    }
    return [untaxed];
  });
}

/** The tax facts of a supplier memo, in its own currency. */
export type MemoTaxSource = {
  id: string;
  /** For messages: "memo M-0001". */
  label: string;
  /** Gross. */
  amount: number;
  /** The tax inside `amount`. */
  taxAmount: number;
  taxCodeId: string | null;
};

/**
 * A coded, taxed supplier memo split like a bill leg. Its posting
 * (planMemoTax) moved only the recoverable share of the tax through Tax Paid
 * and left the rest in the reason leg, as cost. So: the recoverable net
 * (net × share) at the code's rate with the recoverable tax, then the rest of
 * the net plus the non-recoverable tax at no tax. Share 0 is one untaxed line
 * for the gross. Pure.
 */
export function planMemoRecoverableLines(args: {
  memo: MemoTaxSource;
  /** 0..1, `loadMemoRecoverableShare`. */
  share: number;
  decimalPlaces: number;
}): BillTaxLine[] {
  const { memo, share, decimalPlaces } = args;
  const net = round(memo.amount - memo.taxAmount, decimalPlaces);
  // The same rounding the posting used for the Tax Paid leg (planMemoTax).
  const recoverableTax = round(memo.taxAmount * share, decimalPlaces);
  return allocateRecoverableTax({
    document: { id: memo.id, label: memo.label },
    legs: [
      {
        id: memo.id,
        accountId: null,
        amount: round(memo.amount - recoverableTax, decimalPlaces),
        description: null,
        tax: {
          taxCodeId: memo.taxCodeId,
          taxPercent: deriveRate(memo.taxAmount, net)
        }
      }
    ],
    recoverableByCode: new Map([
      [
        memo.taxCodeId,
        { tax: recoverableTax, net: round(net * share, decimalPlaces) }
      ]
    ]),
    decimalPlaces
  });
}

/**
 * The share of a supplier memo's tax its posting moved through Tax Paid,
 * from the memo's tax-ledger rows (planMemoTax). Zero for an untaxed or
 * code-less memo (its tax stayed in cost). A coded, taxed memo with no rows
 * was posted before the tax ledger: its share is unknown and it waits for a
 * repost (the retryable UNMAPPED_TAX_CODES Warning).
 */
export async function loadMemoRecoverableShare(
  db: Db,
  args: {
    companyId: string;
    memo: {
      id: string;
      memoId: string;
      taxCodeId: string | null;
      taxAmount: number;
    };
  }
): Promise<number> {
  const { memo } = args;
  if (memo.taxAmount === 0 || !memo.taxCodeId) return 0;
  const rows = await db
    .selectFrom("taxLedger")
    .select(["taxAmount", "recoverableAmount"])
    .where("companyId", "=", args.companyId)
    .where("documentId", "=", memo.id)
    .where("documentType", "=", "Memo")
    .where("source", "=", "Purchase")
    .execute();
  const tax = rows.reduce((sum, row) => sum + Number(row.taxAmount), 0);
  const recoverable = rows.reduce(
    (sum, row) => sum + Number(row.recoverableAmount),
    0
  );
  if (rows.length === 0 || tax === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_TAX_CODES",
      warning: true,
      message: `Cannot sync memo ${memo.memoId}: its tax has no tax ledger rows, so its recoverable share is unknown. Repost the memo, then retry.`,
      metadata: { memoId: memo.id, taxCodeId: memo.taxCodeId }
    });
  }
  return deriveRate(Math.abs(recoverable), Math.abs(tax));
}

function billTaxWarning(
  document: { id: string; label: string },
  reason: string,
  metadata: Record<string, unknown>
): JournalEntrySyncError {
  return new JournalEntrySyncError({
    errorCode: "UNMAPPED_TAX_CODES",
    warning: true,
    message: `Cannot sync ${document.label}: ${reason}.`,
    metadata: { documentId: document.id, ...metadata }
  });
}
