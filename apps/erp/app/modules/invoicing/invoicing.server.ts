import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  type CommandError,
  type CommandResult,
  commandOk
} from "~/utils/command-result";
import { getEdgeFunctionErrorMessage } from "~/utils/error";

// Settlement document COMMANDS: post and void payments and memos, void card
// transactions. The bodies used to live in the `x+/payments+`, `x+/credits+`
// and `x+/invoicing+/card-transactions` route actions; the routes call these
// and flash the result, and `invoicing.mcp.server.ts` publishes them as tools.
// The edge functions own every rule (Draft/Posted status, balances, periods)
// and run in one transaction; they are invoked through the service role, as
// the routes did, so a caller MUST have passed the route's
// `requirePermissions({ update: "invoicing" })` (or `requireToolPermission`).

const logger = getLogger("erp", "invoicing", "settlements");

type SettlementCommandContext = { companyId: string; userId: string };

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/** Runs one posting call (named literally at each call site, so the posting
 *  reachability guard in mcp-registry-parity.test.ts can see it). */
async function invokePosting(
  flash: string,
  call: (serviceRole: ServiceRole) => Promise<{ error: unknown }>
): Promise<{ data: null; error: CommandError } | null> {
  let result: { error: unknown };
  try {
    result = await call(getCarbonServiceRole());
  } catch (cause) {
    logger.error(flash, { error: cause });
    return { data: null, error: { message: flash, flash, cause } };
  }
  if (!result.error) return null;
  // The edge function's own message (errorResponse never puts database errors
  // there) is the reason an API caller reads; the screen keeps its toast.
  const reason = await getEdgeFunctionErrorMessage(result.error, "");
  return {
    data: null,
    error: {
      message: reason && reason !== flash ? `${flash}: ${reason}` : flash,
      flash,
      cause: result.error
    }
  };
}

/**
 * Post a Draft payment, as the payment's Post action does
 * (`x+/payments+/$paymentId.post.tsx`): the `post-payment` edge function
 * applies it to its invoices and memos and books its journal.
 */
export async function postPayment(
  args: SettlementCommandContext & { paymentId: string }
): Promise<CommandResult<{ id: string }>> {
  const { paymentId, companyId, userId } = args;
  const failed = await invokePosting("Failed to post payment", (serviceRole) =>
    serviceRole.functions.invoke("post-payment", {
      body: { type: "post", paymentId, userId, companyId }
    })
  );
  return failed ?? commandOk({ id: paymentId });
}

/**
 * Void a Posted payment, as the payment's Void action does
 * (`x+/payments+/$paymentId.void.tsx`): `post-payment` reverses its journal
 * and settlements.
 */
export async function voidPayment(
  args: SettlementCommandContext & { paymentId: string }
): Promise<CommandResult<{ id: string }>> {
  const { paymentId, companyId, userId } = args;
  const failed = await invokePosting("Failed to void payment", (serviceRole) =>
    serviceRole.functions.invoke("post-payment", {
      body: { type: "void", paymentId, userId, companyId }
    })
  );
  return failed ?? commandOk({ id: paymentId });
}

/**
 * Post a Draft credit or debit memo, as the memo's Post action does
 * (`x+/credits+/$memoId.post.tsx`): the `post-memo` edge function books its
 * journal.
 */
export async function postMemo(
  args: SettlementCommandContext & { memoId: string }
): Promise<CommandResult<{ id: string }>> {
  const { memoId, companyId, userId } = args;
  const failed = await invokePosting("Failed to post memo", (serviceRole) =>
    serviceRole.functions.invoke("post-memo", {
      body: { type: "post", memoId, userId, companyId }
    })
  );
  return failed ?? commandOk({ id: memoId });
}

/**
 * Void a Posted memo, as the memo's Void action does
 * (`x+/credits+/$memoId.void.tsx`).
 */
export async function voidMemo(
  args: SettlementCommandContext & { memoId: string }
): Promise<CommandResult<{ id: string }>> {
  const { memoId, companyId, userId } = args;
  const failed = await invokePosting("Failed to void memo", (serviceRole) =>
    serviceRole.functions.invoke("post-memo", {
      body: { type: "void", memoId, userId, companyId }
    })
  );
  return failed ?? commandOk({ id: memoId });
}

/**
 * Void a posted card transaction, as its Void action does
 * (`x+/invoicing+/card-transactions.$id.void.tsx`).
 */
export async function voidCardTransaction(
  args: SettlementCommandContext & { cardTransactionId: string }
): Promise<CommandResult<{ id: string }>> {
  const { cardTransactionId, companyId, userId } = args;
  const failed = await invokePosting(
    "Failed to void card transaction",
    (serviceRole) =>
      serviceRole.functions.invoke("post-card-transaction", {
        body: { type: "void", cardTransactionId, userId, companyId }
      })
  );
  return failed ?? commandOk({ id: cardTransactionId });
}
