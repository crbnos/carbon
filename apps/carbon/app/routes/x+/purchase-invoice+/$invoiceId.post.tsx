import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { postTransactionTask } from "~/trigger/post-transaction"; // Assuming this is where your task is defined
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
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
  });

  throw redirect(path.to.purchaseInvoices);
}
