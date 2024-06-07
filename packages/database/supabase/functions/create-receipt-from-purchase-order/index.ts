import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { getNextSequence } from "../shared/get-next-sequence.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

export type ReceiptLineItem = Omit<
  Database["public"]["Tables"]["receiptLine"]["Insert"],
  "id" | "receiptId" | "updatedBy" | "createdAt" | "updatedAt"
>;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const {
    companyId,
    locationId,
    purchaseOrderId,
    receiptId: existingReceiptId,
    userId,
  } = await req.json();

  try {
    if (!purchaseOrderId) throw new Error("Payload is missing purchaseOrderId");
    if (!userId) throw new Error("Payload is missing userId");
    if (!companyId) throw new Error("Payload is missing companyId");

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

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
        .eq("purchaseOrderLineType", "Part")
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

    const hasReceipt = !!receipt.data?.id;

    const previouslyReceivedQuantitiesByLine = (
      purchaseOrderLines.data ?? []
    ).reduce<Record<string, number>>((acc, d) => {
      if (d.id) acc[d.id] = d.quantityReceived ?? 0;
      return acc;
    }, {});

    const receiptLineItems = purchaseOrderLines.data.reduce<ReceiptLineItem[]>(
      (acc, d) => {
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
          d.purchaseQuantity - (previouslyReceivedQuantitiesByLine[d.id!] ?? 0);

        acc.push({
          lineId: d.id,
          companyId: companyId,
          itemId: d.itemId,
          itemReadableId: d.itemReadableId,
          orderQuantity: d.purchaseQuantity * (d.conversionFactor ?? 1),
          outstandingQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
          receivedQuantity: outstandingQuantity * (d.conversionFactor ?? 1),
          conversionFactor: d.conversionFactor ?? 1,
          unitPrice: d.unitPrice / (d.conversionFactor ?? 1),
          unitOfMeasure: d.inventoryUnitOfMeasureCode ?? "EA",
          locationId: d.locationId,
          shelfId: d.shelfId,
          createdBy: userId ?? "",
        });

        return acc;
      },
      []
    );

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
        receiptIdReadable = await getNextSequence(trx, "receipt", companyId);
        const newReceipt = await trx
          .insertInto("receipt")
          .values({
            receiptId: receiptIdReadable,
            sourceDocument: "Purchase Order",
            sourceDocumentId: purchaseOrder.data.id,
            sourceDocumentReadableId: purchaseOrder.data.purchaseOrderId,
            companyId: companyId,
            locationId: locationId,
            createdBy: userId,
          })
          .returning(["id", "receiptId"])
          .execute();

        receiptId = newReceipt?.[0]?.id!;
        receiptIdReadable = newReceipt?.[0]?.receiptId!;
      }

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
});
