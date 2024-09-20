import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { postTransactionTask } from "~/trigger/post-transaction";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
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
  });

  throw redirect(path.to.receipts);
}
