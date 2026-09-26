import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteRentalAgreementCharge } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id, chargeId } = params;
  if (!id) throw notFound("id not found");
  if (!chargeId) throw notFound("chargeId not found");

  // The charge must sit on a line of the URL's agreement.
  const charge = await client
    .from("rentalAgreementCharge")
    .select(
      "id, salesInvoiceLineId, rentalAgreementLine!inner(rentalAgreementId)"
    )
    .eq("id", chargeId)
    .eq("companyId", companyId)
    .eq("rentalAgreementLine.rentalAgreementId", id)
    .maybeSingle();

  if (charge.error || !charge.data) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(charge.error, "This charge does not belong to this agreement")
      )
    );
  }

  if (charge.data.salesInvoiceLineId) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          null,
          "The charge is on an invoice. Delete or void the invoice first."
        )
      )
    );
  }

  const result = await deleteRentalAgreementCharge(client, chargeId);
  if (result.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(result.error, "Failed to delete charge"))
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Deleted charge"))
  );
}
