import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteRentalAgreementLine,
  getRentalAgreement,
  getRentalAgreementLine
} from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales"
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
    !line.data ||
    line.data.rentalAgreementId !== id
  ) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }

  // An activated line has billing periods behind it — return the unit or
  // cancel the agreement instead.
  if (agreement.data.status !== "Draft") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "Units can only be removed from a Draft rental agreement")
      )
    );
  }

  const result = await deleteRentalAgreementLine(client, lineId);
  if (result.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(result.error, "Failed to remove unit"))
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Removed unit from the agreement"))
  );
}
