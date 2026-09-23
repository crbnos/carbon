import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useCompanyToday, useRouteData } from "~/hooks";
import {
  getRentalAgreement,
  getRentalAgreementLine,
  rentalAgreementChargeValidator,
  upsertRentalAgreementCharge
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalAgreementChargeForm } from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(rentalAgreementChargeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...charge } = validation.data;

  const [agreement, line] = await Promise.all([
    getRentalAgreement(client, id),
    getRentalAgreementLine(client, charge.rentalAgreementLineId)
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
        error(null, "The unit does not belong to this rental agreement")
      )
    );
  }
  if (agreement.data.status !== "Draft" && agreement.data.status !== "Active") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Charges can only be added to an open rental agreement")
      )
    );
  }

  const insert = await upsertRentalAgreementCharge(client, {
    ...charge,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(insert.error, "Failed to add charge"))
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Added charge"))
  );
}

export default function NewRentalAgreementChargeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const navigate = useNavigate();
  const companyToday = useCompanyToday();

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );
  const lines = routeData?.lines ?? [];

  const lineOptions = lines.map((line) => ({
    value: line.id,
    label:
      [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
        .filter(Boolean)
        .join(" · ") ||
      line.item?.readableIdWithRevision ||
      line.id
  }));

  return (
    <RentalAgreementChargeForm
      initialValues={{
        rentalAgreementLineId: lines.length === 1 ? lines[0].id : "",
        chargeDate: companyToday,
        description: "",
        amount: 0,
        taxPercent: routeData?.rentalAgreement.taxPercent ?? 0
      }}
      currencyCode={routeData?.rentalAgreement.currencyCode ?? ""}
      lineOptions={lineOptions}
      onClose={() => navigate(path.to.rentalAgreementDetails(id))}
    />
  );
}
