import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deletePurchaseInvoice } from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "invoicing",
  });

  const { invoiceId } = params;
  if (!invoiceId) throw notFound("invoiceId not found");

  const remove = await deletePurchaseInvoice(client, invoiceId);

  if (remove.error) {
    throw redirect(
      path.to.purchaseInvoices,
      await flash(
        request,
        error(remove.error, "Failed to delete purchase invoice")
      )
    );
  }

  throw redirect(path.to.purchaseInvoices);
}
