import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk";
import { type ActionFunctionArgs, data } from "react-router";
import { assign } from "~/modules/shared/shared.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  let id: string | undefined = formData.get("id") as string;
  const assignee = formData.get("assignee") as string;
  const table = formData.get("table") as string;

  if (table && id) {
    const result = await assign(client, { table, id, assignee });

    if (result.error) {
      return data(
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

    if (
      table === "nonConformanceActionTask" ||
      table === "nonConformanceApprovalTask"
    ) {
      const task = await client
        .from(table)
        .select("nonConformanceId")
        .eq("id", id)
        .single();

      id = task.data?.nonConformanceId;
    }

    if (id && assignee) {
      const notificationEvent = getNotificationEvent(table);
      if (notificationEvent) {
        try {
          await tasks.trigger("notify", {
            companyId,
            documentId: id,
            event: notificationEvent,
            recipient: {
              type: "user",
              userId: assignee
            },
            from: userId
          });
        } catch (err) {
          return data(
            {},
            await flash(request, error(err, "Failed to notify user"))
          );
        }
      }
    }

    return { success: true };
  } else {
    return data(
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
    case "jobCompleted":
      return NotificationEvent.JobCompleted;
    case "jobOperation":
      return NotificationEvent.JobOperationAssignment;
    case "maintenanceDispatch":
      return NotificationEvent.MaintenanceDispatchAssignment;
    case "nonConformanceInvestigationTask":
    case "nonConformanceActionTask":
    case "nonConformanceApprovalTask":
    case "nonConformance":
      return NotificationEvent.NonConformanceAssignment;
    case "procedure":
      return NotificationEvent.ProcedureAssignment;
    case "purchaseOrder":
      return NotificationEvent.PurchaseOrderAssignment;
    case "purchaseInvoice":
      return NotificationEvent.PurchaseInvoiceAssignment;
    case "riskRegister":
      return NotificationEvent.RiskAssignment;
    case "supplierQuote":
      return NotificationEvent.SupplierQuoteAssignment;
    case "stockTransfer":
      return NotificationEvent.StockTransferAssignment;
    case "trainingAssignment":
      return NotificationEvent.TrainingAssignment;
    default:
      return null;
  }
}
