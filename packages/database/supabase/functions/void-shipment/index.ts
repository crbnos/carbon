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
      function: "void-shipment",
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

    // Verify shipment is posted before allowing void
    if (shipment.data?.status !== "Posted") {
      throw new Error("Can only void posted shipments");
    }

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

        const [salesOrder, salesOrderLines] = await Promise.all([
          client
            .from("salesOrder")
            .select("*")
            .eq("id", shipment.data.sourceDocumentId)
            .single(),
          client
            .from("salesOrderLine")
            .select("*")
            .eq("salesOrderId", shipment.data.sourceDocumentId),
        ]);
        if (salesOrder.error) throw new Error("Failed to fetch sales order");
        if (salesOrderLines.error)
          throw new Error("Failed to fetch sales order lines");

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

        const locationId = shipment.data.locationId;
        for await (const shipmentLine of shipmentLines.data) {
          if (
            shipmentLine.fulfillment?.type === "Job" &&
            shipmentLine.fulfillment?.jobId
          ) {
            // Reverse job quantities for void shipment
            const jobId = shipmentLine.fulfillment.jobId;
            const currentJob = jobs.data.find((j) => j.id === jobId);

            console.log("Processing job void:", {
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

            // Ensure shippedQuantity is a valid number
            const shippedQuantity =
              typeof shipmentLine.shippedQuantity === "number" &&
              !isNaN(shipmentLine.shippedQuantity)
                ? shipmentLine.shippedQuantity
                : 0;

            console.log("Calculated values for void:", {
              currentQuantityShipped,
              shippedQuantity,
              newTotal: currentQuantityShipped - shippedQuantity,
              jobQuantity: currentJob?.quantity,
            });

            // Reduce shipped quantity (reverse of posting)
            const newQuantityShipped = Math.max(
              0,
              currentQuantityShipped - shippedQuantity
            );
            const newQuantityComplete = Math.max(
              0,
              (currentJob?.quantityComplete ?? 0) - shippedQuantity
            );
            
            // Update status based on new quantities
            let newStatus = currentJob?.status;
            if (currentJob?.status === "Completed" && newQuantityShipped < (currentJob?.quantity ?? 0)) {
              newStatus = "In Progress";
            }

            jobUpdates[jobId] = {
              status: newStatus,
              quantityComplete: newQuantityComplete,
              quantityShipped: newQuantityShipped,
            };

            continue;
          }

          const itemTrackingType =
            items.data.find((item) => item.id === shipmentLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          // Default shippedQuantity to 0 if not defined or NaN
          const shippedQuantity = isNaN(shipmentLine.shippedQuantity) || shipmentLine.shippedQuantity == null ? 0 : shipmentLine.shippedQuantity;

          if (itemTrackingType === "Inventory") {
            // Create positive adjustment to restore inventory
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              quantity: shippedQuantity, // Positive to restore inventory
              locationId: shipmentLine.locationId ?? locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Positive Adjmt.",
              documentType: "Sales Shipment Void",
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
              quantity: shippedQuantity, // Positive to restore inventory
              locationId: shipmentLine.locationId ?? locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Positive Adjmt.",
              documentType: "Sales Shipment Void",
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
                quantity: 1, // Positive to restore inventory
                locationId: shipmentLine.locationId ?? locationId,
                shelfId: shipmentLine.shelfId,
                entryType: "Positive Adjmt.",
                documentType: "Sales Shipment Void",
                documentId: shipment.data?.id ?? undefined,
                trackedEntityId: tracking.id,
                externalDocumentId: undefined,
                createdBy: userId,
                companyId,
              });
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

        // Reverse sales order line updates
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
                const safeShippedQuantity = isNaN(shipmentLine.shippedQuantity) || shipmentLine.shippedQuantity == null ? 0 : shipmentLine.shippedQuantity;
                return acc + safeShippedQuantity;
              },
              0
            );

            // Reduce shipped quantity (reverse of posting)
            const newQuantitySent = Math.max(
              0,
              (salesOrderLine.quantitySent ?? 0) - shippedQuantity
            );

            const sentComplete = newQuantitySent >= salesOrderLine.saleQuantity;

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

            // Clear sent date if no longer complete
            if (!sentComplete && salesOrderLine.sentDate) {
              updates[salesOrderLine.id].sentDate = null;
            }

            return updates;
          }

          return acc;
        }, {});

        // Restore tracked entities to available status
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

            // Restore original quantity and set to available
            acc[trackedEntity.id] = {
              status: "Available",
              quantity: trackedEntity.quantity, // Restore original quantity
            };

            return acc;
          }, {}) ?? {};

        await db.transaction().execute(async (trx) => {
          // Update sales order lines to reverse shipped quantities
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

          // Update shipment status to Voided
          await trx
            .updateTable("shipment")
            .set({
              status: "Voided",
              voidedDate: today,
              voidedBy: userId,
            })
            .where("id", "=", shipmentId)
            .execute();

          // Restore tracked entities to available status
          if (Object.keys(trackedEntityUpdates).length > 0) {
            const voidActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Void Shipment",
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

            const voidActivityId = voidActivity[0].id;

            // Restore tracked entities
            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (voidActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId: voidActivityId,
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

          // Create reversing item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update jobs to reverse shipped quantities
          if (Object.keys(jobUpdates).length > 0) {
            console.log("Final job void updates to be applied:", jobUpdates);
            for await (const [jobId, update] of Object.entries(jobUpdates)) {
              console.log(`Voiding job ${jobId} with:`, update);
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
            // Reset job operation status when voiding
            const jobOperationId = purchaseOrderLine.jobOperationId;

            jobOperationsUpdates[jobOperationId] = {
              status: "Planned",
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

        // Reverse purchase order line updates
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
                const safeShippedQuantity = isNaN(shipmentLine.shippedQuantity) || shipmentLine.shippedQuantity == null ? 0 : shipmentLine.shippedQuantity;
                return acc + safeShippedQuantity;
              },
              0
            );

            // Reduce shipped quantity (reverse of posting)
            const newQuantityShipped = Math.max(
              0,
              (purchaseOrderLine.quantityShipped ?? 0) - shippedQuantity
            );

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

        // Restore tracked entities to available status
        const trackedEntityUpdates =
          shipmentLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["trackedEntity"]["Update"]
            >
          >((acc, trackedEntity) => {
            // Restore original quantity and set to available
            acc[trackedEntity.id] = {
              status: "Available",
              quantity: trackedEntity.quantity,
            };

            return acc;
          }, {}) ?? {};

        await db.transaction().execute(async (trx) => {
          // Update purchase order lines to reverse shipped quantities
          for await (const [purchaseOrderLineId, update] of Object.entries(
            purchaseOrderLineUpdates
          )) {
            await trx
              .updateTable("purchaseOrderLine")
              .set(update)
              .where("id", "=", purchaseOrderLineId)
              .execute();
          }

          // Update shipment status to Voided
          await trx
            .updateTable("shipment")
            .set({
              status: "Voided",
              voidedDate: today,
              voidedBy: userId,
            })
            .where("id", "=", shipmentId)
            .execute();

          // Restore tracked entities
          if (Object.keys(trackedEntityUpdates).length > 0) {
            const voidActivity = await trx
              .insertInto("trackedActivity")
              .values({
                type: "Void Shipment",
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

            const voidActivityId = voidActivity[0].id;

            // Restore tracked entities
            for await (const [id, update] of Object.entries(
              trackedEntityUpdates
            )) {
              await trx
                .updateTable("trackedEntity")
                .set(update)
                .where("id", "=", id)
                .execute();

              if (voidActivityId) {
                await trx
                  .insertInto("trackedActivityInput")
                  .values({
                    trackedActivityId: voidActivityId,
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

          // Update job operations to reset status
          if (Object.keys(jobOperationsUpdates).length > 0) {
            console.log(
              "Final job operation void updates to be applied:",
              jobOperationsUpdates
            );
            for await (const [jobOperationId, update] of Object.entries(
              jobOperationsUpdates
            )) {
              console.log(
                `Voiding job operation ${jobOperationId} with:`,
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

          const shippedQuantity = isNaN(shipmentLine.shippedQuantity) || shipmentLine.shippedQuantity == null ? 0 : shipmentLine.shippedQuantity;

          // Reverse warehouse transfer line shipped quantity
          const newShippedQuantity = Math.max(
            0,
            (warehouseTransferLine.shippedQuantity ?? 0) - shippedQuantity
          );

          warehouseTransferLineUpdates[warehouseTransferLine.id] = {
            shippedQuantity: newShippedQuantity,
          };

          // Create item ledger entry to restore inventory at source
          if (shippedQuantity !== 0) {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              quantity: shippedQuantity, // Positive to restore inventory
              locationId: shipmentLine.locationId,
              shelfId: shipmentLine.shelfId,
              entryType: "Transfer",
              documentType: "Transfer Shipment Void",
              documentId: warehouseTransfer.data?.transferId,
              externalDocumentId:
                shipment.data?.externalDocumentId ?? undefined,
              createdBy: userId,
              companyId,
            });
          }
        }

        // Check if all lines are fully shipped after void
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
        } else {
          newStatus = "Draft";
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
              updatedBy: userId,
            })
            .where("id", "=", warehouseTransfer.data.id)
            .execute();

          // Create reversing item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
              .execute();
          }

          // Update shipment status to Voided
          await trx
            .updateTable("shipment")
            .set({
              status: "Voided",
              voidedDate: today,
              voidedBy: userId,
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
    return new Response(JSON.stringify(err), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});