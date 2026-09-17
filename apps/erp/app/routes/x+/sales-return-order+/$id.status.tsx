import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  cancelSalesReturnOrder,
  reopenSalesReturnOrder
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const status = formData.get("status");

  // Status is derived from the lines (To Receive / Completed) — the only valid
  // manual transitions are Cancelled and Draft (reopen a to-receive return).
  if (status !== "Cancelled" && status !== "Draft") {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
      await flash(request, error(null, "Invalid status"))
    );
  }

  try {
    // Kysely transactions (row-locked against concurrent receipt posting) —
    // they THROW on a guard violation.
    if (status === "Cancelled") {
      await cancelSalesReturnOrder(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    } else {
      await reopenSalesReturnOrder(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    }
  } catch (err) {
    throw redirect(
      requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
      await flash(
        request,
        error(
          err,
          err instanceof Error ? err.message : "Failed to update status"
        )
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.salesReturnOrderDetails(id),
    await flash(
      request,
      success(
        status === "Cancelled"
          ? "Cancelled return order"
          : "Reopened return order"
      )
    )
  );
}
