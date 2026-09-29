import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { postPayment } from "@carbon/server-functions/post-payment";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
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

  const serviceRole = getCarbonServiceRole();
  try {
    const result = await postPayment.withClient(
      serviceRole,
      getDatabaseClient(),
      {
        type: "void",
        paymentId,
        userId,
        companyId
      }
    );
    if (result.error) {
      throw redirect(
        path.to.payment(paymentId),
        await flash(request, error(result.error, "Failed to void payment"))
      );
    }
  } catch (err) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(err, "Failed to void payment"))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Payment voided"))
  );
}
