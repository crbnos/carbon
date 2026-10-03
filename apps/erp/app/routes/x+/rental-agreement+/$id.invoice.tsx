// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { DraftedRentalInvoice } from "@carbon/database/rental-billing";
import { batchTrigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement } from "~/modules/sales";
import { generateRentalInvoicesNow } from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

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
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Only an active rental agreement can be invoiced")
      )
    );
  }

  const timeZone = await getCompanyTimeZone(client, companyId);

  let invoices: DraftedRentalInvoice[];
  let invoiceIds: string[];
  try {
    ({ invoices, invoiceIds } = await generateRentalInvoicesNow(
      getDatabaseClient(),
      {
        companyId,
        asOf: datetime.today(timeZone).toString(),
        rentalAgreementId: id,
        userId
      }
    ));
  } catch (err) {
    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
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
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(request, success("Nothing is due on this agreement yet"))
    );
  }

  // Held invoices and Draft Only stay drafts; the rest post (and email) in
  // the background via carbon/invoice.automate.
  const toAutomate = invoices.filter(
    (i) => i.mode !== "Draft Only" && !i.holdReason
  );
  if (toAutomate.length > 0) {
    await batchTrigger(
      "invoice-automate",
      toAutomate.map((i) => ({
        payload: { companyId, invoiceId: i.invoiceId }
      }))
    );

    throw redirect(
      requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
      await flash(
        request,
        success(
          `Generated ${invoiceIds.length} invoice(s); posting ${toAutomate.length} automatically`
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.rentalAgreementDetails(id),
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
