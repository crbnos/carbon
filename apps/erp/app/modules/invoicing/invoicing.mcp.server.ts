import { requireToolPermission } from "~/modules/shared/tool-permission.server";
import { toToolResult } from "~/utils/command-result";
import {
  postMemo as postMemoCommand,
  postPayment as postPaymentCommand,
  voidCardTransaction as voidCardTransactionCommand,
  voidMemo as voidMemoCommand,
  voidPayment as voidPaymentCommand
} from "./invoicing.server";

// MCP/API tools for posting and voiding settlement documents. Each wraps the
// command its ERP route calls (`invoicing.server.ts`). Server-only: never
// re-exported by the `~/modules/invoicing` barrel; `registry.server.ts` spreads
// these exports into the `invoicing` namespace and `scripts/generate-mcp.ts`
// publishes them.
//
// The commands invoke the posting edge functions through the service role, so
// every tool re-applies the routes' `requirePermissions({ update: "invoicing"
// })` through `requireToolPermission` first. The edge functions own the status
// rules; their refusal reason is returned as the tool's error.
//
// Sales and purchase invoice post/void are not here: those routes also
// evaluate sales rules, render and email the invoice PDF, and are still
// route-only.

const INVOICING_UPDATE = { update: "invoicing" } as const;

/**
 * Post a Draft payment, applying it to its invoices and memos and booking its
 * journal, as the payment's Post action does. `paymentId` is the payment's id
 * (not its readable number).
 */
export async function postPayment(
  companyId: string,
  userId: string,
  args: { paymentId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVOICING_UPDATE,
    "post payments"
  );
  return toToolResult(
    await postPaymentCommand({ companyId, userId, paymentId: args.paymentId })
  );
}

/**
 * Void a Posted payment, reversing its journal and settlements, as the
 * payment's Void action does.
 */
export async function voidPayment(
  companyId: string,
  userId: string,
  args: { paymentId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVOICING_UPDATE,
    "void payments"
  );
  return toToolResult(
    await voidPaymentCommand({ companyId, userId, paymentId: args.paymentId })
  );
}

/**
 * Post a Draft credit or debit memo, booking its journal, as the memo's Post
 * action does. `memoId` is the memo's id (not its readable number).
 */
export async function postMemo(
  companyId: string,
  userId: string,
  args: { memoId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVOICING_UPDATE,
    "post memos"
  );
  return toToolResult(
    await postMemoCommand({ companyId, userId, memoId: args.memoId })
  );
}

/**
 * Void a Posted credit or debit memo, reversing its journal, as the memo's
 * Void action does.
 */
export async function voidMemo(
  companyId: string,
  userId: string,
  args: { memoId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVOICING_UPDATE,
    "void memos"
  );
  return toToolResult(
    await voidMemoCommand({ companyId, userId, memoId: args.memoId })
  );
}

/**
 * Void a posted card transaction, reversing its journal, as the card
 * transaction's Void action does.
 */
export async function voidCardTransaction(
  companyId: string,
  userId: string,
  args: { cardTransactionId: string }
) {
  await requireToolPermission(
    companyId,
    userId,
    INVOICING_UPDATE,
    "void card transactions"
  );
  return toToolResult(
    await voidCardTransactionCommand({
      companyId,
      userId,
      cardTransactionId: args.cardTransactionId
    })
  );
}
