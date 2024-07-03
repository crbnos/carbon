import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { triggerClient } from "~/lib/trigger.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
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

  await triggerClient.sendEvent({
    name: "post.transactions",
    payload: {
      type: "purchase-invoice",
      documentId: invoiceId,
    },
  });

  throw redirect(path.to.purchaseInvoices);
}
