import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { format } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { invoiceId } = await req.json();

  try {
    if (!invoiceId) throw new Error("Payload is missing invoiceId");

    const client = getSupabaseServiceRole(req.headers.get("Authorization"));

    const [purchaseInvoice, purchaseInvoiceLines] = await Promise.all([
      client.from("purchaseInvoice").select("*").eq("id", invoiceId).single(),
      client.from("purchaseInvoiceLine").select("*").eq("invoiceId", invoiceId),
    ]);

    if (purchaseInvoice.error)
      throw new Error("Failed to fetch purchaseInvoice");
    if (purchaseInvoiceLines.error)
      throw new Error("Failed to fetch receipt lines");

    const itemIds = purchaseInvoiceLines.data
      .filter((line) => Boolean(line.itemId))
      .map((line) => line.itemId);

    const dateOneYearAgo = format(
      new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
      "yyyy-MM-dd"
    );

    const companyId = purchaseInvoice.data.companyId;

    const [costLedgers, itemSuppliers] = await Promise.all([
      client
        .from("costLedger")
        .select("*")
        .in("itemId", itemIds)
        .eq("companyId", companyId)
        .gte("postingDate", dateOneYearAgo),
      client
        .from("itemSupplier")
        .select("*")

        .eq("supplierId", purchaseInvoice.data?.supplierId ?? "")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
    ]);

    const itemCostUpdates: Database["public"]["Tables"]["itemCost"]["Update"][] =
      [];
    const itemSupplierInserts: Database["public"]["Tables"]["itemSupplier"]["Insert"][] =
      [];
    const itemSupplierUpdates: Database["public"]["Tables"]["itemSupplier"]["Update"][] =
      [];

    const historicalPartCosts: Record<
      string,
      { quantity: number; cost: number }
    > = {};

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

    purchaseInvoiceLines.data.forEach((line) => {
      if (line.itemId && historicalPartCosts[line.itemId]) {
        itemCostUpdates.push({
          itemId: line.itemId,
          unitCost:
            historicalPartCosts[line.itemId].cost /
            historicalPartCosts[line.itemId].quantity,
          updatedBy: "system",
        });

        const itemSupplier = itemSuppliers.data?.find(
          (itemSupplier) =>
            itemSupplier.itemId === line.itemId &&
            itemSupplier.supplierId === purchaseInvoice.data?.supplierId
        );

        if (itemSupplier && itemSupplier.id) {
          itemSupplierUpdates.push({
            id: itemSupplier.id,
            unitPrice: line.unitPrice,
            conversionFactor: line.conversionFactor ?? 1,
            supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            updatedBy: "system",
          });
        } else {
          itemSupplierInserts.push({
            itemId: line.itemId,
            supplierId: purchaseInvoice.data?.supplierId!,
            unitPrice: line.unitPrice,
            conversionFactor: line.conversionFactor ?? 1,
            supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            createdBy: "system",
            companyId,
          });
        }
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

      if (itemSupplierInserts.length > 0) {
        await trx
          .insertInto("itemSupplier")
          .values(itemSupplierInserts)
          .execute();
      }

      if (itemSupplierUpdates.length > 0) {
        for await (const itemSupplierUpdate of itemSupplierUpdates) {
          await trx
            .updateTable("itemSupplier")
            .set(itemSupplierUpdate)
            .where("id", "=", itemSupplierUpdate.id!)
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
