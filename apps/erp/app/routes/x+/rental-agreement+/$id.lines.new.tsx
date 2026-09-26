import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import {
  getRentalAgreement,
  rentalAgreementLineValidator,
  upsertRentalAgreementLine
} from "~/modules/sales";
import type { RentalAgreementRouteData } from "~/modules/sales/ui/Rentals";
import { RentalAgreementLineForm } from "~/modules/sales/ui/Rentals";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }
  if (agreement.data.status !== "Draft") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Units can only be added to a Draft rental agreement")
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

  const insert = await upsertRentalAgreementLine(client, {
    ...line,
    // The agreement checked above is the URL's — never the form's copy.
    rentalAgreementId: id,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(insert.error, insert.error.message || "Failed to add unit")
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Added unit to the agreement"))
  );
}

export default function NewRentalAgreementLineRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const navigate = useNavigate();

  const routeData = useRouteData<RentalAgreementRouteData>(
    path.to.rentalAgreement(id)
  );

  return (
    <RentalAgreementLineForm
      initialValues={{
        rentalAgreementId: id,
        fixedAssetId: "",
        rateMode: "Best Rate"
      }}
      currencyCode={routeData?.rentalAgreement.currencyCode ?? ""}
      rentableAssets={routeData?.rentableAssets ?? []}
      onClose={() => navigate(path.to.rentalAgreementDetails(id))}
    />
  );
}
