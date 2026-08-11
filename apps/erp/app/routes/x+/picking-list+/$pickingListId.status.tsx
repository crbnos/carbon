import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getUnresolvedPickingListLines,
  isPickingListLocked,
  pickingListStatusType,
  updatePickingListStatus
} from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { pickingListId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  let status = formData.get("status") as (typeof pickingListStatusType)[number];

  if (!status || !pickingListStatusType.includes(status)) {
    throw redirect(
      path.to.pickingList(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  // Reopening a closed (Completed/Cancelled) picking list requires the stronger
  // inventory `delete` permission — it unlocks completed inventory moves.
  const current = await client
    .from("pickingList")
    .select("status")
    .eq("id", id)
    .single();
  const isReopen =
    isPickingListLocked(current.data?.status) && !isPickingListLocked(status);
  if (isReopen) {
    await requirePermissions(request, { delete: "inventory" });
  }

  // Finishing must not silently complete a list with material still unpicked —
  // same policy the MES Finish enforces. 'error' blocks; 'warn' requires an
  // acknowledgement; any shortfall lands the list on Partial, not Completed.
  if (status === "Completed") {
    const [lineResult, settings] = await Promise.all([
      getUnresolvedPickingListLines(client, id, companyId),
      getCompanySettings(client, companyId)
    ]);

    if (lineResult.error) {
      throw redirect(
        path.to.pickingList(id),
        await flash(
          request,
          error(lineResult.error, "Failed to check picking list lines")
        )
      );
    }

    // Fail closed: an unreadable policy must not fall back to the bypassable
    // 'warn' default.
    if (settings.error || !settings.data) {
      throw redirect(
        path.to.pickingList(id),
        await flash(
          request,
          error(
            settings.error,
            "Failed to read the picking list completion policy"
          )
        )
      );
    }

    const policy =
      settings.data.incompletePickingListPolicy === "error" ? "error" : "warn";
    const { unresolved, hasShort } = lineResult;
    const acknowledged = formData.get("acknowledged") === "true";

    if (unresolved.length > 0) {
      if (policy === "error") {
        throw redirect(
          path.to.pickingList(id),
          await flash(
            request,
            error(
              null,
              `Can't finish — still unpicked: ${unresolved.map((l) => l.itemName).join(", ")}`
            )
          )
        );
      }
      if (!acknowledged) {
        return { needsAcknowledgement: true, unresolvedLines: unresolved };
      }
    }

    status = unresolved.length === 0 && !hasShort ? "Completed" : "Partial";
  }

  const update = await updatePickingListStatus(client, id, status, userId);

  if (update.error) {
    throw redirect(
      path.to.pickingList(id),
      await flash(
        request,
        error(update.error, "Failed to update picking list status")
      )
    );
  }

  throw redirect(
    path.to.pickingList(id),
    await flash(request, success("Updated picking list status"))
  );
}
