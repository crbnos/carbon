import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useCompanyToday, useUrlParams, useUser } from "~/hooks";
import {
  insertRentalAgreement,
  rentalAgreementValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import { RentalAgreementForm } from "~/modules/sales/ui/Rentals";
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
      rateMode: "Best Rate",
      companyId,
      createdBy: userId
    });
    if (line.error) {
      throw redirect(
        path.to.rentalAgreementDetails(agreement.data.id),
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

  throw redirect(path.to.rentalAgreementDetails(agreement.data.id));
}

export default function NewRentalAgreementRoute() {
  const { defaultDiscountRate } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const { company, defaults } = useUser();
  const companyToday = useCompanyToday();

  const initialValues = {
    id: undefined,
    rentalAgreementId: undefined,
    customerId: params.get("customerId") ?? "",
    locationId: defaults?.locationId ?? "",
    startDate: companyToday,
    endDate: undefined,
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
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <RentalAgreementForm
        initialValues={initialValues}
        fixedAssetId={params.get("fixedAssetId") ?? undefined}
      />
    </div>
  );
}
