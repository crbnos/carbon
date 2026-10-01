// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getDefaultRentalRates,
  getRentalAgreement,
  getRentalAgreementLine,
  rentalAgreementLineValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementCharges,
  RentalAgreementLineForm,
  RentalAgreementLineSummary,
  RentalBillingPeriods,
  resolveLineLeaseClassification
} from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
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
        error(line.error ?? agreement.error, "Failed to load the unit")
      )
    );
  }

  // While Draft, the rates on file for the line's item: where its rate came
  // from, and what it starts at if the frequency changes.
  const defaults =
    agreement.data.status === "Draft" &&
    agreement.data.customerId &&
    agreement.data.currencyCode &&
    agreement.data.startDate
      ? await getDefaultRentalRates(client, {
          companyId,
          customerId: agreement.data.customerId,
          currencyCode: agreement.data.currencyCode,
          asOf: agreement.data.startDate,
          itemIds: [line.data.itemId]
        })
      : null;

  return {
    line: line.data,
    defaultRates: defaults?.data?.[line.data.itemId] ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const [agreement, existing] = await Promise.all([
    getRentalAgreement(client, id),
    getRentalAgreementLine(client, lineId)
  ]);
  if (
    agreement.error ||
    agreement.data?.companyId !== companyId ||
    existing.error ||
    existing.data.rentalAgreementId !== id
  ) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }
  if (agreement.data.status !== "Draft") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "A unit is fixed once the agreement is activated")
      )
    );
  }

  const formData = await request.formData();
  const validation = await validator(rentalAgreementLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, itemId: _itemId, ...line } = validation.data;

  const update = await upsertRentalAgreementLine(client, {
    ...line,
    rentalAgreementId: id,
    id: lineId,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(update.error, update.error.message || "Failed to update unit")
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementLine(id, lineId),
    await flash(request, success("Updated unit"))
  );
}

/** One unit of the agreement: where it is in its rental and its actions,
 *  its rates and accounting treatment, then its own charges and billing. */
export default function RentalAgreementLineRoute() {
  const { line, defaultRates } = useLoaderData<typeof loader>();

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(line.rentalAgreementId)
  );
  if (!routeData) return null;

  const agreement = routeData.rentalAgreement;
  const lease = resolveLineLeaseClassification({
    agreement,
    line,
    policy: routeData.leasePolicy
  });

  return (
    <>
      <RentalAgreementLineSummary rentalAgreement={agreement} line={line} />
      <RentalAgreementLineForm
        key={`${line.id}-${line.updatedAt ?? ""}`}
        type="card"
        initialValues={{
          id: line.id,
          rentalAgreementId: line.rentalAgreementId,
          fixedAssetId: line.fixedAssetId ?? "",
          itemId: line.itemId,
          rateUnit: line.rateUnit,
          rate: line.rate,
          fairValue: line.fairValue ?? undefined,
          economicLifeMonths: line.economicLifeMonths ?? undefined,
          guaranteedResidualValue: line.guaranteedResidualValue ?? undefined,
          unguaranteedResidualValue: line.unguaranteedResidualValue ?? undefined
        }}
        customerId={agreement.customerId ?? ""}
        currencyCode={agreement.currencyCode ?? ""}
        startDate={agreement.startDate ?? ""}
        rentableAssets={routeData.rentableAssets}
        currentAsset={
          line.fixedAssetId
            ? {
                id: line.fixedAssetId,
                itemId: line.itemId,
                label: [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
                  .filter(Boolean)
                  .join(" · ")
              }
            : undefined
        }
        defaultRates={defaultRates}
        lease={lease}
        isLocked={agreement.status !== "Draft"}
      />
      <RentalAgreementCharges
        rentalAgreement={agreement}
        charges={routeData.charges}
        lines={routeData.lines}
        invoiceLinks={routeData.invoiceLinks}
        lineId={line.id}
      />
      <RentalBillingPeriods
        rentalAgreement={agreement}
        periods={routeData.periods.filter(
          (period) => period.rentalAgreementLineId === line.id
        )}
        invoiceLinks={routeData.invoiceLinks}
      />
    </>
  );
}
