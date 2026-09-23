import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteSalesInvoiceReleasingRentals } from "~/modules/sales/sales.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    delete: "invoicing"
  });

  const { invoiceId } = params;
  if (!invoiceId) throw notFound("invoiceId not found");

  // Draft only; a rental invoice releases the periods and charges it billed.
  try {
    await deleteSalesInvoiceReleasingRentals(getDatabaseClient(), {
      companyId,
      invoiceId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.invoicingSales,
      await flash(request, error(err, "Failed to delete sales invoice"))
    );
  }

  throw redirect(path.to.invoicingSales);
}
