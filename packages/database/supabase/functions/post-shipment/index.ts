import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database, Json } from "../lib/types.ts";
import { TrackedEntityAttributes } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  shipmentId: z.string(),
  userId: z.string(),
  companyId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const today = format(new Date(), "yyyy-MM-dd");

  try {
    const { shipmentId, userId, companyId } = payloadValidator.parse(payload);

    console.log({
      function: "post-shipment",
      shipmentId,
      userId,
      companyId,
    });

    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key") ?? "",
      companyId
    );

    const [shipment, shipmentLines, shipmentLineTracking] = await Promise.all([
      client.from("shipment").select("*").eq("id", shipmentId).single(),
      client
        .from("shipmentLine")
        .select("*, fulfillment(*)")
        .eq("shipmentId", shipmentId),
      client
        .from("trackedEntity")
        .select("*")
        .eq("attributes->> Shipment", shipmentId),
    ]);

    if (shipment.error) throw new Error("Failed to fetch shipment");
    if (shipmentLines.error) throw new Error("Failed to fetch shipment lines");

    const itemIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (shipmentLine.itemId && !acc.includes(shipmentLine.itemId)) {
        acc.push(shipmentLine.itemId);
      }
      return acc;
    }, []);

    const jobIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (
        shipmentLine.fulfillment?.jobId &&
        !acc.includes(shipmentLine.fulfillment?.jobId)
      ) {
        acc.push(shipmentLine.fulfillment?.jobId);
      }
      return acc;
    }, []);

    const [items, itemCosts, jobs] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
      client
        .from("job")
        .select("id, quantity, quantityComplete, quantityShipped, status")
        .in("id", jobIds),
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
    }
    if (jobs.error) {
      throw new Error("Failed to fetch jobs");
    }

    switch (shipment.data?.sourceDocument) {
      case "Sales Order": {
        if (!shipment.data.sourceDocumentId)
          throw new Error("Shipment has no sourceDocumentId");

        const [salesOrder, salesOrderLines, salesOrderDelivery] =
          await Promise.all([
            client
              .from("salesOrder")
              .select("*")
              .eq("id", shipment.data.sourceDocumentId)
              .single(),
            client
              .from("salesOrderLine")
              .select("*")
              .eq("salesOrderId", shipment.data.sourceDocumentId),
            client
              .from("salesOrderShipment")
              .select("shippingCost")
              .eq("id", shipment.data.sourceDocumentId)
              .single(),
          ]);
        if (salesOrder.error) throw new Error("Failed to fetch purchase order");
        if (salesOrderLines.error)
          throw new Error("Failed to fetch sales order lines");
        if (salesOrderDelivery.error)
          throw new Error("Failed to fetch sales order delivery");

        const customer = await client
          .from("customer")
          .select("*")
          .eq("id", salesOrder.data.customerId)
          .eq("companyId", companyId)
          .single();
        if (customer.error) throw new Error("Failed to fetch customer");

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];

        const jobUpdates: Record<
          string,
          Database["public"]["Tables"]["job"]["Update"]
        > = {};

        const serialNumbersConsumed: string[] = [];

        const locationId = shipment.data.locationId;
        for await (const shipmentLine of shipmentLines.data) {
          if (
            shipmentLine.fulfillment?.type === "Job" &&
            shipmentLine.fulfillment?.jobId
          ) {
            // Update quantity shipped on job, accumulating totals from multiple shipments
            const jobId = shipmentLine.fulfillment.jobId;
            const currentJob = jobs.data.find((j) => j.id === jobId);

            // Log job and shipment line data to debug NaN issues
            console.log("Processing job update:", {
              jobId,
              currentJob: currentJob
                ? {
                    id: currentJob.id,
                    quantity: currentJob.quantity,
                    quantityShipped: currentJob.quantityShipped,
                    quantityComplete: currentJob.quantityComplete,
                    status: currentJob.status,
                  }
                : null,
              shipmentLine: {
                id: shipmentLine.id,
                shippedQuantity: shipmentLine.shippedQuantity,
                shippedQuantityType: typeof shipmentLine.shippedQuantity,
              },
            });

            const currentQuantityShipped = currentJob?.quantityShipped ?? 0;

            // Ensure shippedQuantity is a valid number to prevent "100NaN" errors
            const shippedQuantity =
              typeof shipmentLine.shippedQuantity === "number" &&
              !isNaN(shipmentLine.shippedQuantity)
                ? shipmentLine.shippedQuantity
                : 0;

            console.log("Calculated values:", {
              currentQuantityShipped,
              shippedQuantity,
              newTotal: currentQuantityShipped + shippedQuantity,
              jobQuantity: currentJob?.quantity,
            });

            // If we've already updated this job in this transaction, use that as the base
            // instead of the current DB value to avoid double counting
            if (jobUpdates[jobId]) {
              const newQuantityShipped =
                (jobUpdates[jobId]?.quantityShipped ?? 0) + shippedQuantity;
              const newQuantityComplete =
                currentJob?.status === "Completed"
                  ? currentJob?.quantityComplete
                  : (currentJob?.quantityComplete ?? 0) + shippedQuantity;
              const newStatus =
                currentQuantityShipped + shippedQuantity >=
                (currentJob?.quantity ?? 0)
                  ? "Completed"
                  : currentJob?.status;

              console.log("Updating existing job update:", {
                jobId,
                previousUpdate: jobUpdates[jobId],
                newUpdate: {
                  status: newStatus,
                  quantityComplete: newQuantityComplete,
                  quantityShipped: newQuantityShipped,
                },
              });

              jobUpdates[jobId] = {
                status: newStatus,
                quantityComplete: newQuantityComplete,
                quantityShipped: newQuantityShipped,
              };
            } else {
              const newQuantityShipped =
                currentQuantityShipped + shippedQuantity;
              const newQuantityComplete =
                currentJob?.status === "Completed"
                  ? currentJob?.quantityComplete
                  : (currentJob?.quantityComplete ?? 0) + shippedQuantity;
              const newStatus =
                currentQuantityShipped + shippedQuantity >=
                (currentJob?.quantity ?? 0)
                  ? "Completed"
                  : currentJob?.status;

              console.log("Creating new job update:", {
                jobId,
                update: {
                  status: newStatus,
                  quantityComplete: newQuantityComplete,
                  quantityShipped: newQuantityShipped,
                },
              });

              jobUpdates[jobId] = {
                status: newStatus,
                quantityComplete: newQuantityComplete,
                quantityShipped: newQuantityShipped,
              };
            }
            continue;
          }

          const itemTrackingType =
            items.data.find((item) => item.id === shipmentLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          // Default shippedQuantity to 0 if not defined
          const shippedQuantity = shipmentLine.shippedQuantity ?? 0;

          if (itemTrackingType === "Inventory") {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              quantity: -shippedQuantity,
              locationId: shipmentLine.locationId ?? locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: shipment.data?.id ?? undefined,
              externalDocumentId: undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (shipmentLine.requiresBatchTracking) {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              quantity: -shippedQuantity,
              locationId: shipmentLine.locationId ?? locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: shipment.data?.id ?? undefined,
              trackedEntityId: shipmentLineTracking.data?.find(
                (tracking) =>
                  (
                    tracking.attributes as TrackedEntityAttributes | undefined
                  )?.["Shipment Line"] === shipmentLine.id
              )?.id,
              externalDocumentId: undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (shipmentLine.requiresSerialTracking) {
            const lineTracking = shipmentLineTracking.data?.filter(
              (tracking) =>
                (tracking.attributes as TrackedEntityAttributes | undefined)?.[
                  "Shipment Line"
                ] === shipmentLine.id
            );

            lineTracking?.forEach((tracking) => {
              itemLedgerInserts.push({
                postingDate: today,
                itemId: shipmentLine.itemId,
                quantity: -1,
                locationId: shipmentLine.locationId ?? locationId,
                shelfId: shipmentLine.shelfId,
                entryType: "Negative Adjmt.",
                documentType: "Sales Shipment",
                documentId: shipment.data?.id ?? undefined,
                trackedEntityId: tracking.id,
                externalDocumentId: undefined,
                createdBy: userId,
                companyId,
              });

              if (tracking.id) {
                serialNumbersConsumed.push(tracking.id);
              }
            });
          }
        }

        const shipmentLinesBySalesOrderLineId = shipmentLines.data.reduce<
          Record<string, Database["public"]["Tables"]["shipmentLine"]["Row"][]>
        >((acc, shipmentLine) => {
          if (shipmentLine.lineId) {
            acc[shipmentLine.lineId] = [
              ...(acc[shipmentLine.lineId] ?? []),
              shipmentLine,
            ];
          }
          return acc;
        }, {});

        const salesOrderLineUpdates = salesOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["salesOrderLine"]["Update"]
          >
        >((acc, salesOrderLine) => {
          const shipmentLines =
            shipmentLinesBySalesOrderLineId[salesOrderLine.id];
          if (
            shipmentLines &&
            shipmentLines.length > 0 &&
            salesOrderLine.saleQuantity &&
            salesOrderLine.saleQuantity > 0
          ) {
            const shippedQuantity = shipmentLines.reduce(
              (acc, shipmentLine) => {
                return acc + (shipmentLine.shippedQuantity ?? 0);
              },
              0
            );

            const newQuantitySent =
              (salesOrderLine.quantitySent ?? 0) + shippedQuantity;

            const sentComplete =
              salesOrderLine.sentComplete ||
              newQuantitySent >= salesOrderLine.saleQuantity;

            const updates: Record<
              string,
              Database["public"]["Tables"]["salesOrderLine"]["Update"]
            > = {
              ...acc,
              [salesOrderLine.id]: {
                quantitySent: newQuantitySent,
                sentComplete,
              },
            };

            if (sentComplete && !salesOrderLine.sentDate) {
              updates[salesOrderLine.id].sentDate = today;
            }

            return updates;
          }

          return acc;
        }, {});

        const trackedEntitySplits: Record<
          string,
          {
            originalEntityId: string;
            originalQuantity: number;
            shippedQuantity: number;
            remainingQuantity: number;
            attributes: TrackedEntityAttributes;
            sourceDocument: string;
            sourceDocumentId: string;
            sourceDocumentReadableId: string | null;
            companyId: string;
          }
        > = {};

        const trackedEntityUpdates =
          shipmentLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, trackedEntity) => {
            const shipmentLine = shipmentLines.data?.find(
              (shipmentLine) =>
                shipmentLine.id ===
                (trackedEntity.attributes as TrackedEntityAttributes)?.[
                  "Shipment Line"
                ]
            );

            if (
              shipmentLine?.shippedQuantity !== undefined &&
              trackedEntity.quantity !== undefined &&
              shipmentLine.shippedQuantity < trackedEntity.quantity
            ) {
              // Need to split the batch
              trackedEntitySplits[trackedEntity.id] = {
                originalEntityId: trackedEntity.id,
                originalQuantity: trackedEntity.quantity,
                shippedQuantity: shipmentLine.shippedQuantity,
                remainingQuantity:
                  trackedEntity.quantity - shipmentLine.shippedQuantity,
                attributes: trackedEntity.attributes as TrackedEntityAttributes,
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                companyId: trackedEntity.companyId,
              };
            }

            acc[trackedEntity.id] = {
              status: "Consumed",
              quantity: shipmentLine?.shippedQuantity ?? trackedEntity.quantity,
            };

            return acc;
          }, {}) ?? {};

        await db.transaction().execute(async (trx) => {
          for await (const [salesOrderLineId, update] of Object.entries(
            salesOrderLineUpdates
          )) {
            await trx
              .updateTable("salesOrderLine")
              .set(update)
              .where("id", "=", salesOrderLineId)
              .execute();
          }

          const salesOrderLines = await trx
            .selectFrom("salesOrderLine")
            .select([
              "id",
              "salesOrderLineType",
              "invoicedComplete",
              "sentComplete",
            ])
            .where("salesOrderId", "=", salesOrder.data.id)
            .execute();

          const areAllLinesInvoiced = salesOrderLines.every(
            (line) =>
              line.salesOrderLineType === "Comment" || line.invoicedComplete
          );

          const areAllLinesShipped = salesOrderLines.every(
            (line) => line.salesOrderLineType === "Comment" || line.sentComplete
          );

          let status: Database["public"]["Tables"]["salesOrder"]["Row"]["status"] =
            "To Ship and Invoice";
          if (areAllLinesInvoiced && areAllLinesShipped) {
            status = "Completed";
          } else if (areAllLinesShipped) {
            status = "To Invoice";
          } else if (areAllLinesInvoiced) {
            status = "To Ship";
          }

          await trx
            .updateTable("salesOrder")
            .set({
              status,
            })
            .where("id", "=", salesOrder.data.id)
            .execute();

          await trx
            .updateTable("shipment")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", shipmentId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Shipment",
                sourceDocument: "Shipment",
                sourceDocumentId: shipmentId,
                sourceDocumentReadableId: shipment.data.shipmentId,
                attributes: {
                  Shipment: shipmentId,
                  "Sales Order": salesOrder.data.id,
                },
                companyId,
                createdBy: userId,
                createdAt: today,
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0].id;

            // Handle batch splits first
            for await (const splitInfo of Object.values(trackedEntitySplits)) {
              // Create a split activity
              const splitActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Split",
                  sourceDocument: "Shipment",
                  sourceDocumentId: shipmentId,
                  sourceDocumentReadableId: shipment.data.shipmentId,
                  attributes: {
                    "Original Quantity": splitInfo.originalQuantity,
                    "Shipped Quantity": splitInfo.shippedQuantity,
                    "Remaining Quantity": splitInfo.remainingQuantity,
                  },
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .returning(["id"])
                .execute();

              const splitActivityId = splitActivity[0].id!;

              // Record the original entity as input to the split
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: splitInfo.originalEntityId,
                  quantity: splitInfo.originalQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();

              // Create a new tracked entity for the remaining quantity
              const newTrackedEntity = await trx
                .insertInto("trackedEntity")
                .values({
                  quantity: splitInfo.remainingQuantity,
                  status: "Available",
                  sourceDocument: splitInfo.sourceDocument,
                  sourceDocumentId: splitInfo.sourceDocumentId,
                  sourceDocumentReadableId: splitInfo.sourceDocumentReadableId,
                  attributes: splitInfo.attributes as unknown as Json,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .returning(["id"])
                .execute();

              const newTrackedEntityId = newTrackedEntity[0].id!;

              // Update the original entity's attributes to include the split entity ID
              const originalEntity = await trx
                .selectFrom("trackedEntity")
                .select(["attributes"])
                .where("id", "=", splitInfo.originalEntityId)
                .executeTakeFirst();

              if (originalEntity) {
                const updatedAttributes = {
                  ...((originalEntity.attributes as TrackedEntityAttributes) ||
                    {}),
                  "Split Entity ID": newTrackedEntityId,
                };

                // Remove Shipment and Shipment Line attributes from the new entity
                const updatedAttributesObj = {
                  ...((originalEntity.attributes as TrackedEntityAttributes) ||
                    {}),
                };

                // Delete shipment-related attributes
                delete updatedAttributesObj["Shipment"];
                delete updatedAttributesObj["Shipment Line"];
                delete updatedAttributesObj["Shipment Line Index"];

                // Add the split entity reference
                updatedAttributesObj["Split Entity ID"] = newTrackedEntityId;

                // Update the original entity with the reference to the new split entity
                await trx
                  .updateTable("trackedEntity")
                  .set({
                    attributes: updatedAttributes,
                  })
                  .where("id", "=", splitInfo.originalEntityId)
                  .execute();
              }

              // Record the new entity as output from the split
              await trx
                .insertInto("trackedActivityOutput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: newTrackedEntityId,
                  quantity: splitInfo.remainingQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();

              // Record the shipped portion as output (will be consumed by shipment)
              await trx
                .insertInto("trackedActivityOutput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: splitInfo.originalEntityId,
                  quantity: splitInfo.shippedQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();

              itemLedgerInserts.push({
                postingDate: today,
                itemId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.itemId!,
                quantity: -splitInfo.originalQuantity,
                locationId: locationId,
                shelfId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.shelfId,
                entryType: "Negative Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId: splitInfo.originalEntityId,
                createdBy: userId,
                companyId,
              });

              itemLedgerInserts.push({
                postingDate: today,
                itemId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.itemId!,
                quantity: splitInfo.shippedQuantity,
                locationId: locationId,
                shelfId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.shelfId,
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId: splitInfo.originalEntityId,
                createdBy: userId,
                companyId,
              });

              itemLedgerInserts.push({
                postingDate: today,
                itemId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.itemId!,
                quantity: splitInfo.remainingQuantity,
                locationId: locationId,
                shelfId: shipmentLines.data.find(
                  (sl) =>
                    sl.id ===
                    (splitInfo.attributes as TrackedEntityAttributes)?.[
                      "Shipment Line"
                    ]
                )?.shelfId,
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId: newTrackedEntityId,
                createdBy: userId,
                companyId,
              });
            }

            // Now handle the shipment consumption
            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .execute();
              }
            }
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          if (Object.keys(jobUpdates).length > 0) {
            console.log("Final job updates to be applied:", jobUpdates);
            for await (const [jobId, update] of Object.entries(jobUpdates)) {
              console.log(`Updating job ${jobId} with:`, update);
              await trx
                .updateTable("job")
                .set(update)
                .where("id", "=", jobId)
                .execute();
            }
          }
        });
        break;
      }
      case "Purchase Order": {
        if (!shipment.data.sourceDocumentId)
          throw new Error("Shipment has no sourceDocumentId");

        const [purchaseOrder, purchaseOrderLines] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", shipment.data.sourceDocumentId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", shipment.data.sourceDocumentId),
        ]);
        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchase order");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");

        const supplier = await client
          .from("supplier")
          .select("*")
          .eq("id", purchaseOrder.data.supplierId)
          .eq("companyId", companyId)
          .single();
        if (supplier.error) throw new Error("Failed to fetch supplier");

        const jobOperationsUpdates: Record<
          string,
          Database["public"]["Tables"]["jobOperation"]["Update"]
        > = {};

        for await (const shipmentLine of shipmentLines.data) {
          const purchaseOrderLine = purchaseOrderLines.data.find(
            (pol) => pol.id === shipmentLine.lineId
          );

          if (purchaseOrderLine?.jobId && purchaseOrderLine.jobOperationId) {
            // Update quantity shipped on job, accumulating totals from multiple shipments
            const jobOperationId = purchaseOrderLine.jobOperationId;

            jobOperationsUpdates[jobOperationId] = {
              status: "In Progress",
            };
            continue;
          }
        }

        const shipmentLinesByPurchaseOrderLineId = shipmentLines.data.reduce<
          Record<string, Database["public"]["Tables"]["shipmentLine"]["Row"][]>
        >((acc, shipmentLine) => {
          if (shipmentLine.lineId) {
            acc[shipmentLine.lineId] = [
              ...(acc[shipmentLine.lineId] ?? []),
              shipmentLine,
            ];
          }
          return acc;
        }, {});

        const purchaseOrderLineUpdates = purchaseOrderLines.data.reduce<
          Record<
            string,
            Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
          >
        >((acc, purchaseOrderLine) => {
          const shipmentLines =
            shipmentLinesByPurchaseOrderLineId[purchaseOrderLine.id];
          if (
            shipmentLines &&
            shipmentLines.length > 0 &&
            purchaseOrderLine.purchaseQuantity &&
            purchaseOrderLine.purchaseQuantity > 0
          ) {
            const shippedQuantity = shipmentLines.reduce(
              (acc, shipmentLine) => {
                return acc + (shipmentLine.shippedQuantity ?? 0);
              },
              0
            );

            const newQuantityShipped =
              (purchaseOrderLine.quantityShipped ?? 0) + shippedQuantity;

            const updates: Record<
              string,
              Database["public"]["Tables"]["purchaseOrderLine"]["Update"]
            > = {
              ...acc,
              [purchaseOrderLine.id]: {
                quantityShipped: newQuantityShipped,
              },
            };

            return updates;
          }

          return acc;
        }, {});

        const trackedEntitySplits: Record<
          string,
          {
            originalEntityId: string;
            originalQuantity: number;
            shippedQuantity: number;
            remainingQuantity: number;
            attributes: TrackedEntityAttributes;
            sourceDocument: string;
            sourceDocumentId: string;
            sourceDocumentReadableId: string | null;
            companyId: string;
          }
        > = {};

        const trackedEntityUpdates =
          shipmentLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, trackedEntity) => {
            const shipmentLine = shipmentLines.data?.find(
              (shipmentLine) =>
                shipmentLine.id ===
                (trackedEntity.attributes as TrackedEntityAttributes)?.[
                  "Shipment Line"
                ]
            );

            if (
              shipmentLine?.shippedQuantity !== undefined &&
              trackedEntity.quantity !== undefined &&
              shipmentLine.shippedQuantity < trackedEntity.quantity
            ) {
              // Need to split the batch
              trackedEntitySplits[trackedEntity.id] = {
                originalEntityId: trackedEntity.id,
                originalQuantity: trackedEntity.quantity,
                shippedQuantity: shipmentLine.shippedQuantity,
                remainingQuantity:
                  trackedEntity.quantity - shipmentLine.shippedQuantity,
                attributes: trackedEntity.attributes as TrackedEntityAttributes,
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                companyId: trackedEntity.companyId,
              };
            }

            acc[trackedEntity.id] = {
              quantity: shipmentLine?.shippedQuantity ?? trackedEntity.quantity,
            };

            return acc;
          }, {}) ?? {};

        await db.transaction().execute(async (trx) => {
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdates
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .execute();
          }

          await trx
            .updateTable("shipment")
            .set({
              status: "Posted",
              postingDate: today,
              postedBy: userId,
            })
            .where("id", "=", shipmentId)
            .execute();

          if (Object.keys(trackedEntityUpdates).length > 0) {
            const trackedActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Shipment",
                sourceDocument: "Shipment",
                sourceDocumentId: shipmentId,
                sourceDocumentReadableId: shipment.data.shipmentId,
                attributes: {
                  Shipment: shipmentId,
                  "Purchase Order": purchaseOrder.data.id,
                },
                companyId,
                createdBy: userId,
                createdAt: today,
              })
              .returning(["id"])
              .execute();

            const trackedActivityId = trackedActivity[0].id;

            // Handle batch splits first
            for await (const splitInfo of Object.values(trackedEntitySplits)) {
              // Create a split activity
              const splitActivity = await trx
                .insertInto("trackedActivity")
                .values({
                  type: "Split",
                  sourceDocument: "Shipment",
                  sourceDocumentId: shipmentId,
                  sourceDocumentReadableId: shipment.data.shipmentId,
                  attributes: {
                    "Original Quantity": splitInfo.originalQuantity,
                    "Shipped Quantity": splitInfo.shippedQuantity,
                    "Remaining Quantity": splitInfo.remainingQuantity,
                  },
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .returning(["id"])
                .execute();

              const splitActivityId = splitActivity[0].id!;

              // Record the original entity as input to the split
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: splitInfo.originalEntityId,
                  quantity: splitInfo.originalQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();

              // Create a new tracked entity for the remaining quantity
              const newTrackedEntity = await trx
                .insertInto("trackedEntity")
                .values({
                  quantity: splitInfo.remainingQuantity,
                  status: "Available",
                  sourceDocument: splitInfo.sourceDocument,
                  sourceDocumentId: splitInfo.sourceDocumentId,
                  sourceDocumentReadableId: splitInfo.sourceDocumentReadableId,
                  attributes: splitInfo.attributes as unknown as Json,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .returning(["id"])
                .execute();

              const newTrackedEntityId = newTrackedEntity[0].id!;

              // Update the original entity's attributes to include the split entity ID
              const originalEntity = await trx
                .selectFrom("trackedEntity")
                .select(["attributes"])
                .where("id", "=", splitInfo.originalEntityId)
                .executeTakeFirst();

              if (originalEntity) {
                const updatedAttributes = {
                  ...((originalEntity.attributes as TrackedEntityAttributes) ||
                    {}),
                  "Split Entity ID": newTrackedEntityId,
                };

                // Remove Shipment and Shipment Line attributes from the new entity
                const updatedAttributesObj = {
                  ...((originalEntity.attributes as TrackedEntityAttributes) ||
                    {}),
                };

                // Delete shipment-related attributes
                delete updatedAttributesObj["Shipment"];
                delete updatedAttributesObj["Shipment Line"];
                delete updatedAttributesObj["Shipment Line Index"];

                // Add the split entity reference
                updatedAttributesObj["Split Entity ID"] = newTrackedEntityId;

                // Update the original entity with the reference to the new split entity
                await trx
                  .updateTable("trackedEntity")
                  .set({
                    attributes: updatedAttributes,
                  })
                  .where("id", "=", splitInfo.originalEntityId)
                  .execute();
              }

              // Record the new entity as output from the split
              await trx
                .insertInto("trackedActivityOutput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: newTrackedEntityId,
                  quantity: splitInfo.remainingQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();

              // Record the shipped portion as output (will be consumed by shipment)
              await trx
                .insertInto("trackedActivityOutput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: splitInfo.originalEntityId,
                  quantity: splitInfo.shippedQuantity,
                  companyId: splitInfo.companyId,
                  createdBy: userId,
                  createdAt: today,
                })
                .execute();
            }

            // Now handle the shipment consumption
            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (trackedActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId,
                    trackedEntityId: id,
                    quantity: update.quantity ?? 0,
                    companyId,
                    createdBy: userId,
                    createdAt: today,
                  })
                  .execute();
              }
            }
          }

          if (Object.keys(jobOperationsUpdates).length > 0) {
            console.log(
              "Final job updates to be applied:",
              jobOperationsUpdates
            );
            for await (const [jobOperationId, update] of Object.entries(
              jobOperationsUpdates
            )) {
              console.log(
                `Updating job operation ${jobOperationId} with:`,
                update
              );
              await trx
                .updateTable("jobOperation")
                .set(update)
                .where("id", "=", jobOperationId)
                .execute();
            }
          }
        });
        break;
      }
      case "Outbound Transfer": {
        if (!shipment.data.sourceDocumentId)
          throw new Error("Shipment has no sourceDocumentId");

        const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
          client
            .from("warehouseTransfer")
            .select("*")
            .eq("id", shipment.data.sourceDocumentId)
            .single(),
          client
            .from("warehouseTransferLine")
            .select("*")
            .eq("transferId", shipment.data.sourceDocumentId),
        ]);

        if (warehouseTransfer.error)
          throw new Error("Failed to fetch warehouse transfer");
        if (warehouseTransferLines.error)
          throw new Error("Failed to fetch warehouse transfer lines");

        const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
          [];
        const warehouseTransferLineUpdates: Record<
          string,
          Database["public"]["Tables"]["warehouseTransferLine"]["Update"]
        > = {};

        // Process each shipment line
        for await (const shipmentLine of shipmentLines.data) {
          const warehouseTransferLine = warehouseTransferLines.data.find(
            (line) => line.id === shipmentLine.lineId
          );

          if (!warehouseTransferLine) continue;

          const shippedQuantity = shipmentLine.shippedQuantity ?? 0;

          // Update warehouse transfer line shipped quantity
          const newShippedQuantity =
            (warehouseTransferLine.shippedQuantity ?? 0) + shippedQuantity;

          warehouseTransferLineUpdates[warehouseTransferLine.id] = {
            shippedQuantity: newShippedQuantity,
          };

          // Create item ledger entry for negative adjustment at source
          if (shippedQuantity !== 0) {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              quantity: -shippedQuantity, // Negative for outbound transfer
              locationId: shipmentLine.locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Transfer",
              documentType: "Transfer Shipment",
              documentId: warehouseTransfer.data?.transferId,
              externalDocumentId:
                shipment.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }
        }

        // Check if all lines are fully shipped
        const allLinesFullyShipped = warehouseTransferLines.data.every(
          (line) => {
            const updates = warehouseTransferLineUpdates[line.id];
            const shippedQty =
              updates?.shippedQuantity ?? line.shippedQuantity ?? 0;
            return shippedQty >= (line.quantity ?? 0);
          }
        );

        // Check if all lines are fully received
        const allLinesFullyReceived = warehouseTransferLines.data.every(
          (line) => {
            const receivedQty = line.receivedQuantity ?? 0;
            return receivedQty >= (line.quantity ?? 0);
          }
        );

        // Determine new warehouse transfer status
        let newStatus: Database["public"]["Tables"]["warehouseTransfer"]["Row"]["status"] =
          warehouseTransfer.data.status;

        if (allLinesFullyShipped && allLinesFullyReceived) {
          newStatus = "Completed";
        } else if (allLinesFullyShipped && !allLinesFullyReceived) {
          newStatus = "To Receive";
        } else if (!allLinesFullyShipped && allLinesFullyReceived) {
          newStatus = "To Ship";
        }

        await db.transaction().execute(async (trx) => {
          // Update warehouse transfer lines
          for await (const [lineId, update] of Object.entries(
            warehouseTransferLineUpdates
          )) {
            await trx
              .updateTable("warehouseTransferLine")
              .set(update)
              .where("id", "=", lineId)
              .execute();
          }

          // Update warehouse transfer status
          await trx
            .updateTable("warehouseTransfer")
            .set({
              status: newStatus,
              transferDate: today,
              updatedBy: userId,
            })
            .where("id", "=", warehouseTransfer.data.id)
            .execute();

          // Create item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update shipment status
          await trx
            .updateTable("shipment")
            .set({
              status: "Posted",
              postedBy: userId,
            })
            .where("id", "=", shipmentId)
            .execute();
        });

        break;
      }

      default: {
        throw new Error(
          `Invalid source document type: ${shipment.data.sourceDocument}`
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    if ("shipmentId" in payload) {
      const client = await getSupabaseServiceRole(
        req.headers.get("Authorization"),
        req.headers.get("carbon-key") ?? "",
        payload.companyId
      );
      await client
        .from("shipment")
        .update({ status: "Draft" })
        .eq("id", payload.shipmentId);
    }
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
