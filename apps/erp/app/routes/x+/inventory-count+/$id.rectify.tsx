import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getInventoryCount, rectifyInventoryCount } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Rectify (Posted -> Draft): reopen a posted count in place to fix wrong counted
// quantities, then re-post. `rectifyInventoryCount` does the whole thing in ONE
// transaction — lock the row, verify it is still Posted, re-baseline each line's
// system quantity to current live on-hand (so the reopened count starts
// drift-free and unchanged lines post nothing), and flip to Draft — so a failure
// or concurrent request can't leave it re-snapshotted-but-still-Posted.
// Re-posting later writes a new adjustment for each changed line, linked to its
// original movement (`itemLedger.correctionOfItemLedgerId`), so both stay visible
// in Stock Movements. The original posted movements are never mutated.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const header = await getInventoryCount(client, id, companyId);
  if (!header.data) {
    throw redirect(
      path.to.inventoryCounts,
      await flash(
        request,
        error(header.error, "Failed to load inventory count")
      )
    );
  }

  try {
    await rectifyInventoryCount(getDatabaseClient(), {
      inventoryCountId: id,
      companyId,
      locationId: header.data.locationId,
      updatedBy: userId
    });
  } catch (err) {
    throw redirect(
      path.to.inventoryCount(id),
      await flash(
        request,
        error(err, "Failed to reopen count for rectification")
      )
    );
  }

  throw redirect(
    path.to.inventoryCount(id),
    await flash(request, success("Count reopened for rectification"))
  );
}
