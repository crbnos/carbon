import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getReimbursement } from "~/modules/invoicing";
import {
  linesBalanceHeader,
  postReimbursement,
  REIMBURSEMENT_UNBALANCED_MESSAGE
} from "~/modules/invoicing/reimbursement.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { reimbursementId } = params;
  if (!reimbursementId) {
    return { success: false, message: "Missing reimbursement id" };
  }

  const reimbursement = await getReimbursement(
    client,
    companyId,
    reimbursementId
  );
  if (reimbursement.error || !reimbursement.data) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(reimbursement.error, "Failed to load reimbursement")
      )
    );
  }

  if (reimbursement.data.status !== "Draft") {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(
        request,
        error(null, "Only a Draft reimbursement can be posted")
      )
    );
  }

  // The totals guard, server-side, BEFORE the edge function is called.
  const lines = reimbursement.data.reimbursementLine ?? [];
  if (
    !linesBalanceHeader(
      Number(reimbursement.data.amount),
      lines.map((line) => Number(line.amount))
    )
  ) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(null, REIMBURSEMENT_UNBALANCED_MESSAGE))
    );
  }

  const result = await postReimbursement({
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
    await flash(request, success("Reimbursement posted"))
  );
}
