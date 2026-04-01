import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteItem } from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

function getFriendlyDeleteItemMessage(errorMessage?: string) {
  const message = errorMessage?.toLowerCase() ?? "";

  if (
    message.includes("violates foreign key constraint") &&
    message.includes("purchaseinvoiceline")
  ) {
    return "This part can't be deleted because it has linked purchase invoices. Delete or void related invoices first.";
  }

  if (message.includes("violates foreign key constraint")) {
    return "This item can't be deleted because it is linked to other records.";
  }

  return "Failed to delete item.";
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const deletion = await deleteItem(client, itemId);
  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.items,
      await flash(
        request,
        error(
          deletion.error,
          getFriendlyDeleteItemMessage(deletion.error.message)
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.items,
    await flash(request, success("Successfully deleted item"))
  );
}
