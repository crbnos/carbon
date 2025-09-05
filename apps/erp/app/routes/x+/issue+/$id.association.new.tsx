import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { issueAssociationValidator } from "~/modules/quality/quality.models";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id: nonConformanceId } = params;
  if (!nonConformanceId) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(issueAssociationValidator).validate(
    formData
  );

  if (validation.error) {
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const { type, id, lineId } = validation.data;

  switch (type) {
    case "items":
      const { error: itemError } = await client
        .from("nonConformanceItem")
        .insert({
          itemId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (itemError) {
        return json({
          success: false,
          message: "Failed to create issue item",
        });
      }
      break;

    case "customers":
      const { error: customerError } = await client
        .from("nonConformanceCustomer")
        .insert({
          customerId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (customerError) {
        return json({
          success: false,
          message: "Failed to create issue customer",
        });
      }
      break;
    case "suppliers":
      const { error: supplierError } = await client
        .from("nonConformanceSupplier")
        .insert({
          supplierId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (supplierError) {
        return json({
          success: false,
          message: "Failed to create issue supplier",
        });
      }
      break;
    case "jobOperations":
      const job = await client
        .from("job")
        .select("id, jobId")
        .eq("id", id)
        .single();
      if (job.error) {
        console.error(job.error);
        return json({
          success: false,
          message: "Failed to create issue job operation",
        });
      }

      const jobOperation = await client
        .from("nonConformanceJobOperation")
        .insert({
          jobOperationId: lineId!,
          jobId: job.data?.id,
          jobReadableId: job.data?.jobId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (jobOperation.error) {
        console.error(jobOperation.error);
        return json({
          success: false,
          message: "Failed to create issue job operation",
        });
      }
      break;
    case "purchaseOrderLines":
      const purchaseOrder = await client
        .from("purchaseOrder")
        .select("id, purchaseOrderId")
        .eq("id", id)
        .single();
      if (purchaseOrder.error) {
        console.error(purchaseOrder.error);
        return json({
          success: false,
          message: "Failed to create issue purchase order line",
        });
      }

      const purchaseOrderLine = await client
        .from("nonConformancePurchaseOrderLine")
        .insert({
          purchaseOrderLineId: lineId!,
          purchaseOrderId: purchaseOrder.data?.id,
          purchaseOrderReadableId: purchaseOrder.data?.purchaseOrderId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (purchaseOrderLine.error) {
        console.error(purchaseOrderLine.error);
        return json({
          success: false,
          message: "Failed to create issue purchase order line",
        });
      }
      break;
    case "salesOrderLines":
      const salesOrder = await client
        .from("salesOrder")
        .select("id, salesOrderId")
        .eq("id", id)
        .single();
      if (salesOrder.error) {
        console.error(salesOrder.error);
        return json({
          success: false,
          message: "Failed to create issue sales order line",
        });
      }

      const salesOrderLine = await client
        .from("nonConformanceSalesOrderLine")
        .insert({
          salesOrderLineId: lineId!,
          salesOrderId: salesOrder.data?.id,
          salesOrderReadableId: salesOrder.data?.salesOrderId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (salesOrderLine.error) {
        console.error(salesOrderLine.error);
        return json({
          success: false,
          message: "Failed to create issue sales order line",
        });
      }
      break;
    case "shipmentLines":
      const shipment = await client
        .from("shipment")
        .select("id, shipmentId")
        .eq("id", id)
        .single();
      if (shipment.error) {
        console.error(shipment.error);
        return json({
          success: false,
          message: "Failed to create issue shipment line",
        });
      }

      const shipmentLine = await client
        .from("nonConformanceShipmentLine")
        .insert({
          shipmentLineId: lineId!,
          shipmentId: shipment.data?.id,
          shipmentReadableId: shipment.data?.shipmentId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (shipmentLine.error) {
        console.error(shipmentLine.error);
        return json({
          success: false,
          message: "Failed to create issue shipment line",
        });
      }
      break;
    case "receiptLines":
      const receipt = await client
        .from("receipt")
        .select("id, receiptId")
        .eq("id", id)
        .single();
      if (receipt.error) {
        console.error(receipt.error);
        return json({
          success: false,
          message: "Failed to create issue receipt line",
        });
      }

      const receiptLine = await client
        .from("nonConformanceReceiptLine")
        .insert({
          receiptLineId: lineId!,
          receiptId: receipt.data?.id,
          receiptReadableId: receipt.data?.receiptId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (receiptLine.error) {
        console.error(receiptLine.error);
        return json({
          success: false,
          message: "Failed to create issue receipt line",
        });
      }
      break;
    case "trackedEntities":
      const { error: trackedEntityError } = await client
        .from("nonConformanceTrackedEntity")
        .insert({
          trackedEntityId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
        });

      if (trackedEntityError) {
        return json({
          success: false,
          message: "Failed to create issue tracked entity",
        });
      }
      break;
  }

  return json({
    success: true,
    message: "Association created",
  });
}
