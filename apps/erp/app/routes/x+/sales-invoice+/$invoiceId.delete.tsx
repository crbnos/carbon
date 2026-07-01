import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteSalesInvoice } from "~/modules/invoicing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw notFound("invoiceId not found");

  const remove = await deleteSalesInvoice(client, invoiceId);

  if (remove.error) {
    throw redirect(
      path.to.invoicingSales,
      await flash(
        request,
        error(remove.error, "Failed to delete sales invoice")
      )
    );
  }

  throw redirect(path.to.invoicingSales);
}
