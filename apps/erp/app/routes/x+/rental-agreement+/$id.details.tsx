// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
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
  LeaseClassificationPreview,
  RentalAgreementCharges,
  RentalAgreementSummary,
  RentalBillingPeriods,
  RentalDeposits
} from "~/modules/sales/ui/Rentals";
import { setCustomFields } from "~/utils/form";
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

/** The agreement as a whole: the summary of its units and what it is owed,
 *  how it will be accounted for, then its charges, billing and deposits. The
 *  terms are in the properties panel; a unit's own page is `$lineId.details`. */
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

  return (
    <>
      <RentalAgreementSummary
        rentalAgreement={rentalAgreement}
        lines={lines}
        periods={periods}
      />
      {rentalAgreement.status === "Draft" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Accounting Treatment</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Whether each unit is treated as a rental or a sale is decided
                when the agreement is activated, from the terms and each unit's
                inputs.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeaseClassificationPreview
              terms={{
                startDate: rentalAgreement.startDate ?? "",
                endDate: rentalAgreement.endDate ?? null,
                billingCycle: rentalAgreement.billingCycle ?? "Calendar Month",
                billingTiming: rentalAgreement.billingTiming ?? "Advance",
                discountRate: Number(rentalAgreement.discountRate ?? 0),
                ownershipTransfers: rentalAgreement.ownershipTransfers ?? false,
                specializedAsset: rentalAgreement.specializedAsset ?? false,
                purchaseOptionAmount:
                  rentalAgreement.purchaseOptionAmount ?? null,
                purchaseOptionReasonablyCertain:
                  !!rentalAgreement.purchaseOptionAmount &&
                  (rentalAgreement.purchaseOptionReasonablyCertain ?? false)
              }}
              lines={lines}
              leaseInputs={leaseInputs}
              policy={leasePolicy}
            />
          </CardContent>
        </Card>
      )}
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
    </>
  );
}
