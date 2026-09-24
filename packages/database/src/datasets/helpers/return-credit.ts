import { round } from "../../../supabase/functions/shared/precision.ts";
import { insertRow, maybeOne, one, quote, rows } from "../sql.ts";
import type { Ctx, ReturnCreditSpec } from "../types.ts";
import { insertMemo } from "./memo.ts";

/**
 * Mirrors "Issue Credit" (createSalesReturnOrderCredit / createPurchaseReturnOrderCredit).
 * Tier 09 journals a Posted one with the other Posted memos.
 */
export async function seedReturnCredit(
  ctx: Ctx,
  args: {
    spec: ReturnCreditSpec;
    kind: "sales" | "purchase";
    partyId: string;
    returnOrderId: string;
  }
): Promise<string> {
  const { spec, kind } = args;
  const isSales = kind === "sales";
  const table = isSales ? "salesReturnOrder" : "purchaseReturnOrder";

  const order = await one<{
    readableId: string;
    currencyCode: string;
    exchangeRate: number;
  }>(
    ctx.client,
    `SELECT ${quote(`${table}Id`)} AS "readableId", "currencyCode", "exchangeRate"
     FROM ${quote(table)} WHERE id = $1 AND "companyId" = $2`,
    [args.returnOrderId, ctx.companyId]
  );
  const returnLines = await rows<{
    id: string;
    unitPrice: number;
    restockFeePercent: number;
  }>(
    ctx.client,
    `SELECT id, "unitPrice", "restockFeePercent" FROM ${quote(`${table}Line`)}
     WHERE ${quote(`${table}Id`)} = $1 AND "companyId" = $2 ORDER BY "lineNumber"`,
    [args.returnOrderId, ctx.companyId]
  );
  const currency = await maybeOne<{ decimalPlaces: number | null }>(
    ctx.client,
    `SELECT "decimalPlaces" FROM currency WHERE code = $1 AND "companyGroupId" = $2`,
    [order.currencyCode, ctx.companyGroupId]
  );

  const credited = spec.lines.map((line) => {
    const returnLine = returnLines[line.line - 1];
    if (!returnLine) {
      throw new Error(
        `Seed: return credit names line ${line.line}, which the return does not have`
      );
    }
    const unitPrice = Number(returnLine.unitPrice);
    const gross = line.quantity * unitPrice;
    return {
      id: returnLine.id,
      quantity: line.quantity,
      unitPrice,
      restockFee: gross * Number(returnLine.restockFeePercent)
    };
  });
  const total = credited.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice - line.restockFee,
    0
  );

  const memoId = await insertMemo(ctx, {
    direction: isSales ? "Credit" : "Debit",
    partyId: args.partyId,
    status: spec.status,
    dateOffset: spec.dateOffset,
    amount: round(total, Number(currency?.decimalPlaces ?? 2)),
    currencyCode: order.currencyCode,
    exchangeRate: Number(order.exchangeRate),
    reference: order.readableId,
    salesReturnOrderId: isSales ? args.returnOrderId : undefined,
    purchaseReturnOrderId: isSales ? undefined : args.returnOrderId
  });

  for (const line of credited) {
    await insertRow(ctx, `${table}CreditLine`, {
      memoId,
      [`${table}LineId`]: line.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      restockFee: line.restockFee
    });
  }
  return memoId;
}
