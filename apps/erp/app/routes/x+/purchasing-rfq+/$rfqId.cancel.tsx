import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getLinkedSupplierQuotes,
  updatePurchasingRFQStatus,
  updateSupplierQuoteStatus
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { rfqId: id } = params;
  if (!id) throw new Error("Could not find id");

  const update = await updatePurchasingRFQStatus(client, {
    id,
    status: "Closed",
    assignee: null,
    updatedBy: userId
  });

  if (update.error) {
    throw redirect(
      path.to.purchasingRfqDetails(id),
      await flash(request, error(update.error, "Failed to cancel RFQ"))
    );
  }

  const linkedQuotes = await getLinkedSupplierQuotes(client, id);
  if (!linkedQuotes.error && linkedQuotes.data) {
    await Promise.all(
      linkedQuotes.data.map((link) =>
        updateSupplierQuoteStatus(client, {
          id: link.supplierQuoteId,
          status: "Cancelled",
          assignee: undefined,
          updatedBy: userId
        })
      )
    );
  }

  throw redirect(
    path.to.purchasingRfqDetails(id),
    await flash(request, success("RFQ cancelled"))
  );
}
