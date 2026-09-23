import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteRentalAgreement, getRentalAgreement } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    return data(
      {},
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }

  // An activated agreement has billing periods and possibly invoices — it is
  // cancelled or closed instead.
  if (agreement.data.status !== "Draft") {
    return data(
      {},
      await flash(
        request,
        error(
          null,
          "Only a Draft rental agreement can be deleted. Cancel it instead."
        )
      )
    );
  }

  const result = await deleteRentalAgreement(client, id);
  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to delete rental agreement")
      )
    );
  }

  throw redirect(
    path.to.rentalAgreements,
    await flash(request, success("Deleted rental agreement"))
  );
}
