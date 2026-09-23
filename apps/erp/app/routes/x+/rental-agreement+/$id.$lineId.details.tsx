import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getItemRentalRate,
  getRentalAgreement,
  getRentalAgreementLine,
  rentalAgreementLineValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import {
  RentalAgreementLineForm,
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

  // After activation the line carries its own snapshot of the ladder; before,
  // show what activation would snapshot.
  const isSnapshot = agreement.data.status !== "Draft";
  let rates = {
    dayRate: line.data.dayRate,
    weekRate: line.data.weekRate,
    monthRate: line.data.monthRate
  };
  if (!isSnapshot && agreement.data.currencyCode) {
    const ladder = await getItemRentalRate(
      client,
      line.data.itemId,
      companyId,
      agreement.data.currencyCode
    );
    rates = {
      dayRate: ladder.data?.dayRate ?? null,
      weekRate: ladder.data?.weekRate ?? null,
      monthRate: ladder.data?.monthRate ?? null
    };
  }

  return { line: line.data, rates, isSnapshot };
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
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Updated unit"))
  );
}

export default function RentalAgreementLineRoute() {
  const { line, rates, isSnapshot } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(line.rentalAgreementId)
  );
  const agreement = routeData?.rentalAgreement;
  const status = agreement?.status;
  const lease =
    agreement && routeData
      ? resolveLineLeaseClassification({
          agreement,
          line,
          ladder: rates,
          policy: routeData.leasePolicy
        })
      : null;

  return (
    <RentalAgreementLineForm
      key={line.id}
      initialValues={{
        id: line.id,
        rentalAgreementId: line.rentalAgreementId,
        fixedAssetId: line.fixedAssetId ?? "",
        itemId: line.itemId,
        rateMode: line.rateMode,
        rateUnit: line.rateUnit ?? undefined,
        fairValue: line.fairValue ?? undefined,
        economicLifeMonths: line.economicLifeMonths ?? undefined,
        guaranteedResidualValue: line.guaranteedResidualValue ?? undefined,
        unguaranteedResidualValue: line.unguaranteedResidualValue ?? undefined
      }}
      currencyCode={routeData?.rentalAgreement.currencyCode ?? ""}
      rentableAssets={routeData?.rentableAssets ?? []}
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
      rates={rates}
      isSnapshot={isSnapshot}
      lease={lease}
      isLocked={status !== "Draft"}
      onClose={() =>
        navigate(path.to.rentalAgreementDetails(line.rentalAgreementId))
      }
    />
  );
}
