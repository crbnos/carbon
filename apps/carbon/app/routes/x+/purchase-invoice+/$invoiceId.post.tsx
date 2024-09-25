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
    update: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw new Error("invoiceId not found");

  const setPendingState = await client
    .from("purchaseInvoice")
    .update({
      status: "Pending",
    })
    .eq("id", invoiceId);

  if (setPendingState.error) {
    throw redirect(
      path.to.purchaseInvoices,
      await flash(
        request,
        error(setPendingState.error, "Failed to post purchase invoice")
      )
    );
  }

  await tasks.trigger<typeof postTransactionTask>("post-transactions", {
    type: "purchase-invoice",
    documentId: invoiceId,
    userId,
  });

  throw redirect(path.to.purchaseInvoices);
}
