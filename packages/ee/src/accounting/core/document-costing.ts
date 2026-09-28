import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  assertCurrencyDecimals,
  assertExchangeRate,
  classifyAccountingPostingRole,
  round,
  SCALE,
  toDocumentAmount
} from "@carbon/utils";
import { loadJournalLineDimensions } from "./dimension-mapping";
import {
  JournalEntrySyncError,
  type JournalLineDimensionRef,
  toDebitSignedAmount,
  toPostingDateString
} from "./posting";

type Db = Kysely<KyselyDatabase> | KyselyTx;

/**
 * Shared bill-costing core (spec: accounting-document-representation).
 *
 * Every AP bill Carbon pushes to a provider reproduces the accounts its
 * posted "Purchase Invoice" journal computed (GR/IR clearing, price
 * variance, tax folded into cost) — NOT the item's account. The item is a
 * description label only. This module extracts the journal read + AP-control
 * filter that Rillet pioneered so QBO and Xero can share it.
 *
 * A `CostingLine` carries base-currency, debit-signed amounts (positive =
 * debit). Providers convert to the invoice's transaction currency with
 * `toTransactionCurrencyLines` and pin the provider exchange rate.
 */

/** The Carbon-native prefix stamped on `journalLine.documentLineReference`
 * for purchase-invoice lines — `purchase-invoice:<purchaseOrderLineId>`
 * (see `functions/lib/utils.ts` journalReference.to.purchaseInvoice). Direct
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
        ? "Cannot sync bill: no posted Purchase Invoice journal found. Post the invoice with accounting enabled, then retry."
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

  const lines: CostingLine[] = costingRows.map((row) => {
    const dimensions = dimensionsByLine.get(row.id);
    const poLineId = parsePurchaseInvoiceLineReference(
      row.documentLineReference
    );
    const sourceItem = poLineId ? sourceItemByPoLine.get(poLineId) : undefined;

    return {
      id: row.id,
      accountId: row.accountId ?? null,
      amount: toDebitSignedAmount(row.accountClass, Number(row.amount)),
      description: row.description ?? null,
      ...(sourceItem ? { sourceItem } : {}),
      ...(dimensions ? { dimensions } : {})
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
    postingDate: toPostingDateString(invoice.postingDate)
  };
}

export type CardTransactionCostingResult = BillCostingResult & {
  /** The card-liability account the charge is settled against. */
  cardAccountId: string;
  /** Charge (spend) or Credit (merchant refund). */
  type: "Charge" | "Credit";
  /** The date the card was charged (the provider's charge date). */
  transactionDate: string;
};

/**
 * Load a card transaction's account-costed replay lines from its posted
 * "Card Transaction" journal — the same contract as {@link loadBillCostingLines}
 * with a simpler control rule: the card-liability line is identified by the
 * header's `cardAccountId`, not by a description role. Everything else the
 * journal booked (the expense lines, with their cost-center dimensions) IS the
 * charge's items, base-currency and debit-signed; a Credit's lines come out
 * credit-signed (negative), which the provider adapters turn into their native
 * refund shape. `postingDate` falls back to `transactionDate` (nullable on the
 * header). No item labels: card lines have no item.
 */
export async function loadCardTransactionCostingLines(
  db: Db,
  args: { companyId: string; cardTransactionId: string }
): Promise<CardTransactionCostingResult> {
  const cardTransaction = await db
    .selectFrom("cardTransaction")
    .select([
      "type",
      "currencyCode",
      "exchangeRate",
      "postingDate",
      "transactionDate",
      "cardAccountId",
      "amount"
    ])
    .where("id", "=", args.cardTransactionId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();

  const company = await db
    .selectFrom("company")
    .select(["baseCurrencyCode", "companyGroupId"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  if (
    !cardTransaction?.currencyCode ||
    !cardTransaction.transactionDate ||
    !company?.baseCurrencyCode ||
    !company.companyGroupId
  ) {
    throw new Error(
      "Card transaction currency, transaction date and company base currency are required"
    );
  }
  if (cardTransaction.type !== "Charge" && cardTransaction.type !== "Credit") {
    throw new Error(
      `Card transaction type ${cardTransaction.type} has no charge representation`
    );
  }
  const currencyCode = cardTransaction.currencyCode;
  const baseCurrencyCode = company.baseCurrencyCode;
  const exchangeRate = Number(cardTransaction.exchangeRate);
  const currency = await db
    .selectFrom("currency")
    .select("decimalPlaces")
    .where("code", "=", currencyCode)
    .where("companyGroupId", "=", company.companyGroupId)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces == null)
    throw new Error("Card transaction currency precision is required");
  const decimalPlaces = currency.decimalPlaces;
  assertExchangeRate(exchangeRate);
  assertCurrencyDecimals(decimalPlaces);
  if (currencyCode === baseCurrencyCode && exchangeRate !== 1)
    throw new Error(
      "Base-currency card transaction requires identity exchange rate"
    );
  // The header amount is the authoritative document total (post-card-
  // transaction asserts the lines sum to it); a Credit's total is negative in
  // charge terms.
  const documentTotal = round(
    Number(cardTransaction.amount) *
      (cardTransaction.type === "Credit" ? -1 : 1),
    decimalPlaces
  );
  if (!Number.isFinite(documentTotal))
    throw new Error("Card transaction document total must be finite");

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
    .where("journalLine.documentType", "=", "Card Transaction")
    .where("journalLine.documentId", "=", args.cardTransactionId)
    .where("journalLine.companyId", "=", args.companyId)
    .where("journal.sourceType", "=", "Card Transaction")
    .where("journal.status", "=", "Posted")
    .where("journal.companyId", "=", args.companyId)
    .orderBy("journalLine.journalLineReference", "asc")
    .execute();

  if (!rows.length) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: no posted Card Transaction journal found. Post the card transaction with accounting enabled, then retry.",
      metadata: { cardTransactionId: args.cardTransactionId }
    });
  }
  // The provider books the card liability itself from `credit_card_account_code`
  // (or its equivalent); only the coded lines become items.
  const costingRows = rows.filter(
    (row) => row.accountId !== cardTransaction.cardAccountId
  );
  const missingAccountLines = costingRows.filter((row) => !row.accountId);
  if (!costingRows.length || missingAccountLines.length)
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: its posted lines have no account. Correct the posting, then retry.",
      metadata: {
        cardTransactionId: args.cardTransactionId,
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
      cardTransaction.postingDate ?? cardTransaction.transactionDate
    ),
    transactionDate: toPostingDateString(cardTransaction.transactionDate),
    cardAccountId: cardTransaction.cardAccountId,
    type: cardTransaction.type
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
  args: { exchangeRate: number; documentTotal: number; decimalPlaces: number }
): CostingLine[] {
  const { exchangeRate, documentTotal, decimalPlaces } = args;
  if (
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > SCALE
  )
    throw new Error("Unsupported document decimal scale");
  toDocumentAmount(documentTotal, exchangeRate, decimalPlaces);
  if (round(documentTotal, decimalPlaces) !== documentTotal)
    throw new Error("Bill document total exceeds currency precision");
  const unroundedTotal = lines.reduce((sum, line) => {
    if (!Number.isFinite(line.amount))
      throw new Error("Costing line amount must be finite");
    return sum + line.amount * exchangeRate;
  }, 0);
  // Each posted source is stored at SCALE; the authoritative document
  // is rounded once at its own boundary. This envelope cannot conceal a cost gap.
  const envelope =
    lines.length * (0.5 / 10 ** SCALE) * exchangeRate +
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
  const residual = round(
    documentTotal - converted.reduce((sum, line) => sum + line.amount, 0),
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
