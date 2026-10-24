// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { SetupFrame } from "~/components/Setup";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import { rentalAgreementValidator } from "~/modules/sales/sales.models";
import {
  RentalAgreementDetailsForm,
  RentalSetupSteps
} from "~/modules/sales/ui/Rentals";
import { getCompanySettings } from "~/modules/settings/settings.service";
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(rentalAgreementValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const formData = input.formData ?? new FormData();
  // The fleet register's Rent action opens this form with the unit to rent.
  const fixedAssetId = formData.get("fixedAssetId");
  const api = await carbon(args.request);
  const result = await api.sales.createRentalAgreement({
    ...input.data,
    fixedAssetId:
      typeof fixedAssetId === "string" && fixedAssetId
        ? fixedAssetId
        : undefined,
    customFields: setCustomFields(formData)
  });
  if (!result.data) {
    return respond(args.request, result).redirect(path.to.rentalAgreements, {
      message: ""
    });
  }
  // A unit that could not be added leaves the agreement, and says so.
  const { id, warning } = result.data;
  throw redirect(
    path.to.rentalAgreementSetup(id, "units"),
    warning ? await flash(args.request, error(null, warning)) : undefined
  );
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
