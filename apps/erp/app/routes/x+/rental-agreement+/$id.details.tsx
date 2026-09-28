import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getRentalAgreement,
  rentalAgreementValidator,
  updateRentalAgreement
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementCharges,
  RentalAgreementForm,
  RentalAgreementLines,
  RentalAgreementSummary,
  RentalBillingPeriods,
  RentalDeposits
} from "~/modules/sales/ui/Rentals";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const current = await getRentalAgreement(client, id);
  if (current.error || current.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(current.error, "Rental agreement not found"))
    );
  }

  // Billing periods and the lease classification are cut from these terms at
  // activation — they are fixed from then on.
  if (current.data.status !== "Draft") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Only a Draft rental agreement's terms can be edited")
      )
    );
  }

  const formData = await request.formData();
  const validation = await validator(rentalAgreementValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _id,
    rentalAgreementId: _rentalAgreementId,
    ...data
  } = validation.data;

  const update = await updateRentalAgreement(client, {
    ...data,
    id,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update rental agreement")
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Updated rental agreement"))
  );
}

/** The agreement as a whole: what it is owed, its units, charges, billing
 *  and deposits, then its terms. A unit's own page is `$lineId.details`. */
export default function RentalAgreementDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;

  const {
    rentalAgreement,
    lines,
    charges,
    periods,
    deposits,
    invoiceLinks,
    leasePolicy,
    leaseInputs
  } = routeData;

  const initialValues = {
    id,
    rentalAgreementId: rentalAgreement.rentalAgreementId ?? undefined,
    customerId: rentalAgreement.customerId ?? "",
    customerLocationId: rentalAgreement.customerLocationId ?? undefined,
    customerContactId: rentalAgreement.customerContactId ?? undefined,
    salesPersonId: rentalAgreement.salesPersonId ?? undefined,
    locationId: rentalAgreement.locationId ?? "",
    startDate: rentalAgreement.startDate ?? "",
    endDate: rentalAgreement.endDate ?? undefined,
    billingCycle: rentalAgreement.billingCycle ?? ("Calendar Month" as const),
    billingTiming: rentalAgreement.billingTiming ?? ("Advance" as const),
    paymentTermId: rentalAgreement.paymentTermId ?? undefined,
    currencyCode: rentalAgreement.currencyCode ?? "",
    depositAmount: rentalAgreement.depositAmount ?? 0,
    taxPercent: rentalAgreement.taxPercent ?? 0,
    discountRate: rentalAgreement.discountRate ?? 0,
    ownershipTransfers: rentalAgreement.ownershipTransfers ?? false,
    specializedAsset: rentalAgreement.specializedAsset ?? false,
    purchaseOptionAmount: rentalAgreement.purchaseOptionAmount ?? undefined,
    purchaseOptionReasonablyCertain:
      rentalAgreement.purchaseOptionReasonablyCertain ?? false,
    notes: rentalAgreement.notes ?? undefined,
    ...getCustomFields(rentalAgreement.customFields)
  };

  return (
    <>
      <RentalAgreementSummary rentalAgreement={rentalAgreement} />
      <RentalAgreementLines rentalAgreement={rentalAgreement} lines={lines} />
      <RentalAgreementCharges
        rentalAgreement={rentalAgreement}
        charges={charges}
        lines={lines}
        invoiceLinks={invoiceLinks}
      />
      <RentalBillingPeriods
        rentalAgreement={rentalAgreement}
        periods={periods}
        invoiceLinks={invoiceLinks}
      />
      <RentalDeposits rentalAgreement={rentalAgreement} deposits={deposits} />
      <RentalAgreementForm
        key={`${id}-${rentalAgreement.updatedAt ?? ""}`}
        initialValues={initialValues}
        isLocked={rentalAgreement.status !== "Draft"}
        leasePolicy={leasePolicy}
        lines={lines}
        leaseInputs={leaseInputs}
      />
    </>
  );
}
