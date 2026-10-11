// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounts of a memo's journal that the posting and the rebuild
// (`rebuild-journal.ts`) resolve the same way: the reason account of a plain
// memo, the carried cost a supplier return's reason leg clears, and the
// stand-in role of each line.

import type { KyselyDatabase } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import type { MemoJournalLine } from "@carbon/database/posting";
import type { Selectable, Transaction } from "kysely";

export type MemoRow = Selectable<KyselyDatabase["memo"]>;

/** A memo journal line with the stand-in role the posting gives it. */
export type MemoJournalLineWithRole = MemoJournalLine & {
  accountDefaultRole: OptionalDefaultRole | null;
};

/** A credit memo that credits a contract or a rental agreement. */
export function isContractOrRentalCredit(memo: MemoRow): boolean {
  return (
    memo.direction === "Credit" &&
    Boolean(memo.customerContractId || memo.rentalAgreementId)
  );
}

/**
 * The reason account of a memo that credits no contract and no rental
 * agreement. A customer-RMA credit memo books to Sales Returns, which falls
 * back to Sales when empty (`resolveDefaultAccount`).
 */
export function plainMemoReasonAccount(
  memo: MemoRow,
  defaults: Selectable<KyselyDatabase["accountDefault"]>,
  isAR: boolean,
  postingStatus: AutomaticJournalStatus
): {
  accountId: string | null;
  accountDefaultRole: OptionalDefaultRole | null;
} {
  if (memo.salesReturnOrderId) {
    return resolveDefaultAccount(
      defaults,
      "salesReturnsAccount",
      postingStatus
    );
  }
  return {
    accountId: memo.purchaseReturnOrderId
      ? defaults.goodsReceivedNotInvoicedAccount
      : isAR
        ? defaults.salesDiscountAccount
        : defaults.supplierPaymentDiscountAccount,
    accountDefaultRole: null
  };
}

/**
 * The lines with their stand-in roles. Only the reason leg can be a
 * stand-in; it is the line on the reason account.
 */
export function withReasonRole(
  lines: MemoJournalLine[],
  reasonAccountId: string,
  reasonAccountDefaultRole: OptionalDefaultRole | null
): MemoJournalLineWithRole[] {
  return lines.map((line) => ({
    ...line,
    accountDefaultRole:
      line.accountId === reasonAccountId ? reasonAccountDefaultRole : null
  }));
}

/**
 * The carried cost a supplier-return memo's reason leg clears, in base
 * currency. Undefined for every other memo, and for a return with no cost
 * basis.
 */
export async function supplierReturnCarriedCost(
  trx: Transaction<KyselyDatabase>,
  memo: MemoRow
): Promise<number | undefined> {
  const costs = await supplierReturnCarriedCosts(trx, [memo], memo.companyId);
  return costs.get(memo.id);
}

/** `supplierReturnCarriedCost` for many memos, in a fixed number of reads. */
export async function supplierReturnCarriedCosts(
  trx: Transaction<KyselyDatabase>,
  memos: MemoRow[],
  companyId: string
): Promise<Map<string, number | undefined>> {
  // Supplier returns only: the reason leg (GRNI) must clear exactly what the
  // return SHIPMENT debited — the goods' carried cost, already in BASE
  // currency (do NOT scale by the memo's exchange rate) — while the control
  // leg (AP) moves by what the supplier agreed to credit. Recover the carried
  // cost here and let the builder book the difference as a purchase price
  // variance; without it GRNI keeps a residual for the life of the company.
  const result = new Map<string, number | undefined>();
  const returns = memos.filter((memo) => memo.purchaseReturnOrderId);
  if (returns.length === 0) return result;
  const returnOrderIds = [
    ...new Set(returns.map((memo) => memo.purchaseReturnOrderId!))
  ];
  // Posted shipments only: a voided shipment's journal was reversed but its
  // costLedger rows survive, so counting it would over-credit GRNI.
  const shipments = await trx
    .selectFrom("shipment")
    .select(["id", "sourceDocumentId"])
    .where("sourceDocument", "=", "Purchase Return Order")
    .where("sourceDocumentId", "in", returnOrderIds)
    .where("status", "=", "Posted")
    .where("companyId", "=", companyId)
    .execute();
  const shipmentIds = shipments.map((row) => row.id);
  if (shipmentIds.length === 0) return result;

  const [costRows, creditLines] = await Promise.all([
    trx
      .selectFrom("costLedger")
      .select(["documentId", "itemId", "quantity", "cost"])
      .where("documentType", "=", "Purchase Return Shipment")
      .where("documentId", "in", shipmentIds)
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("purchaseReturnOrderCreditLine")
      .select(["memoId", "purchaseReturnOrderLineId", "quantity"])
      .where(
        "memoId",
        "in",
        returns.map((memo) => memo.id)
      )
      .where("companyId", "=", companyId)
      .execute()
  ]);
  const lineIds = [
    ...new Set(
      creditLines.map((row) => row.purchaseReturnOrderLineId as string)
    )
  ];
  const returnLines = lineIds.length
    ? await trx
        .selectFrom("purchaseReturnOrderLine")
        .select(["id", "itemId"])
        .where("id", "in", lineIds)
        .where("companyId", "=", companyId)
        .execute()
    : [];
  const itemByLine = new Map(
    returnLines.map((row) => [row.id as string, row.itemId as string])
  );
  const returnOrderByShipment = new Map(
    shipments.map((row) => [row.id, row.sourceDocumentId])
  );

  // Per return order, per-item carried cost per unit, from what its
  // shipments relieved.
  const relievedByReturn = new Map<
    string,
    Map<string, { qty: number; cost: number }>
  >();
  for (const row of costRows) {
    const returnOrderId = returnOrderByShipment.get(row.documentId as string);
    if (!returnOrderId) continue;
    const relieved =
      relievedByReturn.get(returnOrderId) ??
      new Map<string, { qty: number; cost: number }>();
    relievedByReturn.set(returnOrderId, relieved);
    const key = row.itemId as string;
    const prev = relieved.get(key) ?? { qty: 0, cost: 0 };
    relieved.set(key, {
      qty: prev.qty + Math.abs(Number(row.quantity ?? 0)),
      cost: prev.cost + Math.abs(Number(row.cost ?? 0))
    });
  }

  for (const memo of returns) {
    const relieved = relievedByReturn.get(memo.purchaseReturnOrderId!);
    // Credited quantity x that item's per-unit carried cost.
    let carried = 0;
    for (const creditLine of creditLines) {
      if (creditLine.memoId !== memo.id) continue;
      const itemId = itemByLine.get(
        creditLine.purchaseReturnOrderLineId as string
      );
      const totals = itemId ? relieved?.get(itemId) : undefined;
      if (!totals || totals.qty === 0) continue;
      carried += (totals.cost / totals.qty) * Number(creditLine.quantity ?? 0);
    }
    // Only override when we actually recovered a cost basis. A zero-cost or
    // accounting-disabled-at-shipment return keeps the two-line shape.
    result.set(memo.id, carried > 0 ? carried : undefined);
  }
  return result;
}
