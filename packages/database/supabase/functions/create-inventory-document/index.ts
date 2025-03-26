import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import z from "npm:zod@^3.24.1";
import { getSupabaseServiceRole } from "../lib/supabase.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("receiptDefault"),
    locationId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptFromPurchaseOrder"),
    locationId: z.string(),
    purchaseOrderId: z.string(),
    receiptId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("receiptLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    receiptId: z.string(),
    receiptLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentDefault"),
    locationId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrder"),
    locationId: z.string(),
    salesOrderId: z.string(),
    shipmentId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentFromSalesOrderLine"),
    locationId: z.string(),
    salesOrderLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("shipmentLineSplit"),
    quantity: z.number(),
    locationId: z.string(),
    shipmentId: z.string(),
    shipmentLineId: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  console.log(payloadValidator.safeParse(payload));
  const { type, locationId, companyId, userId } =
    payloadValidator.parse(payload);

  switch (type) {
    case "receiptDefault": {
      let createdDocumentId;
      console.log({
        function: "create-inventory-document",
        type,
        companyId,
        locationId,
        userId,
      });
      try {
        await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "receipt", companyId);
          const newReceipt = await trx
            .insertInto("receipt")
            .values({
              receiptId: createdDocumentId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId,
            })
            .returning(["id", "receiptId"])
            .execute();

          createdDocumentId = newReceipt?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create receipt");
        });

        return new Response(
          JSON.stringify({
            id: createdDocumentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptFromPurchaseOrder": {
      const { purchaseOrderId, receiptId: existingReceiptId } = payload;

      console.log({
        function: "create-inventory-document",
        type,
        companyId,
        locationId,
        purchaseOrderId,
        existingReceiptId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [purchaseOrder, purchaseOrderLines, receipt] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", purchaseOrderId)
            .in("purchaseOrderLineType", [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable",
            ])
            .eq("locationId", locationId),
          client
            .from("receipt")
            .select("*")
            .eq("id", existingReceiptId)
            .maybeSingle(),
        ]);

        if (!purchaseOrder.data) throw new Error("Purchase order not found");
        if (purchaseOrderLines.error)
          throw new Error(purchaseOrderLines.error.message);

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            purchaseOrderLines.data.map((d) => d.itemId)
          );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        const hasReceipt = !!receipt.data?.id;

        const previouslyReceivedQuantitiesByLine = (
          purchaseOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantityReceived ?? 0;
          return acc;
        }, {});

        const receiptLineItems = purchaseOrderLines.data.reduce<
          ReceiptLineItem[]
        >((acc, d) => {
          if (
            !d.itemId ||
            !d.purchaseQuantity ||
            d.unitPrice === null ||
            d.purchaseOrderLineType === "Service" ||
            isNaN(d.unitPrice)
          ) {
            return acc;
          }

          const outstandingQuantity =
            d.purchaseQuantity -
            (previouslyReceivedQuantitiesByLine[d.id!] ?? 0);

          const shippingAndTaxUnitCost =
            ((d.taxAmount ?? 0) + (d.shippingCost ?? 0)) /
            (d.purchaseQuantity * (d.conversionFactor ?? 1));

          acc.push({
            lineId: d.id,
            companyId: companyId,
            itemId: d.itemId,
            itemReadableId: d.itemReadableId,
            orderQuantity: d.purchaseQuantity * (d.conversionFactor ?? 1),
            outstandingQuantity:
              outstandingQuantity * (d.conversionFactor ?? 1),
            receivedQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
            conversionFactor: d.conversionFactor ?? 1,
            requiresSerialTracking: serializedItems.has(d.itemId),
            requiresBatchTracking: batchItems.has(d.itemId),
            unitPrice:
              d.unitPrice / (d.conversionFactor ?? 1) + shippingAndTaxUnitCost,
            unitOfMeasure: d.inventoryUnitOfMeasureCode ?? "EA",
            locationId: d.locationId,
            shelfId: d.shelfId,
            createdBy: userId ?? "",
          });

          return acc;
        }, []);

        if (receiptLineItems.length === 0) {
          throw new Error("No valid receipt line items found");
        }

        let receiptId = hasReceipt ? receipt.data?.id! : "";
        let receiptIdReadable = hasReceipt ? receipt.data?.receiptId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasReceipt) {
            // update existing receipt
            await trx
              .updateTable("receipt")
              .set({
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                locationId: locationId,
                updatedBy: userId,
              })
              .where("id", "=", receiptId)
              .returning(["id", "receiptId"])
              .execute();
            // delete existing receipt lines
            await trx
              .deleteFrom("receiptLine")
              .where("receiptId", "=", receiptId)
              .execute();
          } else {
            receiptIdReadable = await getNextSequence(
              trx,
              "receipt",
              companyId
            );
            const newReceipt = await trx
              .insertInto("receipt")
              .values({
                receiptId: receiptIdReadable,
                sourceDocument: "Purchase Order",
                sourceDocumentId: purchaseOrder.data.id,
                sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
                supplierId: purchaseOrder.data.supplierId,
                supplierInteractionId: purchaseOrder.data.supplierInteractionId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId,
              })
              .returning(["id", "receiptId"])
              .execute();

            receiptId = newReceipt?.[0]?.id!;
            receiptIdReadable = newReceipt?.[0]?.receiptId!;
          }

          if (receiptLineItems.length > 0) {
            await trx
              .insertInto("receiptLine")
              .values(
                receiptLineItems.map((line) => ({
                  ...line,
                  receiptId: receiptId,
                  locationId,
                }))
              )
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: receiptId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "receiptLineSplit": {
      const { receiptId, receiptLineId, quantity } = payload;

      console.log({
        function: "create-inventory-document",
        type,
        locationId,
        receiptId,
        receiptLineId,
        quantity,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [receiptLine, trackedEntities] = await Promise.all([
          client
            .from("receiptLine")
            .select("*")
            .eq("id", receiptLineId)
            .single(),
          client
            .from("trackedEntity")
            .select("*")
            .eq("attributes->> Receipt Line", receiptLineId),
        ]);

        console.log({
          trackedEntities,
        });

        if (!receiptLine.data) throw new Error("Receipt line not found");

        await db.transaction().execute(async (trx) => {
          const { id, ...data } = receiptLine.data;

          if (
            receiptLine.data.requiresSerialTracking &&
            trackedEntities.data?.length
          ) {
            // TODO: update the Receipt Line and Index attributes to point to the new line
            await trx
              .deleteFrom("trackedEntity")
              .where("id", "in", trackedEntities.data?.map((d) => d.id) ?? [])
              .execute();
          }

          await trx
            .insertInto("receiptLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              receivedQuantity: quantity,
              createdBy: userId,
            })
            .execute();

          await trx
            .updateTable("receiptLine")
            .set({
              orderQuantity: receiptLine.data.orderQuantity - quantity,
              outstandingQuantity:
                receiptLine.data.outstandingQuantity - quantity,
              receivedQuantity: receiptLine.data.receivedQuantity - quantity,
              updatedBy: userId,
            })
            .where("id", "=", receiptLineId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: receiptLineId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentDefault": {
      let createdDocumentId;
      console.log({
        function: "create-inventory-document",
        type,
        companyId,
        locationId,
        userId,
      });
      try {
        await db.transaction().execute(async (trx) => {
          createdDocumentId = await getNextSequence(trx, "shipment", companyId);

          const newShipment = await trx
            .insertInto("shipment")
            .values({
              shipmentId: createdDocumentId,
              companyId: companyId,
              locationId: locationId,
              createdBy: userId,
            })
            .returning(["id", "shipmentId"])
            .execute();

          createdDocumentId = newShipment?.[0]?.id;
          if (!createdDocumentId) throw new Error("Failed to create shipment");
        });

        return new Response(
          JSON.stringify({
            id: createdDocumentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromSalesOrder": {
      const { salesOrderId, shipmentId: existingShipmentId } = payload;

      console.log({
        function: "create-inventory-document",
        type,
        companyId,
        locationId,
        salesOrderId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [
          salesOrder,
          salesOrderLines,
          salesOrderShipment,
          shipment,
          jobs,
        ] = await Promise.all([
          client.from("salesOrder").select("*").eq("id", salesOrderId).single(),
          client
            .from("salesOrderLine")
            .select("*")
            .eq("salesOrderId", salesOrderId)
            .in("salesOrderLineType", [
              "Part",
              "Material",
              "Tool",
              "Fixture",
              "Consumable",
            ])
            .eq("locationId", locationId),
          client
            .from("salesOrderShipment")
            .select("*")
            .eq("id", salesOrderId)
            .maybeSingle(),
          client
            .from("shipment")
            .select("*")
            .eq("id", existingShipmentId)
            .maybeSingle(),
          client
            .from("job")
            .select("*")
            .eq("salesOrderId", salesOrderId)
        ]);

        if (!salesOrder.data) throw new Error("Sales order not found");
        if (salesOrderLines.error)
          throw new Error(salesOrderLines.error.message);

        const items = await client
          .from("item")
          .select("id, itemTrackingType")
          .in(
            "id",
            salesOrderLines.data.map((d) => d.itemId)
          );
        const serializedItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Serial")
            .map((d) => d.id)
        );
        const batchItems = new Set(
          items.data
            ?.filter((d) => d.itemTrackingType === "Batch")
            .map((d) => d.id)
        );

        const hasShipment = !!shipment.data?.id;
        
        // Group jobs by sales order line ID
        const jobsBySalesOrderLine = (jobs.data || []).reduce<
          Record<string, Database["public"]["Tables"]["job"]["Row"][]>
        >((acc, job) => {
          if (job.salesOrderLineId) {
            if (!acc[job.salesOrderLineId]) {
              acc[job.salesOrderLineId] = [];
            }
            acc[job.salesOrderLineId].push(job);
          }
          return acc;
        }, {});

        

        const previouslyShippedQuantitiesByLine = (
          salesOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantitySent ?? 0;
          return acc;
        }, {});

        let shipmentId = hasShipment ? shipment.data?.id! : "";
        let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasShipment) {
            // update existing shipment
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                customerId: salesOrder.data.customerId,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                opportunityId: salesOrder.data.opportunityId,
                locationId: locationId,
                updatedBy: userId,
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
              .execute();
          } else {
            shipmentIdReadable = await getNextSequence(
              trx,
              "shipment",
              companyId
            );

            const newShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId: shipmentIdReadable,
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                customerId: salesOrder.data.customerId,
                opportunityId: salesOrder.data.opportunityId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId,
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          const shipmentLineItems: ShipmentLineItem[] = [];

          // Process each sales order line
          for await (const salesOrderLine of salesOrderLines.data) {
            console.log({salesOrderLine})
            if (
              !salesOrderLine.itemId ||
              !salesOrderLine.saleQuantity ||
              salesOrderLine.unitPrice === null ||
              salesOrderLine.salesOrderLineType === "Service" ||
              isNaN(salesOrderLine.unitPrice)
            ) {
              continue;
            }

            const isSerial = serializedItems.has(salesOrderLine.itemId);
            const isBatch = batchItems.has(salesOrderLine.itemId);

            if (salesOrderLine.methodType === "Make") {
              
              for await (const job of jobsBySalesOrderLine[salesOrderLine.id] ??
                []) {
                if (!salesOrderLine.itemId) return;

                const quantityAvailable = isSerial
                  ? Math.min(job.quantityComplete - job.quantityShipped, 0)
                  : job.quantity - job.quantityShipped;

                
                if (!isSerial || (isSerial && quantityAvailable > 0)) {
                  const fulfillment = await trx
                    .insertInto("fulfillment")
                    .values({
                      salesOrderLineId: salesOrderLine.id,
                      type: "Job",
                      jobId: job.id,
                      quantity: quantityAvailable,
                      companyId: companyId,
                      createdBy: userId,
                    })
                    .returning(["id"])
                    .execute();

                  const fulfillmentId = fulfillment?.[0]?.id;

                  const shippingAndTaxUnitCost =
                    (salesOrderLine.shippingCost / quantityAvailable +
                      (salesOrderLine.unitPrice ?? 0)) *
                    (1 + salesOrderLine.taxPercent);

                  const shipmentLine = await trx
                    .insertInto("shipmentLine")
                    .values({
                      shipmentId: shipmentId,
                      lineId: salesOrderLine.id,
                      companyId: companyId,
                      fulfillmentId,
                      itemId: salesOrderLine.itemId,
                      itemReadableId: salesOrderLine.itemReadableId,
                      orderQuantity: salesOrderLine.saleQuantity,
                      outstandingQuantity: salesOrderLine.quantityToSend ?? salesOrderLine.saleQuantity,
                      shippedQuantity: quantityAvailable,
                      requiresSerialTracking: isSerial,
                      requiresBatchTracking: isBatch,
                      unitPrice: shippingAndTaxUnitCost,
                      unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                      createdBy: userId ?? "",
                    })
                    .returning(["id"])
                    .execute();

                  const shipmentLineId = shipmentLine?.[0]?.id;

                  if (!shipmentLineId)
                    throw new Error("Shipment line not found");

                  if (isSerial || isBatch) {
                    const jobMakeMethod = await trx
                      .selectFrom("jobMakeMethod")
                      .select(["id"])
                      .where("jobId", "=", job.id)
                      .where("parentMaterialId", "is", null)
                      .executeTakeFirst();

                    if (jobMakeMethod?.id) {
                      const trackedEntities = await client
                        .from("trackedEntity")
                        .select("*")
                        .eq("attributes->>Job Make Method", jobMakeMethod.id)
                        .order("createdAt", { ascending: true });

                      let index = 0;
                      for await (const trackedEntity of trackedEntities?.data ??
                        []) {
                        await trx
                          .updateTable("trackedEntity")
                          .set({
                            attributes: {
                              ...(trackedEntity.attributes as Record<
                                string,
                                unknown
                              >),
                              Shipment: shipmentId,
                              "Shipment Line": shipmentLineId,
                              "Shipment Line Index": index,
                            },
                          })
                          .where("id", "=", trackedEntity.id)
                          .execute();
                        index++;
                      }
                    }
                  }
                }
              }
            } else {
              const outstandingQuantity =
                (salesOrderLine.saleQuantity ?? 0) -
                  previouslyShippedQuantitiesByLine[salesOrderLine.id] ?? 0;

              const shippingAndTaxUnitCost =
                (salesOrderLine.shippingCost /
                  (salesOrderLine.saleQuantity ?? 0) +
                  (salesOrderLine.unitPrice ?? 0)) *
                (1 + salesOrderLine.taxPercent);

              await trx
                .insertInto("shipmentLine")
                .values({
                  shipmentId: shipmentId,
                  lineId: salesOrderLine.id,
                  companyId: companyId,
                  itemId: salesOrderLine.itemId,
                  itemReadableId: salesOrderLine.itemReadableId,
                  orderQuantity: salesOrderLine.saleQuantity,
                  outstandingQuantity: outstandingQuantity,
                  shippedQuantity: outstandingQuantity,
                  requiresSerialTracking: isSerial,
                  requiresBatchTracking: isBatch,
                  unitPrice: shippingAndTaxUnitCost,
                  unitOfMeasure: salesOrderLine.unitOfMeasureCode ?? "EA",
                  locationId: salesOrderLine.locationId,
                  shelfId: salesOrderLine.shelfId,
                  createdBy: userId ?? "",
                })
                .execute();
            }
          }

          if (shipmentLineItems.length > 0) {
            // Insert all shipment lines
            await trx
              .insertInto("shipmentLine")
              .values(
                shipmentLineItems.map((line) => ({
                  ...line,
                  shipmentId: shipmentId,
                  locationId,
                }))
              )
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: shipmentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentFromSalesOrderLine": {
      const { salesOrderLineId, shipmentId: existingShipmentId } = payload;

      console.log({
        function: "create-inventory-document",
        type,
        companyId,
        locationId,
        salesOrderLineId,
        existingShipmentId,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const salesOrderLine = await client
          .from("salesOrderLine")
          .select("*")
          .eq("id", salesOrderLineId)
          .eq("locationId", locationId)
          .single();

        if (!salesOrderLine.data || !salesOrderLine.data.itemId)
          throw new Error("Sales order line not found");
        const salesOrderId = salesOrderLine.data.salesOrderId;

        const [salesOrder, salesOrderShipment, shipment, jobs] =
          await Promise.all([
            client
              .from("salesOrder")
              .select("*")
              .eq("id", salesOrderId)
              .single(),
            client
              .from("salesOrderShipment")
              .select("*")
              .eq("id", salesOrderId)
              .maybeSingle(),
            client
              .from("shipment")
              .select("*")
              .eq("id", existingShipmentId)
              .maybeSingle(),
            client
              .from("job")
              .select("*")
              .eq("salesOrderLineId", salesOrderLineId),
          ]);

        if (!salesOrder.data) throw new Error("Sales order not found");

        const item = await client
          .from("item")
          .select("id, itemTrackingType")
          .eq("id", salesOrderLine.data.itemId)
          .single();

        if (!item.data) throw new Error("Item not found");

        const isSerial = item.data.itemTrackingType === "Serial";
        const isBatch = item.data.itemTrackingType === "Batch";

        const hasShipment = !!shipment.data?.id;
        const previouslyShippedQuantity = salesOrderLine.data.quantitySent ?? 0;

        let shipmentId = hasShipment ? shipment.data?.id! : "";
        let shipmentIdReadable = hasShipment ? shipment.data?.shipmentId! : "";

        await db.transaction().execute(async (trx) => {
          if (hasShipment) {
            // update existing shipment
            await trx
              .updateTable("shipment")
              .set({
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                locationId: locationId,
                updatedBy: userId,
              })
              .where("id", "=", shipmentId)
              .returning(["id", "shipmentId"])
              .execute();
            // delete existing shipment lines
            await trx
              .deleteFrom("shipmentLine")
              .where("shipmentId", "=", shipmentId)
              .execute();
          } else {
            shipmentIdReadable = await getNextSequence(
              trx,
              "shipment",
              companyId
            );

            const newShipment = await trx
              .insertInto("shipment")
              .values({
                shipmentId: shipmentIdReadable,
                sourceDocument: "Sales Order",
                sourceDocumentId: salesOrder.data.id,
                sourceDocumentReadableId: salesOrder.data.salesOrderId,
                shippingMethodId: salesOrderShipment.data?.shippingMethodId,
                customerId: salesOrder.data.customerId,
                opportunityId: salesOrder.data.opportunityId,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId,
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          if (salesOrderLine.data.methodType === "Make") {
            for await (const job of jobs.data ?? []) {
              if (!salesOrderLine.data.itemId) return;
              const quantityAvailable = isSerial
                ? Math.min(job.quantityComplete - job.quantityShipped, 0)
                : job.quantity - job.quantityReceivedToInventory;

              if (!isSerial || (isSerial && quantityAvailable > 0)) {
                const fulfillment = await trx
                  .insertInto("fulfillment")
                  .values({
                    salesOrderLineId: salesOrderLineId,
                    type: "Job",
                    jobId: job.id,
                    quantity: quantityAvailable,
                    companyId: companyId,
                    createdBy: userId,
                  })
                  .returning(["id"])
                  .execute();

                const fulfillmentId = fulfillment?.[0]?.id;

                const shippingAndTaxUnitCost =
                  (salesOrderLine.data.shippingCost / quantityAvailable +
                    (salesOrderLine.data.unitPrice ?? 0)) *
                  (1 + salesOrderLine.data.taxPercent);

                const shipmentLine = await trx
                  .insertInto("shipmentLine")
                  .values({
                    shipmentId: shipmentId,
                    lineId: salesOrderLineId,
                    companyId: companyId,
                    fulfillmentId,
                    itemId: salesOrderLine.data.itemId,
                    itemReadableId: salesOrderLine.data.itemReadableId,
                    orderQuantity: quantityAvailable,
                    outstandingQuantity: quantityAvailable,
                    shippedQuantity: quantityAvailable,
                    requiresSerialTracking: isSerial,
                    requiresBatchTracking: isBatch,
                    unitPrice: shippingAndTaxUnitCost,
                    unitOfMeasure:
                      salesOrderLine.data.unitOfMeasureCode ?? "EA",
                    createdBy: userId ?? "",
                  })
                  .returning(["id"])
                  .execute();

                const shipmentLineId = shipmentLine?.[0]?.id;

                if (!shipmentLineId) throw new Error("Shipment line not found");

                if (isSerial || isBatch) {
                  const jobMakeMethod = await trx
                    .selectFrom("jobMakeMethod")
                    .select(["id"])
                    .where("jobId", "=", job.id)
                    .where("parentMaterialId", "is", null)
                    .executeTakeFirst();

                  if (jobMakeMethod?.id) {
                    const trackedEntities = await client
                      .from("trackedEntity")
                      .select("*")
                      .eq("attributes->>Job Make Method", jobMakeMethod.id)
                      .order("createdAt", { ascending: true });

                    let index = 0;
                    for await (const trackedEntity of trackedEntities?.data ??
                      []) {
                      await trx
                        .updateTable("trackedEntity")
                        .set({
                          attributes: {
                            ...(trackedEntity.attributes as Record<
                              string,
                              unknown
                            >),
                            Shipment: shipmentId,
                            "Shipment Line": shipmentLineId,
                            "Shipment Line Index": index,
                          },
                        })
                        .where("id", "=", trackedEntity.id)
                        .execute();
                      index++;
                    }
                  }
                }
              }
            }
          } else {
            const outstandingQuantity =
              (salesOrderLine.data.saleQuantity ?? 0) -
              previouslyShippedQuantity;

            const shippingAndTaxUnitCost =
              (salesOrderLine.data.shippingCost /
                (salesOrderLine.data.saleQuantity ?? 0) +
                (salesOrderLine.data.unitPrice ?? 0)) *
              (1 + salesOrderLine.data.taxPercent);

            await trx
              .insertInto("shipmentLine")
              .values({
                shipmentId: shipmentId,
                lineId: salesOrderLineId,
                companyId: companyId,
                itemId: salesOrderLine.data.itemId,
                itemReadableId: salesOrderLine.data.itemReadableId,
                orderQuantity: salesOrderLine.data.saleQuantity,
                outstandingQuantity: outstandingQuantity,
                shippedQuantity: outstandingQuantity,
                requiresSerialTracking: isSerial,
                requiresBatchTracking: isBatch,
                unitPrice: shippingAndTaxUnitCost,
                unitOfMeasure: salesOrderLine.data.unitOfMeasureCode ?? "EA",
                locationId: salesOrderLine.data.locationId,
                shelfId: salesOrderLine.data.shelfId,
                createdBy: userId ?? "",
              })
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            id: shipmentId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    case "shipmentLineSplit": {
      const { shipmentId, shipmentLineId, quantity } = payload;

      console.log({
        function: "create-inventory-document",
        type,
        locationId,
        shipmentId,
        shipmentLineId,
        quantity,
        userId,
      });

      try {
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [shipmentLine] = await Promise.all([
          client
            .from("shipmentLine")
            .select("*")
            .eq("id", shipmentLineId)
            .single(),
        ]);

        if (!shipmentLine.data) throw new Error("Shipment line not found");

        await db.transaction().execute(async (trx) => {
          const { id, ...data } = shipmentLine.data;

          await trx
            .insertInto("shipmentLine")
            .values({
              ...data,
              orderQuantity: quantity,
              outstandingQuantity: quantity,
              shippedQuantity: quantity,
              createdBy: userId,
            })
            .execute();

          await trx
            .updateTable("shipmentLine")
            .set({
              orderQuantity: shipmentLine.data.orderQuantity - quantity,
              outstandingQuantity:
                shipmentLine.data.outstandingQuantity - quantity,
              shippedQuantity: shipmentLine.data.shippedQuantity - quantity,
              updatedBy: userId,
            })
            .where("id", "=", shipmentLineId)
            .execute();
        });

        return new Response(
          JSON.stringify({
            id: shipmentLineId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 201,
          }
        );
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify(err), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
    }
    default:
      return new Response(JSON.stringify({ error: "Invalid document type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
  }
});

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

export type ShipmentLineItem = Omit<
  Database["public"]["Tables"]["shipmentLine"]["Insert"],
  "id" | "shipmentId" | "updatedBy" | "createdAt" | "updatedAt"
>;
