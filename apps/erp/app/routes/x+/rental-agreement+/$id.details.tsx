// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { draftRentalAgreementSetupPath } from "~/modules/sales/sales.server";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import {
  LeaseClassificationPreview,
  RentalAgreementCharges,
  RentalAgreementSummary,
  RentalBillingPeriods,
  RentalDeposits
} from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

/** A Draft is worked on in its setup wizard, so its page sends an editor
 *  there — including every action that returns to the agreement page. A
 *  viewer who cannot edit sees the page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "sales"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const setup = await draftRentalAgreementSetupPath(client, {
    companyId,
    userId,
    id
  });
  if (setup) throw redirect(setup);
  return null;
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
              currencyCode={rentalAgreement.currencyCode}
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
