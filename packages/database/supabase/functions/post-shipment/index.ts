import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

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

  console.log(payload);
  console.log(payloadValidator.safeParse(payload));

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
      client.from("shipmentLine").select("*").eq("shipmentId", shipmentId),
      client
        .from("itemTracking")
        .select(
          "id, quantity, sourceDocumentLineId, sourceDocument, serialNumber(id, number), batchNumber(id, number)"
        )
        .eq("sourceDocument", "Shipment")
        .eq("sourceDocumentId", shipmentId),
    ]);

    console.log({ shipmentLineTracking });

    if (shipment.error) throw new Error("Failed to fetch shipment");
    if (shipmentLines.error) throw new Error("Failed to fetch shipment lines");

    const itemIds = shipmentLines.data.reduce<string[]>((acc, shipmentLine) => {
      if (shipmentLine.itemId && !acc.includes(shipmentLine.itemId)) {
        acc.push(shipmentLine.itemId);
      }
      return acc;
    }, []);

    const [items, itemCosts] = await Promise.all([
      client
        .from("item")
        .select("id, itemTrackingType")
        .in("id", itemIds)
        .eq("companyId", companyId),
      client
        .from("itemCost")
        .select("itemId, itemPostingGroupId")
        .in("itemId", itemIds),
    ]);
    if (items.error) {
      throw new Error("Failed to fetch items");
    }
    if (itemCosts.error) {
      throw new Error("Failed to fetch item costs");
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

        const serialNumbersConsumed: string[] = [];

        const locationId = shipment.data.locationId;

        for await (const shipmentLine of shipmentLines.data) {
          const itemTrackingType =
            items.data.find((item) => item.id === shipmentLine.itemId)
              ?.itemTrackingType ?? "Inventory";

          console.log({ shipmentLine });

          if (itemTrackingType === "Inventory") {
            itemLedgerInserts.push({
              postingDate: today,
              itemId: shipmentLine.itemId,
              itemReadableId: shipmentLine.itemReadableId ?? "",
              quantity: -shipmentLine.shippedQuantity,
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
              itemReadableId: shipmentLine.itemReadableId ?? "",
              quantity: -shipmentLine.shippedQuantity,
              locationId: shipmentLine.locationId ?? locationId,
              shelfId: shipmentLine.shelfId, // TODO: get shelfId dynamically
              entryType: "Negative Adjmt.",
              documentType: "Sales Shipment",
              documentId: shipment.data?.id ?? undefined,
              batchNumber: shipmentLineTracking.data?.find(
                (tracking) =>
                  tracking.sourceDocument === "Shipment" &&
                  tracking.sourceDocumentLineId === shipmentLine.lineId
              )?.batchNumber?.number,
              externalDocumentId: undefined,
              createdBy: userId,
              companyId,
            });
          }

          if (shipmentLine.requiresSerialTracking) {
            const lineTracking = shipmentLineTracking.data?.filter(
              (tracking) =>
                tracking.sourceDocument === "Shipment" &&
                tracking.sourceDocumentLineId === shipmentLine.id
            );

            lineTracking?.forEach((tracking) => {
              itemLedgerInserts.push({
                postingDate: today,
                itemId: shipmentLine.itemId,
                itemReadableId: shipmentLine.itemReadableId ?? "",
                quantity: -1,
                locationId: shipmentLine.locationId ?? locationId,
                shelfId: shipmentLine.shelfId, // TODO: get shelfId dynamically
                entryType: "Negative Adjmt.",
                documentType: "Sales Shipment",
                documentId: shipment.data?.id ?? undefined,
                serialNumber: tracking.serialNumber?.number,
                externalDocumentId: undefined,
                createdBy: userId,
                companyId,
              });

              if (tracking.serialNumber?.id) {
                serialNumbersConsumed.push(tracking.serialNumber?.id);
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

        const itemTrackingUpdates =
          shipmentLineTracking.data?.reduce<
            Record<
              string,
              Database["public"]["Tables"]["itemTracking"]["Update"]
            >
          >((acc, itemTracking) => {
            const shipmentLine = shipmentLines.data?.find(
              (shipmentLine) =>
                shipmentLine.id === itemTracking.sourceDocumentLineId
            );

            const quantity = shipmentLine?.requiresSerialTracking
              ? 1
              : shipmentLine?.shippedQuantity ?? itemTracking.quantity;

            acc[itemTracking.id] = {
              posted: true,
              quantity: quantity,
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
            "To Ship";
          if (areAllLinesInvoiced && areAllLinesShipped) {
            status = "Completed";
          } else if (areAllLinesShipped) {
            status = "Completed"; // TODO: To Invoice
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

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .returning(["id"])
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

          if (Object.keys(itemTrackingUpdates).length > 0) {
            for await (const [id, update] of Object.entries(
              itemTrackingUpdates
            )) {
              await trx
                .updateTable("itemTracking")
                .set(update)
                .where("id", "=", id)
                .execute();
            }
          }

          if (serialNumbersConsumed.length > 0) {
            await trx
              .updateTable("serialNumber")
              .set({
                status: "Consumed",
              })
              .where("id", "in", serialNumbersConsumed)
              .execute();
          }
        });
        break;
      }
      default: {
        break;
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
