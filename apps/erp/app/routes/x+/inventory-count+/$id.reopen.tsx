import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getInventoryCount,
  updateInventoryCountStatus
} from "~/modules/inventory";
import { path } from "~/utils/path";

// Reopen (Pending -> Draft): unlocks the count for further edits before posting.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (header.data?.status !== "Pending") {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(null, "Only a pending count can be reopened"))
    );
  }

  const update = await updateInventoryCountStatus(client, {
    id,
    companyId,
    status: "Draft",
    expectedStatus: "Pending",
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(request, error(update.error, "Failed to reopen count"))
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Count reopened"))
  );
}
