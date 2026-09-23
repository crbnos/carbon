import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement } from "~/modules/sales";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
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
        error(null, "Only a Draft rental agreement can be activated")
      )
    );
  }

  if (!agreement.data.lineCount) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(null, "Add a unit before activating"))
    );
  }

  // Validates every unit, snapshots the rate ladder, classifies each line and
  // cuts the first billing periods — one transaction in the edge function.
  const result = await client.functions.invoke("post-rental-agreement", {
    body: {
      type: "activate",
      companyId,
      userId,
      rentalAgreementId: id
    }
  });

  if (result.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to activate rental agreement"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Rental agreement activated"))
  );
}
