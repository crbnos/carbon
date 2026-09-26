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

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent !== "close" && intent !== "cancel") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(null, "Invalid status change"))
    );
  }

  const agreement = await getRentalAgreement(client, id);
  if (agreement.error || agreement.data?.companyId !== companyId) {
    throw redirect(
      path.to.rentalAgreements,
      await flash(request, error(agreement.error, "Rental agreement not found"))
    );
  }

  // The edge function owns the guards: close needs every unit back and every
  // period invoiced; cancel needs no unit on rent and no invoiced period.
  const result = await client.functions.invoke("post-rental-agreement", {
    body: {
      type: intent,
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
            intent === "close"
              ? "Failed to close rental agreement"
              : "Failed to cancel rental agreement"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(
      request,
      success(
        intent === "close"
          ? "Rental agreement closed"
          : "Rental agreement cancelled"
      )
    )
  );
}
