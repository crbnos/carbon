// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import {
  insertRentalAgreement,
  rentalAgreementValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import {
  RentalAgreementDetailsForm,
  RentalSetupSteps
} from "~/modules/sales/ui/Rentals";
import { getCompanySettings, getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Rental Agreements`,
  to: path.to.rentalAgreements
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "sales"
  });

  const companySettings = await getCompanySettings(client, companyId);

  return {
    // Annual %, the rate lease classification discounts payments at.
    defaultDiscountRate: companySettings.data?.leaseDefaultDiscountRate ?? 0
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

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

  const sequence = await getNextSequence(client, "rentalAgreement", companyId);
  if (sequence.error || !sequence.data) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(
        request,
        error(sequence.error, "Failed to get the next rental agreement number")
      )
    );
  }

  const agreement = await insertRentalAgreement(client, {
    ...data,
    rentalAgreementId: sequence.data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (agreement.error || !agreement.data) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(
        request,
        error(agreement.error, "Failed to create rental agreement")
      )
    );
  }

  // The fleet register's Rent action opens this form with the unit to rent.
  const fixedAssetId = formData.get("fixedAssetId");
  if (typeof fixedAssetId === "string" && fixedAssetId) {
    const line = await upsertRentalAgreementLine(client, {
      rentalAgreementId: agreement.data.id,
      fixedAssetId,
      // The rate starts from the customer's, customer type's or item's
      // monthly rate; the planner can change it on the unit.
      rateUnit: "Month",
      companyId,
      createdBy: userId
    });
    if (line.error) {
      throw redirect(
        path.to.rentalAgreementSetup(agreement.data.id, "units"),
        await flash(
          request,
          error(
            line.error,
            "Agreement created, but the unit could not be added"
          )
        )
      );
    }
  }

  throw redirect(path.to.rentalAgreementSetup(agreement.data.id, "units"));
}

/** Step 1 of the rental agreement setup: creating the Draft. Every later
 *  step edits the Draft this saves (`$id.setup.*`). */
export default function NewRentalAgreementRoute() {
  const { defaultDiscountRate } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const { company, defaults, id: userId } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    rentalAgreementId: undefined,
    customerId: params.get("customerId") ?? "",
    locationId: defaults?.locationId ?? "",
    // The person setting the agreement up is usually the one who sold it.
    salesPersonId: userId,
    startDate: companyToday,
    endDate: undefined,
    // What a new agreement bills on until the Billing step says otherwise.
    billingCycle: "Calendar Month" as const,
    billingTiming: "Advance" as const,
    currencyCode: company?.baseCurrencyCode ?? "USD",
    depositAmount: 0,
    taxPercent: 0,
    discountRate: defaultDiscountRate,
    ownershipTransfers: false,
    specializedAsset: false,
    purchaseOptionReasonablyCertain: false
  };

  return (
    <SetupFrame
      title={<Trans>New Rental Agreement</Trans>}
      step="details"
      steps={<RentalSetupSteps current="details" />}
    >
      <RentalAgreementDetailsForm
        initialValues={initialValues}
        action={path.to.newRentalAgreement}
        fixedAssetId={params.get("fixedAssetId") ?? undefined}
      />
    </SetupFrame>
  );
}
