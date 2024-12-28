import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteReceipt, getReceipt } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { receiptId } = params;
  if (!receiptId) {
    throw redirect(
      path.to.receipts,
      await flash(request, error(params, "Failed to get an receipt id"))
    );
  }

  // make sure the receipt has not been posted
  const { error: getReceiptError, data: receipt } = await getReceipt(
    client,
    receiptId
  );
  if (getReceiptError) {
    throw redirect(
      path.to.receipts,
      await flash(request, error(getReceiptError, "Failed to get receipt"))
    );
  }

  if (receipt?.postingDate) {
    throw redirect(
      path.to.receipts,
      await flash(
        request,
        error(getReceiptError, "Cannot delete a posted receipt")
      )
    );
  }

  const { error: deleteReceiptError } = await deleteReceipt(client, receiptId);
  if (deleteReceiptError) {
    throw redirect(
      path.to.receipts,
      await flash(
        request,
        error(deleteReceiptError, deleteReceiptError.message)
      )
    );
  }

  throw redirect(
    path.to.receipts,
    await flash(request, success("Successfully deleted receipt"))
  );
}
