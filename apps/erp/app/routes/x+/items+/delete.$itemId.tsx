import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteItem } from "~/modules/items";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const deletion = await deleteItem(client, itemId);
  if (deletion.error) {
    // Postgres FK violations leak schema names ("violates foreign key
    // constraint trackedEntity_itemId_fkey on table trackedEntity").
    // Map the known item FKs (tracked entities, and inventory/cost ledger
    // history) to clear, actionable messages and pass the rest through.
    const message = friendlyDeleteItemError(deletion.error);
    throw redirect(
      requestReferrer(request) ?? path.to.items,
      await flash(request, error(deletion.error, message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.items,
    await flash(request, success("Successfully deleted item"))
  );
}

function friendlyDeleteItemError(err: { code?: string; message?: string }) {
  if (err.code === "23503") {
    if (err.message?.includes("trackedEntity_itemId_fkey")) {
      return "Item has tracked entities linked to it and cannot be deleted. Deactivate the item instead.";
    }
    if (
      err.message?.includes("itemLedger_itemId_fkey") ||
      err.message?.includes("costLedger_itemId_fkey")
    ) {
      return "Item has inventory transactions or stock on hand and cannot be deleted. Deactivate the item instead.";
    }
    return "Item is still referenced by other records and cannot be deleted. Remove those references or deactivate the item instead.";
  }
  return err.message ?? "Failed to delete item";
}
