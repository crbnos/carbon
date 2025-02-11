import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";
import z from "https://deno.land/x/zod@v3.23.8/index.ts";
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
    type: z.literal("shipmentDefault"),
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
    type: z.literal("shipmentFromSalesOrder"),
    locationId: z.string(),
    salesOrderId: z.string(),
    shipmentId: z.string().optional(),
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
        if (!userId) throw new Error("Payload is missing userId");
        if (!companyId) throw new Error("Payload is missing companyId");

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
        if (!purchaseOrderId)
          throw new Error("Payload is missing purchaseOrderId");
        if (!userId) throw new Error("Payload is missing userId");
        if (!companyId) throw new Error("Payload is missing companyId");

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
        if (!userId) throw new Error("Payload is missing userId");
        if (!companyId) throw new Error("Payload is missing companyId");

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
        if (!salesOrderId) throw new Error("Payload is missing salesOrderId");
        if (!userId) throw new Error("Payload is missing userId");
        if (!companyId) throw new Error("Payload is missing companyId");

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
          opportunity,
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
            .eq("id", existingShipmentId)
            .maybeSingle(),
          client
            .from("shipment")
            .select("*")
            .eq("id", existingShipmentId)
            .maybeSingle(),
          client
            .from("opportunity")
            .select("*")
            .eq("salesOrderId", salesOrderId)
            .single(),
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

        const previouslyShippedQuantitiesByLine = (
          salesOrderLines.data ?? []
        ).reduce<Record<string, number>>((acc, d) => {
          if (d.id) acc[d.id] = d.quantitySent ?? 0;
          return acc;
        }, {});

        const shipmentLineItems = salesOrderLines.data.reduce<
          ShipmentLineItem[]
        >((acc, d) => {
          if (
            !d.itemId ||
            !d.saleQuantity ||
            d.unitPrice === null ||
            d.salesOrderLineType === "Service" ||
            isNaN(d.unitPrice)
          ) {
            return acc;
          }

          const outstandingQuantity =
            (d.saleQuantity ?? 0) -
            (previouslyShippedQuantitiesByLine[d.id!] ?? 0);

          const shippingAndTaxUnitCost =
            (d.shippingCost / d.saleQuantity + d.unitPrice) *
            (1 + d.taxPercent);

          acc.push({
            lineId: d.id,
            companyId: companyId,
            itemId: d.itemId,
            itemReadableId: d.itemReadableId,
            orderQuantity: d.saleQuantity,
            outstandingQuantity: outstandingQuantity,
            shippedQuantity: outstandingQuantity,
            requiresSerialTracking: serializedItems.has(d.itemId),
            requiresBatchTracking: batchItems.has(d.itemId),
            unitPrice: shippingAndTaxUnitCost,
            unitOfMeasure: d.unitOfMeasureCode ?? "EA",
            locationId: d.locationId,
            shelfId: d.shelfId,
            createdBy: userId ?? "",
          });

          return acc;
        }, []);

        if (shipmentLineItems.length === 0) {
          throw new Error("No valid shipment line items found");
        }

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
                opportunityId: opportunity.data?.id,
                companyId: companyId,
                locationId: locationId,
                createdBy: userId,
              })
              .returning(["id", "shipmentId"])
              .execute();

            shipmentId = newShipment?.[0]?.id!;
            shipmentIdReadable = newShipment?.[0]?.shipmentId!;
          }

          if (shipmentLineItems.length > 0) {
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
