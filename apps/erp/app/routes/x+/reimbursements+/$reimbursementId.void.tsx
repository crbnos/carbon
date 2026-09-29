import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { voidReimbursement } from "~/modules/invoicing/reimbursement.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { reimbursementId } = params;
  if (!reimbursementId) {
    return { success: false, message: "Missing reimbursement id" };
  }

  // No totals guard here — a void reverses whatever was posted.
  const result = await voidReimbursement({
    reimbursementId,
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(null, result.error))
    );
  }

  throw redirect(
    path.to.reimbursement(reimbursementId),
    await flash(request, success("Reimbursement voided"))
  );
}
