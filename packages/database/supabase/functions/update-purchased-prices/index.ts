import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { format } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import z from "npm:zod@^3.24.1";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("purchaseOrder"),
    purchaseOrderId: z.string(),
    companyId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional(),
  }),
  z.object({
    source: z.literal("purchaseInvoice"),
    invoiceId: z.string(),
    companyId: z.string(),
    updatePrices: z.boolean().optional(),
    updateLeadTimes: z.boolean().optional(),
  }),
]);

interface PurchaseLineData {
  itemId: string | null;
  jobOperationId: string | null;
  unitPrice: number;
  quantity: number;
  conversionFactor: number | null;
  purchaseUnitOfMeasureCode: string | null;
}

const millisecondsInADay = 1000 * 60 * 60 * 24;

const calculateLeadTimeInDays = (
  orderDate: string,
  deliveryDate: string
): number => {
  const orderDateTime = new Date(`${orderDate}T00:00:00Z`).getTime();
  const deliveryDateTime = new Date(`${deliveryDate}T00:00:00Z`).getTime();

  if (isNaN(orderDateTime) || isNaN(deliveryDateTime)) return 0;

  return Math.max(0, (deliveryDateTime - orderDateTime) / millisecondsInADay);
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();
  const parsedPayload = payloadValidator.parse(payload);
  const { source, companyId } = parsedPayload;
  const shouldUpdatePrices = parsedPayload.updatePrices ?? true;
  const shouldUpdateLeadTimes = parsedPayload.updateLeadTimes ?? false;

  console.log({
    function: "update-purchased-prices",
    source,
    companyId,
    shouldUpdatePrices,
    shouldUpdateLeadTimes,
  });

  try {
    const client = await getSupabaseServiceRole(
      req.headers.get("Authorization"),
      req.headers.get("carbon-key"),
      companyId
    );

    let supplierId: string;
    let lines: PurchaseLineData[];

    switch (source) {
      case "purchaseOrder": {
        const { purchaseOrderId } = parsedPayload;

        console.log({
          function: "update-purchased-prices",
          source,
          purchaseOrderId,
          companyId,
        });

        const [purchaseOrder, purchaseOrderLines] = await Promise.all([
          client
            .from("purchaseOrder")
            .select("*")
            .eq("id", purchaseOrderId)
            .single(),
          client
            .from("purchaseOrderLine")
            .select("*")
            .eq("purchaseOrderId", purchaseOrderId),
        ]);

        if (purchaseOrder.error)
          throw new Error("Failed to fetch purchaseOrder");
        if (purchaseOrderLines.error)
          throw new Error("Failed to fetch purchase order lines");
        if (!purchaseOrder.data.supplierId)
          throw new Error("Purchase order has no supplier");

        supplierId = purchaseOrder.data.supplierId;
        lines = purchaseOrderLines.data
          .map((line) => ({
            itemId: line.itemId,
            jobOperationId: null,
            unitPrice: line.unitPrice ?? 0,
            quantity: (line.purchaseQuantity ?? 0) * (line.conversionFactor ?? 1),
            conversionFactor: line.conversionFactor,
            purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
          }))
          .filter((line) => line.quantity > 0);

        if (shouldUpdatePrices) {
          // Delete any existing cost ledger entries for this PO (handles re-finalization)
          await db
            .deleteFrom("costLedger")
            .where("documentType", "=", "Purchase Order")
            .where("documentId", "=", purchaseOrderId)
            .where("companyId", "=", companyId)
            .execute();

          // Create new cost ledger entries for each line item
          const costLedgerInserts = lines
            .filter((line) => line.itemId && line.unitPrice !== 0)
            .map((line) => ({
              itemLedgerType: "Purchase" as const,
              costLedgerType: "Direct Cost" as const,
              adjustment: false,
              documentType: "Purchase Order" as const,
              documentId: purchaseOrderId,
              itemId: line.itemId!,
              quantity: line.quantity,
              cost: line.quantity * line.unitPrice,
              supplierId,
              companyId,
            }));

          if (costLedgerInserts.length > 0) {
            await db.insertInto("costLedger").values(costLedgerInserts).execute();
          }
        }

        break;
      }

      case "purchaseInvoice": {
        const { invoiceId } = parsedPayload;

        console.log({
          function: "update-purchased-prices",
          source,
          invoiceId,
          companyId,
        });

        const [purchaseInvoice, purchaseInvoiceLines] = await Promise.all([
          client
            .from("purchaseInvoice")
            .select("*")
            .eq("id", invoiceId)
            .single(),
          client
            .from("purchaseInvoiceLine")
            .select("*")
            .eq("invoiceId", invoiceId),
        ]);

        if (purchaseInvoice.error)
          throw new Error("Failed to fetch purchaseInvoice");
        if (purchaseInvoiceLines.error)
          throw new Error("Failed to fetch invoice lines");
        if (!purchaseInvoice.data.supplierId)
          throw new Error("Purchase invoice has no supplier");

        supplierId = purchaseInvoice.data.supplierId;
        lines = purchaseInvoiceLines.data
          .map((line) => ({
            itemId: line.itemId,
            jobOperationId: line.jobOperationId,
            unitPrice: line.unitPrice ?? 0,
            quantity: (line.quantity ?? 0) * (line.conversionFactor ?? 1),
            conversionFactor: line.conversionFactor,
            purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
          }))
          .filter((line) => line.quantity > 0);
        break;
      }
    }

    const itemIds = Array.from(
      new Set(
        lines
          .filter((line) => Boolean(line.itemId))
          .map((line) => line.itemId as string)
      )
    );

    const dateOneYearAgo = format(
      new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
      "yyyy-MM-dd"
    );

    const itemCostUpdates: Database["public"]["Tables"]["itemCost"]["Update"][] =
      [];
    const itemReplenishmentUpdates: Database["public"]["Tables"]["itemReplenishment"]["Update"][] =
      [];
    const supplierPartInserts: Database["public"]["Tables"]["supplierPart"]["Insert"][] =
      [];
    const supplierPartUpdates: Database["public"]["Tables"]["supplierPart"]["Update"][] =
      [];

    const jobOperationUpdates: Database["public"]["Tables"]["jobOperation"]["Update"][] =
      [];

    const historicalPartCosts: Record<
      string,
      { quantity: number; cost: number }
    > = {};
    const historicalPartLeadTimes: Record<
      string,
      { quantity: number; weightedLeadTime: number }
    > = {};

    let supplierPartRows: Database["public"]["Tables"]["supplierPart"]["Row"][] =
      [];

    if (shouldUpdatePrices && itemIds.length > 0) {
      const [costLedgers, supplierParts] = await Promise.all([
        client
          .from("costLedger")
          .select("*")
          .in("itemId", itemIds)
          .eq("companyId", companyId)
          .gte("postingDate", dateOneYearAgo),
        client
          .from("supplierPart")
          .select("*")
          .eq("supplierId", supplierId)
          .in("itemId", itemIds)
          .eq("companyId", companyId),
      ]);

      if (costLedgers.error) {
        throw new Error("Failed to fetch historical cost ledger entries");
      }
      if (supplierParts.error) {
        throw new Error("Failed to fetch supplier parts");
      }

      supplierPartRows = supplierParts.data ?? [];

      costLedgers.data?.forEach((ledger) => {
        if (ledger.itemId) {
          if (!historicalPartCosts[ledger.itemId]) {
            historicalPartCosts[ledger.itemId] = {
              quantity: 0,
              cost: 0,
            };
          }

          historicalPartCosts[ledger.itemId].quantity += ledger.quantity;
          historicalPartCosts[ledger.itemId].cost += ledger.cost;
        }
      });
    }

    if (shouldUpdateLeadTimes && itemIds.length > 0) {
      const receipts = await client
        .from("receipt")
        .select("id,postingDate,sourceDocumentId")
        .eq("companyId", companyId)
        .eq("sourceDocument", "Purchase Order")
        .not("postingDate", "is", null)
        .gte("postingDate", dateOneYearAgo);

      if (receipts.error) {
        throw new Error("Failed to fetch historical receipts");
      }

      const receiptIds = receipts.data?.map((receipt) => receipt.id) ?? [];
      const purchaseOrderIds = Array.from(
        new Set(
          (receipts.data ?? [])
            .map((receipt) => receipt.sourceDocumentId)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (receiptIds.length > 0 && purchaseOrderIds.length > 0) {
        const [receiptLines, purchaseOrders] = await Promise.all([
          client
            .from("receiptLine")
            .select("receiptId,itemId,receivedQuantity,conversionFactor")
            .in("receiptId", receiptIds)
            .in("itemId", itemIds)
            .eq("companyId", companyId),
          client
            .from("purchaseOrder")
            .select("id,orderDate")
            .in("id", purchaseOrderIds)
            .eq("companyId", companyId),
        ]);

        if (receiptLines.error) {
          throw new Error("Failed to fetch historical receipt lines");
        }
        if (purchaseOrders.error) {
          throw new Error("Failed to fetch historical purchase orders");
        }

        const receiptsById = (receipts.data ?? []).reduce<
          Record<string, { postingDate: string; sourceDocumentId: string | null }>
        >((acc, receipt) => {
          if (receipt.postingDate) {
            acc[receipt.id] = {
              postingDate: receipt.postingDate,
              sourceDocumentId: receipt.sourceDocumentId,
            };
          }
          return acc;
        }, {});

        const purchaseOrdersById = purchaseOrders.data.reduce<
          Record<string, { orderDate: string | null }>
        >((acc, row) => {
          acc[row.id] = { orderDate: row.orderDate };
          return acc;
        }, {});

        receiptLines.data.forEach((line) => {
          if (!line.itemId) return;

          const receipt = receiptsById[line.receiptId];
          if (!receipt?.sourceDocumentId) return;

          const orderDate =
            purchaseOrdersById[receipt.sourceDocumentId]?.orderDate;
          if (!orderDate || !receipt.postingDate) return;

          const safeConversionFactor =
            line.conversionFactor && line.conversionFactor > 0
              ? line.conversionFactor
              : 1;
          const quantity = Math.abs(
            (line.receivedQuantity ?? 0) / safeConversionFactor
          );
          if (quantity <= 0) return;

          const leadTimeInDays = calculateLeadTimeInDays(
            orderDate,
            receipt.postingDate
          );

          if (!historicalPartLeadTimes[line.itemId]) {
            historicalPartLeadTimes[line.itemId] = {
              quantity: 0,
              weightedLeadTime: 0,
            };
          }

          historicalPartLeadTimes[line.itemId].quantity += quantity;
          historicalPartLeadTimes[line.itemId].weightedLeadTime +=
            leadTimeInDays * quantity;
        });
      }
    }

    lines.forEach((line) => {
      if (line.itemId && !line.jobOperationId) {
        const costHistory = historicalPartCosts[line.itemId];
        const hasLeadTimeHistory =
          (historicalPartLeadTimes[line.itemId]?.quantity ?? 0) > 0;

        if (shouldUpdatePrices && line.unitPrice !== 0 && costHistory) {
          itemCostUpdates.push({
            itemId: line.itemId,
            unitCost: costHistory.cost / costHistory.quantity,
            updatedBy: "system",
          });

          const supplierPart = supplierPartRows.find(
            (sp) => sp.itemId === line.itemId && sp.supplierId === supplierId
          );

          if (supplierPart && supplierPart.id) {
            supplierPartUpdates.push({
              id: supplierPart.id,
              unitPrice: line.unitPrice,
              conversionFactor: line.conversionFactor ?? 1,
              supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
              updatedBy: "system",
            });
          } else {
            supplierPartInserts.push({
              itemId: line.itemId,
              supplierId: supplierId,
              unitPrice: line.unitPrice,
              conversionFactor: line.conversionFactor ?? 1,
              supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
              createdBy: "system",
              companyId,
            });
          }
        }

        if (shouldUpdatePrices || (shouldUpdateLeadTimes && hasLeadTimeHistory)) {
          const itemReplenishmentUpdate: Database["public"]["Tables"]["itemReplenishment"]["Update"] =
            {
              itemId: line.itemId,
              updatedBy: "system",
            };

          if (shouldUpdatePrices) {
            itemReplenishmentUpdate.preferredSupplierId = supplierId;
            itemReplenishmentUpdate.purchasingUnitOfMeasureCode =
              line.purchaseUnitOfMeasureCode;
            itemReplenishmentUpdate.conversionFactor =
              line.conversionFactor ?? 1;
          }

          if (shouldUpdateLeadTimes && hasLeadTimeHistory) {
            itemReplenishmentUpdate.leadTime = Math.round(
              historicalPartLeadTimes[line.itemId].weightedLeadTime /
                historicalPartLeadTimes[line.itemId].quantity
            );
          }

          itemReplenishmentUpdates.push(itemReplenishmentUpdate);
        }
      }

      if (shouldUpdatePrices && line.jobOperationId && line.unitPrice !== 0) {
        jobOperationUpdates.push({
          id: line.jobOperationId,
          operationMinimumCost: 0,
          operationUnitCost: line.unitPrice ?? 0,
          updatedBy: "system",
        });
      }
    });

    await db.transaction().execute(async (trx) => {
      if (itemCostUpdates.length > 0) {
        for await (const itemCostUpdate of itemCostUpdates) {
          await trx
            .updateTable("itemCost")
            .set(itemCostUpdate)
            .where("itemId", "=", itemCostUpdate.itemId!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (jobOperationUpdates.length > 0) {
        for await (const jobOperationUpdate of jobOperationUpdates) {
          await trx
            .updateTable("jobOperation")
            .set(jobOperationUpdate)
            .where("id", "=", jobOperationUpdate.id!)
            .where("companyId", "=", companyId)
            .execute();
        }
      }

      if (supplierPartInserts.length > 0) {
        await trx
          .insertInto("supplierPart")
          .values(supplierPartInserts)
          .onConflict((oc) =>
            oc.columns(["itemId", "supplierId", "companyId"]).doUpdateSet({
              unitPrice: (eb) => eb.ref("excluded.unitPrice"),
              conversionFactor: (eb) => eb.ref("excluded.conversionFactor"),
              supplierUnitOfMeasureCode: (eb) =>
                eb.ref("excluded.supplierUnitOfMeasureCode"),
              updatedBy: "system",
            })
          )
          .execute();
      }

      if (supplierPartUpdates.length > 0) {
        for await (const supplierPartUpdate of supplierPartUpdates) {
          await trx
            .updateTable("supplierPart")
            .set(supplierPartUpdate)
            .where("id", "=", supplierPartUpdate.id!)
            .execute();
        }
      }

      if (itemReplenishmentUpdates.length > 0) {
        for await (const itemReplenishmentUpdate of itemReplenishmentUpdates) {
          await trx
            .updateTable("itemReplenishment")
            .set(itemReplenishmentUpdate)
            .where("itemId", "=", itemReplenishmentUpdate.itemId!)
            .execute();
        }
      }
    });

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
