import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getRentalAgreement,
  rentalAgreementValidator,
  updateRentalAgreement
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

// The agreement page renders the terms form itself (`$id.tsx`); this route
// only takes its submission, so a GET falls through to the page.
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

// The agreement page ($id.tsx) renders the terms form itself; this child only
// receives its save. A component (rendering nothing) keeps `/details` — where
// `$id._index` and every action redirect — a page rather than a resource
// route, so a reload or a pasted link opens the agreement.
export default function RentalAgreementDetailsRoute() {
  return null;
}
