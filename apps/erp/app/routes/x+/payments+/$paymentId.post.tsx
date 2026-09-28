import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { postPayment } from "~/modules/invoicing/invoicing.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { paymentId } = params;
  if (!paymentId) {
    return { success: false, message: "Missing paymentId" };
  }

  // Shared with the invoicing_postPayment tool.
  const result = await postPayment({ paymentId, companyId, userId });
  if (result.error) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Payment posted"))
  );
}
