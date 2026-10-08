// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { Json } from "@carbon/database";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { getExchangeRate } from "~/modules/accounting";
import {
  getRentalAgreement,
  rentalAgreementValidator,
  updateRentalAgreement
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalAgreementDetailsForm } from "~/modules/sales/ui/Rentals";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

/** Saves a Draft's details from setup step 1 and moves on to Units. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const current = await getRentalAgreement(client, id, companyId);
  if (current.error || current.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(current.error, "Rental agreement not found"))
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

  // A missing rate is an error, never 1 — as the properties panel.
  let exchangeRate: number | undefined;
  if (data.currencyCode !== current.data.currencyCode) {
    const rate = await getExchangeRate(client, companyId, data.currencyCode);
    if (rate.error || !rate.data) {
      throw redirect(
        path.to.rentalAgreementSetup(id, "details"),
        await flash(
          request,
          error(rate.error, "Failed to get the exchange rate")
        )
      );
    }
    exchangeRate = Number(rate.data);
  }

  // Refuses an agreement that is no longer a Draft.
  const update = await updateRentalAgreement(client, {
    ...data,
    ...(exchangeRate !== undefined ? { exchangeRate } : {}),
    id,
    companyId,
    updatedBy: userId,
    // Merged, so a field the form did not render is kept.
    customFields: {
      ...((current.data.customFields ?? {}) as Record<string, unknown>),
      ...setCustomFields(formData)
    } as Json
  });
  if (update.error) {
    throw redirect(
      path.to.rentalAgreementSetup(id, "details"),
      await flash(
        request,
        error(
          update.error,
          update.error.message || "Failed to update rental agreement"
        )
      )
    );
  }

  throw redirect(path.to.rentalAgreementSetup(id, "units"));
}

export default function RentalAgreementSetupDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  if (!routeData) return null;
  const { rentalAgreement: agreement } = routeData;

  return (
    <RentalAgreementDetailsForm
      key={agreement.updatedAt ?? id}
      action={path.to.rentalAgreementSetup(id, "details")}
      initialValues={{
        id,
        rentalAgreementId: agreement.rentalAgreementId ?? undefined,
        customerId: agreement.customerId ?? "",
        customerLocationId: agreement.customerLocationId ?? undefined,
        customerContactId: agreement.customerContactId ?? undefined,
        salesPersonId: agreement.salesPersonId ?? undefined,
        locationId: agreement.locationId ?? "",
        startDate: agreement.startDate ?? "",
        endDate: agreement.endDate ?? undefined,
        billingCycle: agreement.billingCycle ?? "Calendar Month",
        billingTiming: agreement.billingTiming ?? "Advance",
        paymentTermId: agreement.paymentTermId ?? undefined,
        currencyCode: agreement.currencyCode ?? "",
        depositAmount: Number(agreement.depositAmount ?? 0),
        taxPercent: Number(agreement.taxPercent ?? 0),
        discountRate: Number(agreement.discountRate ?? 0),
        ownershipTransfers: agreement.ownershipTransfers ?? false,
        specializedAsset: agreement.specializedAsset ?? false,
        purchaseOptionAmount: agreement.purchaseOptionAmount ?? undefined,
        purchaseOptionReasonablyCertain:
          agreement.purchaseOptionReasonablyCertain ?? false,
        notes: agreement.notes ?? undefined,
        ...getCustomFields(agreement.customFields)
      }}
    />
  );
}
