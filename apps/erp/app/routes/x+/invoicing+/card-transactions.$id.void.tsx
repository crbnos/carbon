import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { voidCardTransaction } from "~/modules/invoicing/invoicing.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });
  const { id } = params;
  if (!id) {
    return { success: false, message: "Missing card transaction id" };
  }

  // Shared with the invoicing_voidCardTransaction tool.
  const result = await voidCardTransaction({
    cardTransactionId: id,
    companyId,
    userId
  });
  if (result.error) {
    throw redirect(
      path.to.cardTransaction(id),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  throw redirect(
    path.to.cardTransaction(id),
    await flash(request, success("Card transaction voided"))
  );
}
