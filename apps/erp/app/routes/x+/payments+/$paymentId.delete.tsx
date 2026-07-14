import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deletePayment } from "~/modules/invoicing";
import { path } from "~/utils/path";

// Action-only route — the delete confirmation modal (ConfirmDelete) posts here.
// The payment table's RLS DELETE policy restricts deletes to Draft payments, so
// a non-draft delete fails at the database; the UI also hides the action.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "invoicing"
  });

  const { paymentId } = params;
  if (!paymentId) {
    throw redirect(
      path.to.payments,
      await flash(request, error(params, "Failed to get a payment id"))
    );
  }

  const remove = await deletePayment(client, paymentId);
  if (remove.error) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(remove.error, "Failed to delete payment"))
    );
  }

  throw redirect(
    path.to.payments,
    await flash(request, success("Successfully deleted payment"))
  );
}
