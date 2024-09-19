import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteReceipt, getReceipt } from "~/modules/inventory";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
        error(deleteReceiptError, "Failed to delete receipt")
      )
    );
  }

  throw redirect(
    path.to.receipts,
    await flash(request, success("Successfully deleted receipt"))
  );
}
