import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { getIssue, isIssueLocked } from "~/modules/quality";
import { issueAssociationValidator } from "~/modules/quality/quality.models";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "issue-association");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id: nonConformanceId } = params;
  if (!nonConformanceId) throw new Error("Could not find id");

  const { client: viewClient } = await requirePermissions(request, {
    view: "quality"
  });
  const issue = await getIssue(viewClient, nonConformanceId);
  await requireUnlocked({
    request,
    isLocked: isIssueLocked(issue.data?.status),
    redirectTo: path.to.issue(nonConformanceId),
    message: "Cannot modify a closed issue. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(issueAssociationValidator).validate(
    formData
  );

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const { type, id, lineId, quantity } = validation.data;

  switch (type) {
    case "items":
      const { error: itemError } = await client
        .from("nonConformanceItem")
        .insert({
          itemId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId,
          quantity: quantity ?? 0
        });

      if (itemError) {
        logger.error("Failed to create association", { error: itemError });
        return {
          success: false,
          message: "Failed to create issue item"
        };
      }
      break;

    case "customers":
      const { error: customerError } = await client
        .from("nonConformanceCustomer")
        .insert({
          customerId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (customerError) {
        logger.error("Failed to create association", { error: customerError });
        return {
          success: false,
          message: "Failed to create issue customer"
        };
      }
      break;
    case "suppliers":
      const { error: supplierError } = await client
        .from("nonConformanceSupplier")
        .insert({
          supplierId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (supplierError) {
        logger.error("Failed to create association", { error: supplierError });
        return {
          success: false,
          message: "Failed to create issue supplier"
        };
      }
      break;
    case "jobOperations":
      const job = await client
        .from("job")
        .select("id, jobId, itemId")
        .eq("id", id)
        .single();
      if (job.error) {
        logger.error("Failed to create association", { error: job.error });
        return {
          success: false,
          message: "Failed to create issue job operation"
        };
      }

      const jobOperation = await client
        .from("nonConformanceJobOperation")
        .insert({
          jobOperationId: lineId!,
          jobId: job.data?.id,
          jobReadableId: job.data?.jobId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (jobOperation.error) {
        logger.error("Failed to create association", {
          error: jobOperation.error
        });
        return {
          success: false,
          message: "Failed to create issue job operation"
        };
      }

      await autoLinkJobOperationContext(client, {
        nonConformanceId,
        companyId,
        userId,
        jobItemId: job.data?.itemId ?? null,
        jobOperationId: lineId!
      });
      break;
    case "purchaseOrderLines":
      const purchaseOrder = await client
        .from("purchaseOrder")
        .select("id, purchaseOrderId")
        .eq("id", id)
        .single();
      if (purchaseOrder.error) {
        logger.error("Failed to create association", {
          error: purchaseOrder.error
        });
        return {
          success: false,
          message: "Failed to create issue purchase order line"
        };
      }

      const purchaseOrderLine = await client
        .from("nonConformancePurchaseOrderLine")
        .insert({
          purchaseOrderLineId: lineId!,
          purchaseOrderId: purchaseOrder.data?.id,
          purchaseOrderReadableId: purchaseOrder.data?.purchaseOrderId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (purchaseOrderLine.error) {
        logger.error("Failed to create association", {
          error: purchaseOrderLine.error
        });
        return {
          success: false,
          message: "Failed to create issue purchase order line"
        };
      }
      break;
    case "salesOrderLines":
      const salesOrder = await client
        .from("salesOrder")
        .select("id, salesOrderId")
        .eq("id", id)
        .single();
      if (salesOrder.error) {
        logger.error("Failed to create association", {
          error: salesOrder.error
        });
        return {
          success: false,
          message: "Failed to create issue sales order line"
        };
      }

      const salesOrderLine = await client
        .from("nonConformanceSalesOrderLine")
        .insert({
          salesOrderLineId: lineId!,
          salesOrderId: salesOrder.data?.id,
          salesOrderReadableId: salesOrder.data?.salesOrderId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (salesOrderLine.error) {
        logger.error("Failed to create association", {
          error: salesOrderLine.error
        });
        return {
          success: false,
          message: "Failed to create issue sales order line"
        };
      }
      break;
    case "shipmentLines":
      const shipment = await client
        .from("shipment")
        .select("id, shipmentId")
        .eq("id", id)
        .single();
      if (shipment.error) {
        logger.error("Failed to create association", { error: shipment.error });
        return {
          success: false,
          message: "Failed to create issue shipment line"
        };
      }

      const shipmentLine = await client
        .from("nonConformanceShipmentLine")
        .insert({
          shipmentLineId: lineId!,
          shipmentId: shipment.data?.id,
          shipmentReadableId: shipment.data?.shipmentId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (shipmentLine.error) {
        logger.error("Failed to create association", {
          error: shipmentLine.error
        });
        return {
          success: false,
          message: "Failed to create issue shipment line"
        };
      }
      break;
    case "receiptLines":
      const receipt = await client
        .from("receipt")
        .select("id, receiptId")
        .eq("id", id)
        .single();
      if (receipt.error) {
        logger.error("Failed to create association", { error: receipt.error });
        return {
          success: false,
          message: "Failed to create issue receipt line"
        };
      }

      const receiptLine = await client
        .from("nonConformanceReceiptLine")
        .insert({
          receiptLineId: lineId!,
          receiptId: receipt.data?.id,
          receiptReadableId: receipt.data?.receiptId,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (receiptLine.error) {
        logger.error("Failed to create association", {
          error: receiptLine.error
        });
        return {
          success: false,
          message: "Failed to create issue receipt line"
        };
      }
      break;
    case "trackedEntities":
      const { error: trackedEntityError } = await client
        .from("nonConformanceTrackedEntity")
        .insert({
          trackedEntityId: id,
          nonConformanceId,
          createdBy: userId,
          companyId: companyId
        });

      if (trackedEntityError) {
        return {
          success: false,
          message: "Failed to create issue tracked entity"
        };
      }
      break;
    case "inboundInspections": {
      const inspection = await (client as any)
        .from("inboundInspection")
        .select(
          "id, itemId, lotSize, receiptLineId, inboundInspectionSample(trackedEntityId)"
        )
        .eq("id", id)
        .single();
      if (inspection.error) {
        logger.error("Failed to create association", {
          error: inspection.error
        });
        return {
          success: false,
          message: "Failed to create issue inbound inspection"
        };
      }

      const linkResult = await (client as any)
        .from("nonConformanceInboundInspection")
        .insert({
          nonConformanceId,
          inboundInspectionId: inspection.data.id,
          createdBy: userId,
          companyId: companyId
        });
      if (linkResult.error) {
        logger.error("Failed to create association", {
          error: linkResult.error
        });
        return {
          success: false,
          message: "Failed to create issue inbound inspection"
        };
      }

      const sampledIds = (
        (inspection.data.inboundInspectionSample ?? []) as {
          trackedEntityId: string;
        }[]
      )
        .map((s) => s.trackedEntityId)
        .filter(Boolean);
      // Pull the rest of the lot too — un-sampled entities are still part of
      // the lot the MRB needs to disposition.
      let lotEntityIds: string[] = sampledIds;
      if (inspection.data.receiptLineId) {
        const receiptLineEntities = await client
          .from("trackedEntity")
          .select("id")
          .eq("attributes ->> Receipt Line", inspection.data.receiptLineId)
          .eq("companyId", companyId);
        lotEntityIds = Array.from(
          new Set([
            ...sampledIds,
            ...((receiptLineEntities.data ?? []) as { id: string }[]).map(
              (r) => r.id
            )
          ])
        );
      }

      await autoLinkInboundInspectionContext(client, {
        nonConformanceId,
        companyId,
        userId,
        itemId: inspection.data.itemId ?? null,
        lotSize: Number(inspection.data.lotSize ?? 0),
        trackedEntityIds: lotEntityIds
      });
      break;
    }
  }

  return {
    success: true,
    message: "Association created"
  };
}

// Auto-linking helpers: these run after the primary association insert
// succeeds, so their failures are swallowed — they surface context into the
// issue explorer (items, tracked entities) but shouldn't block the user if a
// row already exists or a lookup misses.

async function autoLinkJobOperationContext(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    jobItemId: string | null;
    jobOperationId: string;
  }
) {
  const { nonConformanceId, companyId, userId, jobItemId, jobOperationId } =
    args;

  if (jobItemId) {
    await insertMissingItem(client, {
      nonConformanceId,
      companyId,
      userId,
      itemId: jobItemId,
      quantity: 0
    });
  }

  const operation = await client
    .from("jobOperation")
    .select("jobMakeMethodId")
    .eq("id", jobOperationId)
    .single();
  const jobMakeMethodId = operation.data?.jobMakeMethodId ?? null;
  if (!jobMakeMethodId) return;

  const entities = await client
    .from("trackedEntity")
    .select("id")
    .eq("attributes->>Job Make Method", jobMakeMethodId)
    .eq("companyId", companyId);

  const trackedEntityIds = (entities.data ?? []).map((e) => e.id);
  await insertMissingTrackedEntities(client, {
    nonConformanceId,
    companyId,
    userId,
    trackedEntityIds
  });
}

async function autoLinkInboundInspectionContext(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    itemId: string | null;
    lotSize: number;
    trackedEntityIds: string[];
  }
) {
  const {
    nonConformanceId,
    companyId,
    userId,
    itemId,
    lotSize,
    trackedEntityIds
  } = args;

  await insertMissingTrackedEntities(client, {
    nonConformanceId,
    companyId,
    userId,
    trackedEntityIds
  });

  if (!itemId) return;

  // Find or create the disposition row for this item. New rows start at qty 0;
  // we'll bump the qty below by the sum of newly-attached entity quantities
  // so nonConformanceItem.quantity stays in sync with sum(links.quantity) and
  // the closure validator's link-sum check is satisfied.
  const existing = await client
    .from("nonConformanceItem")
    .select("id, quantity")
    .eq("nonConformanceId", nonConformanceId)
    .eq("itemId", itemId)
    .maybeSingle();

  let itemRowId: string;
  let currentQty: number;
  if (existing.data) {
    itemRowId = existing.data.id as string;
    currentQty = Number(existing.data.quantity ?? 0);
  } else {
    const insert = await (client as any)
      .from("nonConformanceItem")
      .insert({
        itemId,
        nonConformanceId,
        createdBy: userId,
        companyId,
        quantity: 0
      })
      .select("id, quantity")
      .single();
    if (insert.error || !insert.data) {
      logger.error("Failed to create association", { error: insert.error });
      return;
    }
    itemRowId = insert.data.id as string;
    currentQty = Number(insert.data.quantity ?? 0);
  }

  if (trackedEntityIds.length === 0) {
    // No entities to link — leave the row at its current qty (or fall back to
    // the lot size for a freshly-created empty row, so the user sees something
    // meaningful in the disposition list).
    if (currentQty === 0 && lotSize > 0) {
      await client
        .from("nonConformanceItem")
        .update({
          quantity: lotSize,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .eq("id", itemRowId)
        .eq("companyId", companyId);
    }
    return;
  }

  // An entity may only appear on one disposition row per NCR (DB ncUnique
  // constraint) — skip anything that's already linked anywhere on this NCR.
  const alreadyLinked = await (client as any)
    .from("nonConformanceItemTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", trackedEntityIds);
  const alreadyLinkedSet = new Set(
    ((alreadyLinked.data ?? []) as { trackedEntityId: string }[]).map(
      (r) => r.trackedEntityId
    )
  );
  const toLink = trackedEntityIds.filter((id) => !alreadyLinkedSet.has(id));
  if (toLink.length === 0) return;

  const entityQuantities = await client
    .from("trackedEntity")
    .select("id, quantity")
    .in("id", toLink)
    .eq("companyId", companyId);
  const entityQtyById = new Map(
    (
      (entityQuantities.data ?? []) as { id: string; quantity: number | null }[]
    ).map((e) => [e.id, Number(e.quantity ?? 1)])
  );

  const linkRows = toLink.map((trackedEntityId) => ({
    nonConformanceItemId: itemRowId,
    trackedEntityId,
    quantity: entityQtyById.get(trackedEntityId) ?? 1,
    companyId,
    createdBy: userId
  }));
  const linkInsert = await (client as any)
    .from("nonConformanceItemTrackedEntity")
    .insert(linkRows);
  if (linkInsert.error) {
    logger.error("Failed to create association", { error: linkInsert.error });
    return;
  }

  const addedQty = linkRows.reduce((acc, r) => acc + r.quantity, 0);
  await client
    .from("nonConformanceItem")
    .update({
      quantity: currentQty + addedQty,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", itemRowId)
    .eq("companyId", companyId);
}

async function insertMissingItem(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    itemId: string;
    quantity: number;
  }
) {
  const { nonConformanceId, companyId, userId, itemId, quantity } = args;
  const existing = await client
    .from("nonConformanceItem")
    .select("id")
    .eq("nonConformanceId", nonConformanceId)
    .eq("itemId", itemId)
    .maybeSingle();
  if (existing.data) return;

  const result = await client.from("nonConformanceItem").insert({
    itemId,
    nonConformanceId,
    createdBy: userId,
    companyId,
    quantity
  });
  if (result.error)
    logger.error("Failed to create association", { error: result.error });
}

async function insertMissingTrackedEntities(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  args: {
    nonConformanceId: string;
    companyId: string;
    userId: string;
    trackedEntityIds: string[];
  }
) {
  const { nonConformanceId, companyId, userId, trackedEntityIds } = args;
  if (trackedEntityIds.length === 0) return;

  const existing = await client
    .from("nonConformanceTrackedEntity")
    .select("trackedEntityId")
    .eq("nonConformanceId", nonConformanceId)
    .in("trackedEntityId", trackedEntityIds);
  const already = new Set(
    (existing.data ?? []).map((r) => r.trackedEntityId as string)
  );

  const rows = trackedEntityIds
    .filter((teId) => !already.has(teId))
    .map((trackedEntityId) => ({
      nonConformanceId,
      trackedEntityId,
      createdBy: userId,
      companyId
    }));
  if (rows.length === 0) return;

  const result = await client.from("nonConformanceTrackedEntity").insert(rows);
  if (result.error)
    logger.error("Failed to create association", { error: result.error });
}
