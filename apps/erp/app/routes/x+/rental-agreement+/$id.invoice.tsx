import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement } from "~/modules/sales";
import { generateRentalInvoicesNow } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Drafts sales invoices, so the invoicing permission is required too.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales",
    create: "invoicing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }

  if (agreement.data.status !== "Active") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Only an active rental agreement can be invoiced")
      )
    );
  }

  const timeZone = await getCompanyTimeZone(client, companyId);

  let invoiceIds: string[];
  try {
    ({ invoiceIds } = await generateRentalInvoicesNow(getDatabaseClient(), {
      companyId,
      asOf: datetime.today(timeZone).toString(),
      rentalAgreementId: id,
      userId
    }));
  } catch (err) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to generate invoices"
        )
      )
    );
  }

  if (invoiceIds.length === 0) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, success("Nothing is due on this agreement yet"))
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(
      request,
      success(
        invoiceIds.length === 1
          ? "Drafted 1 rental invoice"
          : `Drafted ${invoiceIds.length} rental invoices`
      )
    )
  );
}
