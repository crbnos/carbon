// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  assertCurrencyDecimals,
  assertExchangeRate,
  classifyAccountingPostingRole,
  distributeRoundingResidual,
  round,
  SCALE,
  toDocumentAmount
} from "@carbon/utils";
import { loadJournalLineDimensions } from "./dimension-mapping";
import {
  JournalEntrySyncError,
  type JournalLineDimensionRef,
  noPostedJournalMessage,
  toDebitSignedAmount,
  toPostingDateString
} from "./posting";

type Db = Kysely<KyselyDatabase> | KyselyTx;

/**
 * Shared bill-costing core (spec: accounting-document-representation).
 *
 * Every AP bill Carbon pushes to a provider reproduces the accounts its
 * posted "Purchase Invoice" journal computed (GR/IR clearing, price
 * variance, non-recoverable tax folded into cost, recoverable tax on Tax
 * Paid legs) — NOT the item's account. The item is a
 * description label only. This module extracts the journal read + AP-control
 * filter that Rillet pioneered so QBO and Xero can share it.
 *
 * A `CostingLine` carries base-currency, debit-signed amounts (positive =
 * debit). Providers convert to the invoice's transaction currency with
 * `toTransactionCurrencyLines` and pin the provider exchange rate.
 */

/** The Carbon-native prefix stamped on `journalLine.documentLineReference`
 * for purchase-invoice lines — `purchase-invoice:<purchaseOrderLineId>`
 * (see `journalReference.to.purchaseInvoice` in @carbon/database). Direct
 * no-PO invoice lines carry NULL, so they never resolve to a source item. */
const PURCHASE_INVOICE_LINE_REFERENCE_PREFIX = "purchase-invoice:";

/** The source item behind a costing line, resolved via the purchase-order
 * line the journal line references. Absent for direct no-PO lines and for
 * variance/rounding/tax lines (which have no item reference). */
export type CostingLineSourceItem = {
  id: string;
  code: string | null;
  name: string | null;
};

/**
 * One account-costed line of a bill's posted Purchase Invoice journal (AP
 * control line excluded). `amount` is base-currency and debit-signed.
 */
export type CostingLine = {
  id: string;
  accountId: string | null;
  /** Base-currency, debit-signed (positive = debit, negative = credit). */
  amount: number;
  description: string | null;
  /** Resolved item for a PO-backed line; undefined otherwise. */
  sourceItem?: CostingLineSourceItem;
  /** journalLineDimension rows carried onto provider dimension refs. */
  dimensions?: JournalLineDimensionRef[];
  /** A recoverable-tax leg the posting debited to Tax Paid. A provider that
   *  sends tax natively books it from the lines' tax (`planBillTaxLines`); one
   *  that does not books it to that account like any other line. */
  taxLeg?: boolean;
  /** The credit for tax self-assessed on a Reverse Charge code. A bill that
   *  has one goes out tax-neutral (`billSendsTax`). */
  reverseChargeLeg?: boolean;
  /** The tax of the invoice line(s) this leg came from; null when the leg
   *  cannot be tied to one tax (`resolveCostingLineTax`). Absent on charges. */
  tax?: CostingLineTax | null;
};

/** The tax a costing leg's invoice line carries. */
export type CostingLineTax = {
  taxCodeId: string | null;
  /** The line's rate, 0..1. */
  taxPercent: number;
};

/** A tax-ledger row of the bill's posting, base currency. */
export type BillTaxLedgerRow = {
  documentLineId: string | null;
  taxCodeId: string | null;
  taxCodeComponentId: string | null;
  taxPercent: number;
  taxableAmount: number;
  taxAmount: number;
  recoverableAmount: number;
};

export type BillCostingResult = {
  /** Costing lines (AP control line excluded), base-currency, debit-signed. */
  lines: CostingLine[];
  /** The AP control account the posting credited — what a provider
   * reimbursement (which does not derive its own payable) is booked against. */
  payablesAccountId?: string;
  /** The invoice's transaction currency (ISO-4217). */
  currencyCode: string;
  /** Document currency per company-base currency. */
  exchangeRate: number;
  documentTotal: number;
  decimalPlaces: number;
  baseCurrencyCode: string;
  postingDate: string;
  /** The tax-ledger rows the posting wrote; empty for a bill posted before
   *  the tax ledger existed. */
  taxLedger?: BillTaxLedgerRow[];
};

/**
 * Load a bill's account-costed replay lines from its posted "Purchase
 * Invoice" journal: the journal's lines minus the AP control line ARE the
 * bill's costing (item-backed invoice lines carry no account of their own;
 * posting resolves GR/IR clearing, variances and tax). Amounts are
 * base-currency and debit-signed. Item labels are joined through the
 * purchase-order line the journal line references
 * (`documentLineReference = purchase-invoice:<purchaseOrderLineId>`); direct
 * no-PO lines and variance lines resolve to `sourceItem: undefined`.
 *
 * Missing original posting/control metadata raises a structured Warning before
 * any currency reconciliation can hide the actionable source problem.
 */
export async function loadBillCostingLines(
  db: Db,
  args: { companyId: string; billId: string }
): Promise<BillCostingResult> {
  const invoice = await db
    .selectFrom("purchaseInvoice")
    .select(["currencyCode", "exchangeRate", "postingDate"])
    .where("id", "=", args.billId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();

  const company = await db
    .selectFrom("company")
    .select(["baseCurrencyCode", "companyGroupId"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  if (
    !invoice?.currencyCode ||
    !invoice.postingDate ||
    !company?.baseCurrencyCode ||
    !company.companyGroupId
  ) {
    throw new Error(
      "Bill currency, posting date and company base currency are required"
    );
  }
  const currencyCode = invoice.currencyCode;
  const baseCurrencyCode = company.baseCurrencyCode;
  const exchangeRate = Number(invoice.exchangeRate);
  const currency = await db
    .selectFrom("currency")
    .select("decimalPlaces")
    .where("code", "=", currencyCode)
    .where("companyGroupId", "=", company.companyGroupId)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces == null)
    throw new Error("Bill currency precision is required");
  const decimalPlaces = currency.decimalPlaces;
  assertExchangeRate(exchangeRate);
  assertCurrencyDecimals(decimalPlaces);
  if (currencyCode === baseCurrencyCode && exchangeRate !== 1)
    throw new Error("Base-currency bill requires identity exchange rate");
  const [invoiceLines, delivery] = await Promise.all([
    db
      .selectFrom("purchaseInvoiceLine")
      .select([
        "id",
        "purchaseOrderLineId",
        "accountId",
        "taxCodeId",
        "taxPercent",
        "quantity",
        "supplierUnitPrice",
        "supplierShippingCost",
        "supplierTaxAmount"
      ])
      .where("invoiceId", "=", args.billId)
      .where("companyId", "=", args.companyId)
      .where("invoiceLineType", "!=", "Comment")
      .execute(),
    db
      .selectFrom("purchaseInvoiceDelivery")
      .select("supplierShippingCost")
      .where("id", "=", args.billId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst()
  ]);
  const documentTotal = round(
    invoiceLines.reduce(
      (total, line) =>
        total +
        Number(line.quantity) * Number(line.supplierUnitPrice) +
        Number(line.supplierShippingCost) +
        Number(line.supplierTaxAmount),
      Number(delivery?.supplierShippingCost ?? 0)
    ),
    decimalPlaces
  );
  if (!Number.isFinite(documentTotal))
    throw new Error("Bill document total must be finite");

  const rows = await db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .leftJoin("account", "account.id", "journalLine.accountId")
    .select([
      "journalLine.id",
      "journalLine.journalId",
      "journalLine.accountId",
      "journalLine.amount",
      "journalLine.description",
      "journalLine.documentLineReference",
      "account.class as accountClass"
    ])
    .where("journalLine.documentType", "=", "Invoice")
    .where("journalLine.documentId", "=", args.billId)
    .where("journalLine.companyId", "=", args.companyId)
    .where("journal.sourceType", "=", "Purchase Invoice")
    .where("journal.status", "=", "Posted")
    .where("journal.companyId", "=", args.companyId)
    .orderBy("journalLine.journalLineReference", "asc")
    .execute();

  const controls = rows.filter(
    (row) => classifyAccountingPostingRole(row.description) === "Payables"
  );
  if (
    !rows.length ||
    !controls.length ||
    controls.some((row) => !row.accountId)
  ) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: !rows.length
        ? noPostedJournalMessage({
            subject: "bill",
            journal: "Purchase Invoice",
            document: "invoice"
          })
        : "Cannot sync bill: its original posted payables control account is missing. Correct the posting, then retry.",
      metadata: {
        billId: args.billId,
        controlLineIds: controls.map((row) => row.id)
      }
    });
  }
  // The provider creates its own AP control. Exclude the original role rows,
  // preserving explicit costing even when it happens to use the same account.
  const costingRows = rows.filter(
    (row) => classifyAccountingPostingRole(row.description) !== "Payables"
  );
  const missingAccountLines = costingRows.filter((row) => !row.accountId);
  if (missingAccountLines.length)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync bill: posted costing lines have no account. Correct the posting, then retry.",
      metadata: {
        billId: args.billId,
        lineIdsWithoutAccount: missingAccountLines.map((row) => row.id)
      }
    });

  const dimensionsByLine = await loadJournalLineDimensions(db, {
    companyId: args.companyId,
    journalLineIds: costingRows.map((row) => row.id)
  });

  // Item labels: resolve documentLineReference (purchase-invoice:<poLineId>)
  // → purchaseOrderLine.itemId → item.
  const poLineIds = new Set<string>();
  for (const row of costingRows) {
    const poLineId = parsePurchaseInvoiceLineReference(
      row.documentLineReference
    );
    if (poLineId) poLineIds.add(poLineId);
  }

  const sourceItemByPoLine = new Map<string, CostingLineSourceItem>();
  if (poLineIds.size > 0) {
    const itemRows = await db
      .selectFrom("purchaseOrderLine")
      .innerJoin("item", "item.id", "purchaseOrderLine.itemId")
      .select([
        "purchaseOrderLine.id as poLineId",
        "item.id as itemId",
        "item.readableId as code",
        "item.name as name"
      ])
      .where("purchaseOrderLine.companyId", "=", args.companyId)
      .where("purchaseOrderLine.id", "in", [...poLineIds])
      .execute();

    for (const row of itemRows) {
      sourceItemByPoLine.set(row.poLineId, {
        id: row.itemId,
        code: row.code ?? null,
        name: row.name ?? null
      });
    }
  }

  // The posting's tax ledger, for the journal these lines came from.
  const journalIds = [...new Set(rows.map((row) => row.journalId))];
  const taxLedger: BillTaxLedgerRow[] = (
    await db
      .selectFrom("taxLedger")
      .select([
        "documentLineId",
        "taxCodeId",
        "taxCodeComponentId",
        "taxPercent",
        "taxableAmount",
        "taxAmount",
        "recoverableAmount"
      ])
      .where("companyId", "=", args.companyId)
      .where("documentId", "=", args.billId)
      .where("source", "=", "Purchase")
      .where("journalId", "in", journalIds)
      .execute()
  ).map((row) => ({
    documentLineId: row.documentLineId,
    taxCodeId: row.taxCodeId,
    taxCodeComponentId: row.taxCodeComponentId,
    taxPercent: Number(row.taxPercent),
    taxableAmount: Number(row.taxableAmount),
    taxAmount: Number(row.taxAmount),
    recoverableAmount: Number(row.recoverableAmount)
  }));
  const taxOf = resolveCostingLineTax(
    invoiceLines.map((line) => ({
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      accountId: line.accountId,
      taxCodeId: line.taxCodeId,
      taxPercent: Number(line.taxPercent ?? 0)
    }))
  );

  const lines: CostingLine[] = costingRows.map((row) => {
    const dimensions = dimensionsByLine.get(row.id);
    const poLineId = parsePurchaseInvoiceLineReference(
      row.documentLineReference
    );
    const sourceItem = poLineId ? sourceItemByPoLine.get(poLineId) : undefined;
    const role = classifyAccountingPostingRole(row.description);

    return {
      id: row.id,
      accountId: row.accountId ?? null,
      amount: toDebitSignedAmount(row.accountClass, Number(row.amount)),
      description: row.description ?? null,
      ...(sourceItem ? { sourceItem } : {}),
      ...(dimensions ? { dimensions } : {}),
      ...(role === "TaxPaid"
        ? { taxLeg: true, tax: null }
        : role === "ReverseChargeTax"
          ? { reverseChargeLeg: true, tax: null }
          : {
              tax: taxOf({
                purchaseOrderLineId: poLineId,
                accountId: row.accountId ?? null
              })
            })
    };
  });

  return {
    lines,
    payablesAccountId: controls[0]?.accountId ?? undefined,
    currencyCode,
    exchangeRate,
    documentTotal,
    decimalPlaces,
    baseCurrencyCode,
    postingDate: toPostingDateString(invoice.postingDate),
    taxLedger
  };
}

type TaxSourceLine = {
  id: string;
  purchaseOrderLineId: string | null;
  accountId: string | null;
  taxCodeId: string | null;
  taxPercent: number;
};

/**
 * Ties a costing leg to the tax of the invoice line it came from. The
 * journal names no invoice line: a PO-backed leg names its purchase-order
 * line, and a direct leg names nothing. So a leg resolves through:
 * - the one tax every line of the bill shares, when there is one;
 * - else its purchase-order line's invoice lines;
 * - else the direct (no PO) lines on the leg's account.
 * When those lines disagree, or there are none, the leg's tax is null; a
 * provider that sends tax refuses the bill rather than guess.
 */
export function resolveCostingLineTax(
  invoiceLines: TaxSourceLine[]
): (leg: {
  purchaseOrderLineId: string | null;
  accountId: string | null;
}) => CostingLineTax | null {
  const signature = (line: TaxSourceLine) =>
    `${line.taxCodeId ?? ""}:${round(line.taxPercent)}`;
  const taxOfLines = (lines: TaxSourceLine[]): CostingLineTax | null => {
    if (lines.length === 0) return null;
    if (new Set(lines.map(signature)).size !== 1) return null;
    return {
      taxCodeId: lines[0]!.taxCodeId,
      taxPercent: round(lines[0]!.taxPercent)
    };
  };

  const shared = taxOfLines(invoiceLines);
  return (leg) => {
    if (shared) return shared;
    if (leg.purchaseOrderLineId) {
      return taxOfLines(
        invoiceLines.filter(
          (line) => line.purchaseOrderLineId === leg.purchaseOrderLineId
        )
      );
    }
    return taxOfLines(
      invoiceLines.filter(
        (line) =>
          !line.purchaseOrderLineId &&
          line.accountId !== null &&
          line.accountId === leg.accountId
      )
    );
  };
}

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
};

export type BillTaxPlan = {
  /** False: every leg, Tax Paid and reverse-charge legs included, is one
   *  line with no tax, exactly as before bills carried tax. */
  sendsTax: boolean;
  lines: BillTaxLine[];
  /** Σ of the lines' tax: the Tax Paid legs in the bill's currency. */
  recoverableTax: number;
};

type BillTaxCosting = Pick<
  BillCostingResult,
  "lines" | "taxLedger" | "exchangeRate" | "documentTotal" | "decimalPlaces"
>;

/** A leg whose code is zero-rated or exempt. */
function isZeroRatedLeg(line: CostingLine): boolean {
  return Boolean(line.tax?.taxCodeId) && line.tax?.taxPercent === 0;
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
  if (lines.some((line) => line.reverseChargeLeg)) return false;
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
 * The provider lines of a bill, for a provider that books tax natively
 * (Xero, QuickBooks Online outside the US). A bill that does not send tax
 * (`billSendsTax`) replays every leg at no tax. Otherwise the Tax Paid legs
 * come out, and the lines carry that tax instead:
 * - The recoverable tax of each tax code is read from the bill's tax ledger
 *   and converted so the codes sum exactly to the converted Tax Paid legs.
 *   It is never derived from a leg's amount, which also holds the
 *   non-recoverable tax and the untaxed header freight.
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

  // Base-currency recoverable tax per code, from the ledger.
  const byCode = new Map<string | null, number>();
  for (const row of costing.taxLedger ?? []) {
    byCode.set(
      row.taxCodeId,
      (byCode.get(row.taxCodeId) ?? 0) + row.recoverableAmount
    );
  }
  const codes = [...byCode].filter(([, amount]) => round(amount) !== 0);
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
      codes.map(([, amount]) => amount * exchangeRate),
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
      recoverableTaxByCode: new Map(
        codes.map(([taxCodeId], index) => [taxCodeId, converted[index]!])
      ),
      decimalPlaces
    })
  };
}

/**
 * Puts each tax code's recoverable tax R on the legs that carry that code
 * (the legs whose `tax` is that code; one rate r per code). Pure.
 * - The recoverable net is N = R / r, at the document's decimals.
 * - N fills the code's legs of the same sign as N, largest first, each up to
 *   its own amount. R is spread over those pieces in proportion to their net
 *   (`distributeRoundingResidual`), so the pieces' tax sums exactly to R.
 * - Each piece is a line at the code's rate with its tax. The rest of the leg
 *   is a second line on the same account at no tax.
 * Every other leg is one line: at its code's rate with tax 0 when the code is
 * zero-rated, else at no tax (tax folded into cost, no code, or a leg that
 * cannot be tied to one tax). Lines keep the order of `legs`.
 *
 * Amounts are in the document's currency. A code the legs cannot absorb
 * raises the retryable UNMAPPED_TAX_CODES Warning.
 */
export function allocateRecoverableTax(args: {
  document: { id: string; label: string };
  legs: readonly CostingLine[];
  /** Document currency; codes with no recoverable tax may be left out. */
  recoverableTaxByCode: ReadonlyMap<string | null, number>;
  decimalPlaces: number;
}): BillTaxLine[] {
  const { document, decimalPlaces } = args;
  const pieces = new Map<string, { amount: number; taxAmount: number }>();

  for (const [taxCodeId, recoverable] of args.recoverableTaxByCode) {
    if (recoverable === 0) continue;
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
    const rate = rates[0]!;
    const net = round(recoverable / rate, decimalPlaces);
    const sign = Math.sign(net);
    const candidates = coded
      .filter((leg) => Math.sign(leg.amount) === sign)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    let remaining = net;
    const taken: Array<{ leg: CostingLine; amount: number }> = [];
    for (const leg of candidates) {
      if (remaining === 0) break;
      const amount = sign * Math.min(Math.abs(leg.amount), Math.abs(remaining));
      taken.push({ leg, amount });
      remaining = round(remaining - amount, decimalPlaces);
    }
    if (remaining !== 0 || net === 0) {
      throw billTaxWarning(
        document,
        `the lines of tax code ${codeName} total less than the ${net} its ${recoverable} of recoverable tax is charged on`,
        { taxCodeId, recoverableTax: recoverable, recoverableNet: net }
      );
    }
    const taxes = distributeRoundingResidual(
      taken.map((piece) => (recoverable * piece.amount) / net),
      recoverable,
      decimalPlaces
    );
    taken.forEach((piece, index) => {
      pieces.set(piece.leg.id, {
        amount: piece.amount,
        taxAmount: taxes[index]!
      });
    });
  }

  return args.legs.flatMap((leg): BillTaxLine[] => {
    const piece = pieces.get(leg.id);
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
        ...(rest !== 0 ? [{ leg, amount: rest, tax: null }] : [])
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
    return [{ leg, amount: leg.amount, tax: null }];
  });
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

/** The Tax Paid legs in the document's currency, converted once as a total
 *  (`toTransactionCurrencyLines` reconciles the other lines against it). */
export function toDocumentTaxTotal(
  taxLegs: readonly CostingLine[],
  exchangeRate: number,
  decimalPlaces: number
): number {
  return toDocumentAmount(
    taxLegs.reduce((sum, leg) => sum + leg.amount, 0),
    exchangeRate,
    decimalPlaces
  );
}

export type ChargeCostingResult = BillCostingResult & {
  /** The card-liability account the charge is settled against. */
  cardAccountId: string;
  /** Charge (spend) or Credit (merchant refund). */
  type: "Charge" | "Credit";
  /** The date the card was charged (the provider's charge date). */
  transactionDate: string;
};

/**
 * Load a charge's account-costed replay lines from its posted
 * "Charge" journal — the same contract as {@link loadBillCostingLines}
 * with a simpler control rule: the card-liability line is identified by the
 * header's `cardAccountId`, not by a description role. Everything else the
 * journal booked (the expense lines, with their cost-center dimensions) IS the
 * charge's items, base-currency and debit-signed; a Credit's lines come out
 * credit-signed (negative), which the provider adapters turn into their native
 * refund shape. `postingDate` falls back to `transactionDate` (nullable on the
 * header). No item labels: card lines have no item.
 */
export async function loadChargeCostingLines(
  db: Db,
  args: { companyId: string; chargeId: string }
): Promise<ChargeCostingResult> {
  const charge = await db
    .selectFrom("charge")
    .select([
      "type",
      "currencyCode",
      "exchangeRate",
      "postingDate",
      "transactionDate",
      "cardAccountId",
      "amount"
    ])
    .where("id", "=", args.chargeId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();

  const company = await db
    .selectFrom("company")
    .select(["baseCurrencyCode", "companyGroupId"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  if (
    !charge?.currencyCode ||
    !charge.transactionDate ||
    !company?.baseCurrencyCode ||
    !company.companyGroupId
  ) {
    throw new Error(
      "Charge currency, transaction date and company base currency are required"
    );
  }
  if (charge.type !== "Charge" && charge.type !== "Credit") {
    throw new Error(`Charge type ${charge.type} has no charge representation`);
  }
  const currencyCode = charge.currencyCode;
  const baseCurrencyCode = company.baseCurrencyCode;
  const exchangeRate = Number(charge.exchangeRate);
  const currency = await db
    .selectFrom("currency")
    .select("decimalPlaces")
    .where("code", "=", currencyCode)
    .where("companyGroupId", "=", company.companyGroupId)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces == null)
    throw new Error("Charge currency precision is required");
  const decimalPlaces = currency.decimalPlaces;
  assertExchangeRate(exchangeRate);
  assertCurrencyDecimals(decimalPlaces);
  if (currencyCode === baseCurrencyCode && exchangeRate !== 1)
    throw new Error("Base-currency charge requires identity exchange rate");
  // The header amount is the authoritative document total (post-card-
  // transaction asserts the lines sum to it); a Credit's total is negative in
  // charge terms.
  const documentTotal = round(
    Number(charge.amount) * (charge.type === "Credit" ? -1 : 1),
    decimalPlaces
  );
  if (!Number.isFinite(documentTotal))
    throw new Error("Charge document total must be finite");

  const rows = await db
    .selectFrom("journalLine")
    .innerJoin("journal", (join) =>
      join
        .onRef("journal.id", "=", "journalLine.journalId")
        .onRef("journal.companyId", "=", "journalLine.companyId")
    )
    .leftJoin("account", "account.id", "journalLine.accountId")
    .select([
      "journalLine.id",
      "journalLine.accountId",
      "journalLine.amount",
      "journalLine.description",
      "account.class as accountClass"
    ])
    .where("journalLine.documentType", "=", "Charge")
    .where("journalLine.documentId", "=", args.chargeId)
    .where("journalLine.companyId", "=", args.companyId)
    .where("journal.sourceType", "=", "Charge")
    .where("journal.status", "=", "Posted")
    .where("journal.companyId", "=", args.companyId)
    .orderBy("journalLine.journalLineReference", "asc")
    .execute();

  if (!rows.length) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: noPostedJournalMessage({
        subject: "card charge",
        journal: "Charge",
        document: "charge"
      }),
      metadata: { chargeId: args.chargeId }
    });
  }
  // The provider books the card liability itself from `credit_card_account_code`
  // (or its equivalent); only the coded lines become items.
  const costingRows = rows.filter(
    (row) => row.accountId !== charge.cardAccountId
  );
  const missingAccountLines = costingRows.filter((row) => !row.accountId);
  if (!costingRows.length || missingAccountLines.length)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: its posted lines have no account. Correct the posting, then retry.",
      metadata: {
        chargeId: args.chargeId,
        lineIdsWithoutAccount: missingAccountLines.map((row) => row.id)
      }
    });

  const dimensionsByLine = await loadJournalLineDimensions(db, {
    companyId: args.companyId,
    journalLineIds: costingRows.map((row) => row.id)
  });

  const lines: CostingLine[] = costingRows.map((row) => {
    const dimensions = dimensionsByLine.get(row.id);
    return {
      id: row.id,
      accountId: row.accountId ?? null,
      amount: toDebitSignedAmount(row.accountClass, Number(row.amount)),
      description: row.description ?? null,
      ...(dimensions ? { dimensions } : {})
    };
  });

  return {
    lines,
    currencyCode,
    exchangeRate,
    documentTotal,
    decimalPlaces,
    baseCurrencyCode,
    postingDate: toPostingDateString(
      charge.postingDate ?? charge.transactionDate
    ),
    transactionDate: toPostingDateString(charge.transactionDate),
    cardAccountId: charge.cardAccountId,
    type: charge.type
  };
}

/** The item code/name label for a costing line (`"<code> <name>"`), or null
 * when the line has no source item or the item has neither a code nor a name.
 * Providers prepend it to (Rillet) or substitute it for (QBO/Xero) the journal
 * line description so the account-costed bill line still shows what was
 * purchased. */
export function costingLineItemLabel(line: CostingLine): string | null {
  if (!line.sourceItem) return null;
  const label = [line.sourceItem.code, line.sourceItem.name]
    .filter(Boolean)
    .join(" ");
  return label.length > 0 ? label : null;
}

/** Strip the `purchase-invoice:` prefix to recover the purchase-order line
 * id; null for direct no-PO lines (NULL reference) and any other reference
 * type. */
function parsePurchaseInvoiceLineReference(
  reference: string | null
): string | null {
  if (!reference) return null;
  if (!reference.startsWith(PURCHASE_INVOICE_LINE_REFERENCE_PREFIX)) {
    return null;
  }
  const id = reference.slice(PURCHASE_INVOICE_LINE_REFERENCE_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Convert posted base costs once, reconciling only differences explained by rounding. */
export function toTransactionCurrencyLines(
  lines: CostingLine[],
  args: {
    exchangeRate: number;
    documentTotal: number;
    decimalPlaces: number;
    /** Tax Paid legs left out of `lines` (`planBillTaxLines`). They take
     *  part in the check against the document total; the lines then sum to
     *  the total less their converted amount (`toDocumentTaxTotal`). */
    taxLegs?: CostingLine[];
  }
): CostingLine[] {
  const { exchangeRate, decimalPlaces } = args;
  const taxLegs = args.taxLegs ?? [];
  const documentTotal = args.documentTotal;
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > SCALE
  )
    throw new Error("Unsupported document decimal scale");
  toDocumentAmount(documentTotal, exchangeRate, decimalPlaces);
  if (round(documentTotal, decimalPlaces) !== documentTotal)
    throw new Error("Bill document total exceeds currency precision");
  const unroundedTotal = [...lines, ...taxLegs].reduce((sum, line) => {
    if (!Number.isFinite(line.amount))
      throw new Error("Costing line amount must be finite");
    return sum + line.amount * exchangeRate;
  }, 0);
  // Each posted source is stored at SCALE; the authoritative document
  // is rounded once at its own boundary. This envelope cannot conceal a cost gap.
  const envelope =
    (lines.length + taxLegs.length) * (0.5 / 10 ** SCALE) * exchangeRate +
    0.5 * 10 ** -decimalPlaces;
  if (
    Math.abs(unroundedTotal - documentTotal) >
    envelope + Number.EPSILON * Math.max(1, Math.abs(documentTotal)) * 8
  ) {
    throw new Error(
      "Posted bill costing does not reconcile to its document total"
    );
  }
  const converted = lines.map((line) => ({
    ...line,
    amount: toDocumentAmount(line.amount, exchangeRate, decimalPlaces)
  }));
  const convertedTax = toDocumentTaxTotal(taxLegs, exchangeRate, decimalPlaces);
  const residual = round(
    documentTotal -
      convertedTax -
      converted.reduce((sum, line) => sum + line.amount, 0),
    decimalPlaces
  );
  if (residual !== 0) {
    if (!converted.length)
      throw new Error("Bill has a document total but no costing lines");
    let largest = 0;
    for (let i = 1; i < converted.length; i++) {
      if (Math.abs(lines[i]!.amount) > Math.abs(lines[largest]!.amount))
        largest = i;
    }
    converted[largest]!.amount = round(
      converted[largest]!.amount + residual,
      decimalPlaces
    );
  }
  return converted;
}
