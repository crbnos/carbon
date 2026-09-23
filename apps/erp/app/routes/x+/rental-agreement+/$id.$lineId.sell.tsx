import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement, getRentalAgreementLine } from "~/modules/sales";
import {
  generateRentalInvoicesNow,
  insertRentalPurchaseOptionCharge
} from "~/modules/sales/sales.server";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/**
 * "Sell to customer" — the purchase option on a Sales-Type line (spec §4).
 * Bills a `Purchase Option` charge for the agreement's option amount and
 * drafts its invoice right away; posting that invoice credits the net
 * investment and marks the line Sold. The charge is valid on its own, so a
 * failed generation leaves it for the daily billing job rather than undoing
 * it.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Adds a charge (sales) and drafts its invoice (invoicing).
  const { client, companyId, userId } = await requirePermissions(request, {
    create: ["sales", "invoicing"],
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const [agreement, line] = await Promise.all([
    getRentalAgreement(client, id),
    getRentalAgreementLine(client, lineId)
  ]);

  if (
    agreement.error ||
    agreement.data?.companyId !== companyId ||
    line.error ||
    line.data.rentalAgreementId !== id
  ) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }

  const purchaseOptionAmount = agreement.data.purchaseOptionAmount;
  if (
    agreement.data.status !== "Active" ||
    line.data.lessorClassification !== "Sales-Type" ||
    line.data.status !== "On Rent" ||
    !purchaseOptionAmount
  ) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          null,
          "Only a sales-type unit on rent under an agreement with a purchase option can be sold"
        )
      )
    );
  }

  // One exercise per line: a second click must not bill the option twice.
  const existing = await client
    .from("rentalAgreementCharge")
    .select("id")
    .eq("rentalAgreementLineId", lineId)
    .eq("companyId", companyId)
    .eq("kind", "Purchase Option")
    .limit(1);
  if (existing.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(existing.error, "Failed to check the purchase option")
      )
    );
  }
  if ((existing.data ?? []).length > 0) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "The purchase option has already been billed")
      )
    );
  }

  const today = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();

  // The option is exercised at the end of the term: the schedule and the
  // remaining rent run to the end date, so an earlier exercise would keep
  // billing rent on a unit the customer already owns. Early termination of
  // a sales-type lease is a manual journal, as for a return.
  const endDate = agreement.data.endDate;
  if (endDate && today < endDate) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          null,
          `The purchase option is exercised at the end of the term (${endDate}); early termination of a sales-type lease is a manual journal`
        )
      )
    );
  }

  const charge = await insertRentalPurchaseOptionCharge(client, {
    rentalAgreementLineId: lineId,
    amount: purchaseOptionAmount,
    chargeDate: today,
    description: "Purchase option exercised",
    taxPercent: agreement.data.taxPercent ?? 0,
    companyId,
    createdBy: userId
  });

  if (charge.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(charge.error, "Failed to bill the purchase option")
      )
    );
  }

  try {
    await generateRentalInvoicesNow(getDatabaseClient(), {
      companyId,
      asOf: today,
      rentalAgreementId: id,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          err,
          err instanceof Error
            ? `The purchase option was billed but its invoice was not drafted: ${err.message}`
            : "The purchase option was billed but its invoice was not drafted"
        )
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(
      request,
      success(
        "Purchase option invoice drafted. Posting it transfers the unit to the customer."
      )
    )
  );
}
