import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { stockTransferStatusType } from "~/modules/inventory";
import { transitionStockTransferStatus } from "~/modules/inventory/inventory-transitions.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get(
    "status"
  ) as (typeof stockTransferStatusType)[number];
  const acknowledged = formData.get("acknowledged") === "true";

  if (!status || !stockTransferStatusType.includes(status)) {
    throw redirect(
      requestReferrer(request) ?? path.to.stockTransfer(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  const result = await transitionStockTransferStatus(client, {
    id,
    companyId,
    userId,
    status,
    acknowledged,
    // Reopening a Completed stock transfer unlocks completed inventory moves.
    requireReopenPermission: async () => {
      await requirePermissions(request, { delete: "inventory" });
    }
  });

  if ("blocked" in result) {
    return {
      error: null,
      data: null,
      violations: result.blocked.violations,
      ruleNames: result.blocked.ruleNames
    };
  }
  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.stockTransfer(id),
      await flash(request, error(result.cause, result.error.message))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.stockTransfer(id),
    await flash(request, success("Updated stock transfer status"))
  );
}
