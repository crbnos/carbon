import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { pickingListStatusType } from "~/modules/inventory";
import { transitionPickingListStatus } from "~/modules/inventory/inventory-transitions.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { pickingListId: id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof pickingListStatusType)[number];

  if (!status || !pickingListStatusType.includes(status)) {
    throw redirect(
      path.to.pickingList(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const result = await transitionPickingListStatus(client, {
    id,
    companyId,
    userId,
    status,
    acknowledged: formData.get("acknowledged") === "true",
    // Reopening a closed list unlocks completed inventory moves.
    requireReopenPermission: async () => {
      await requirePermissions(request, { delete: "inventory" });
    }
  });

  if ("needsAcknowledgement" in result) {
    return {
      needsAcknowledgement: true,
      unresolvedLines: result.unresolvedLines
    };
  }
  if (result.error) {
    throw redirect(
      path.to.pickingList(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    path.to.pickingList(id),
    await flash(request, success("Updated picking list status"))
  );
}
