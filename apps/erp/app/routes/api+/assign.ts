import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { assign } from "~/modules/shared/shared.server";
import type { notifyTask } from "~/trigger/notify";

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  let id = formData.get("id") as string;
  const assignee = formData.get("assignee") as string;
  const table = formData.get("table") as string;

  if (table && id) {
    const result = await assign(client, { table, id, assignee });

    if (result.error) {
      return json(
        { success: false },
        await flash(request, error(result.error, "Failed to assign"))
      );
    }

    if (table === "jobOperation") {
      const job = await client
        .from("jobOperation")
        .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
        .eq("id", id)
        .single();

      const jobId = job.data?.job?.id;
      const makeMethodId = job.data?.jobMakeMethod?.id;
      const materialId = job.data?.jobMakeMethod?.parentMaterialId;

      id = `${jobId}:${id}:${makeMethodId}:${materialId ?? ""}`;
    }

    if (assignee) {
      const notificationEvent = getNotificationEvent(table);
      if (notificationEvent) {
        try {
          await tasks.trigger<typeof notifyTask>("notify", {
            companyId,
            documentId: id,
            event: notificationEvent,
            recipient: {
              type: "user",
              userId: assignee,
            },
            from: userId,
          });
        } catch (err) {
          return json(
            {},
            await flash(request, error(err, "Failed to notify user"))
          );
        }
      }
    }

    return json({ success: true });
  } else {
    return json(
      { success: false },
      await flash(request, error(null, "Failed to assign"))
    );
  }
}

function getNotificationEvent(table: string): NotificationEvent | null {
  switch (table) {
    case "salesRfq":
      return NotificationEvent.SalesRfqAssignment;
    case "quote":
      return NotificationEvent.QuoteAssignment;
    case "salesOrder":
      return NotificationEvent.SalesOrderAssignment;
    case "job":
      return NotificationEvent.JobAssignment;
    case "jobOperation":
      return NotificationEvent.JobOperationAssignment;
    case "purchaseOrder":
      return NotificationEvent.PurchaseOrderAssignment;
    case "purchaseInvoice":
      return NotificationEvent.PurchaseInvoiceAssignment;
    case "supplierQuote":
      return NotificationEvent.SupplierQuoteAssignment;
    default:
      return null;
  }
}
