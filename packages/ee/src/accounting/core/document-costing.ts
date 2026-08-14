import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { loadJournalLineDimensions } from "./dimension-mapping";
import {
  type JournalLineDimensionRef,
  roundCurrency,
  toDebitSignedAmount
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
  /** The invoice's transaction currency (ISO-4217). */
  currencyCode: string;
  /** Base-per-transaction exchange rate (1 for base-currency bills). */
  exchangeRate: number;
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
 * Returns `lines: []` when the invoice has no posted Purchase Invoice
 * journal (not posted / accounting off) — the caller surfaces the Warning.
 */
export async function loadBillCostingLines(
  db: Db,
  args: { companyId: string; billId: string; payablesAccountId: string | null }
): Promise<BillCostingResult> {
  const invoice = await db
    .selectFrom("purchaseInvoice")
    .select(["currencyCode", "exchangeRate"])
    .where("id", "=", args.billId)
    .where("companyId", "=", args.companyId)
    .executeTakeFirst();

  const currencyCode = invoice?.currencyCode ?? "USD";
  const exchangeRate = Number(invoice?.exchangeRate) || 1;

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
    .where("journalLine.documentId", "=", args.billId)
    .where("journalLine.companyId", "=", args.companyId)
    .where("journal.sourceType", "=", "Purchase Invoice")
    .where("journal.status", "=", "Posted")
    .where("journal.companyId", "=", args.companyId)
    .orderBy("journalLine.journalLineReference", "asc")
    .execute();

  // AP control line(s) are re-booked by the provider's own bill mechanics —
  // exclude them; keep null-account lines (they fail preflight as unmapped).
  const costingRows = rows.filter(
    (row) => row.accountId === null || row.accountId !== args.payablesAccountId
  );

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
      amount: toDebitSignedAmount(row.accountClass, Number(row.amount) || 0),
      description: row.description ?? null,
      ...(sourceItem ? { sourceItem } : {}),
      ...(dimensions ? { dimensions } : {})
    };
  });

  return { lines, currencyCode, exchangeRate };
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

/**
 * Convert base-currency costing lines to the invoice's transaction currency:
 * divide each amount by `exchangeRate` (base = transaction × rate), round to
 * 2dp, then book the post-rounding residue into the largest-|amount| line so
 * the lines sum exactly to the invoice's transaction-currency total. Negative
 * amounts (credit variance lines) are preserved. `exchangeRate === 1` is a
 * pass-through (base-currency bills are byte-identical).
 */
export function toTransactionCurrencyLines(
  lines: CostingLine[],
  exchangeRate: number
): CostingLine[] {
  if (exchangeRate === 1 || lines.length === 0) {
    return lines.map((line) => ({ ...line }));
  }

  const converted = lines.map((line) => ({
    ...line,
    amount: roundCurrency(line.amount / exchangeRate)
  }));

  const baseTotalCents = lines.reduce(
    (sum, line) => sum + Math.round(line.amount * 100),
    0
  );
  const targetCents = Math.round(baseTotalCents / exchangeRate);
  const convertedCents = converted.reduce(
    (sum, line) => sum + Math.round(line.amount * 100),
    0
  );
  const residueCents = targetCents - convertedCents;

  if (residueCents !== 0) {
    let largestIndex = 0;
    let largestMagnitude = -1;
    for (let i = 0; i < converted.length; i++) {
      const magnitude = Math.abs(converted[i]!.amount);
      if (magnitude > largestMagnitude) {
        largestMagnitude = magnitude;
        largestIndex = i;
      }
    }
    const target = converted[largestIndex]!;
    target.amount = roundCurrency(target.amount + residueCents / 100);
  }

  return converted;
}
