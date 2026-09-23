import { resolveDate, resolveTimestamp } from "../dates.ts";
import { insertId, nextSequence, one } from "../sql.ts";
import type { Ctx, DayOffset } from "../types.ts";

export type MemoInsert = {
  direction: "Credit" | "Debit";
  /** customerId for a Credit memo, supplierId for a Debit one. */
  partyId: string;
  status: "Draft" | "Posted";
  dateOffset: DayOffset;
  amount: number;
  currencyCode: string;
  exchangeRate: number;
  reference: string;
  salesReturnOrderId?: string;
  purchaseReturnOrderId?: string;
  notes?: string;
};

/**
 * A memo header as the app leaves it: Draft is what Issue Credit writes; Posted
 * adds post-memo's stamps and reason account. Tier 09's postMemos journals
 * every Posted one afterwards.
 */
export async function insertMemo(ctx: Ctx, memo: MemoInsert): Promise<string> {
  const isCredit = memo.direction === "Credit";
  const posted = memo.status === "Posted";
  const memoDate = resolveDate(ctx.anchor, memo.dateOffset);
  return insertId(ctx, "memo", {
    memoId: await nextSequence(ctx, isCredit ? "creditMemo" : "debitMemo"),
    direction: memo.direction,
    status: memo.status,
    customerId: isCredit ? memo.partyId : undefined,
    supplierId: isCredit ? undefined : memo.partyId,
    memoDate,
    currencyCode: memo.currencyCode,
    exchangeRate: memo.exchangeRate,
    amount: memo.amount,
    reference: memo.reference,
    salesReturnOrderId: memo.salesReturnOrderId,
    purchaseReturnOrderId: memo.purchaseReturnOrderId,
    notes: memo.notes,
    postingDate: posted ? memoDate : undefined,
    postedAt: posted
      ? resolveTimestamp(ctx.anchor, memo.dateOffset, "16:00:00")
      : undefined,
    postedBy: posted ? ctx.userId : undefined,
    reasonAccount: posted ? await reasonAccount(ctx, memo) : undefined
  });
}

/** post-memo's offset account: the return order's, else the party side's discount account. */
async function reasonAccount(ctx: Ctx, memo: MemoInsert): Promise<string> {
  const defaults = await one<{
    salesReturnsAccount: string | null;
    salesAccount: string | null;
    goodsReceivedNotInvoicedAccount: string | null;
    salesDiscountAccount: string | null;
    supplierPaymentDiscountAccount: string | null;
  }>(
    ctx.client,
    `SELECT "salesReturnsAccount", "salesAccount", "goodsReceivedNotInvoicedAccount",
            "salesDiscountAccount", "supplierPaymentDiscountAccount"
     FROM "accountDefault" WHERE "companyId" = $1`,
    [ctx.companyId]
  );
  const account = memo.salesReturnOrderId
    ? (defaults.salesReturnsAccount ?? defaults.salesAccount)
    : memo.purchaseReturnOrderId
      ? defaults.goodsReceivedNotInvoicedAccount
      : memo.direction === "Credit"
        ? defaults.salesDiscountAccount
        : defaults.supplierPaymentDiscountAccount;
  if (!account) {
    throw new Error(
      `Seed: accountDefault has no reason account for a Posted ${memo.direction} memo "${memo.reference}"`
    );
  }
  return account;
}
