import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import type { postTransactionTask } from "~/trigger/post-transaction";
import { path } from "~/utils/path";

// export const config = { runtime: "nodejs" };

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { receiptId } = params;
  if (!receiptId) throw new Error("receiptId not found");

  const setPendingState = await client
    .from("receipt")
    .update({
      status: "Pending",
    })
    .eq("id", receiptId);

  if (setPendingState.error) {
    throw redirect(
      path.to.receipts,
      await flash(
        request,
        error(setPendingState.error, "Failed to post receipt")
      )
    );
  }

  await tasks.trigger<typeof postTransactionTask>("post-transactions", {
    type: "receipt",
    documentId: receiptId,
    userId,
  });

  throw redirect(path.to.receipts);
}
