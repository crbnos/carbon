import { serve } from "https://deno.land/std@0.175.0/http/server.ts";

import { format } from "https://deno.land/std@0.160.0/datetime/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRoleFromAuthorizationHeader } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { invoiceId } = await req.json();

  console.log({
    function: "update-purchased-prices",
    invoiceId,
  });

  try {
    if (!invoiceId) throw new Error("Payload is missing invoiceId");

    const client = getSupabaseServiceRoleFromAuthorizationHeader(
      req.headers.get("Authorization")
    );

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

    const [costLedgers, buyMethods] = await Promise.all([
      client
        .from("costLedger")
        .select("*")
        .in("itemId", itemIds)
        .eq("companyId", companyId)
        .gte("postingDate", dateOneYearAgo),
      client
        .from("buyMethod")
        .select("*")

        .eq("supplierId", purchaseInvoice.data?.supplierId ?? "")
        .in("itemId", itemIds)
        .eq("companyId", companyId),
    ]);

    const itemCostUpdates: Database["public"]["Tables"]["itemCost"]["Update"][] =
      [];
    const buyMethodInserts: Database["public"]["Tables"]["buyMethod"]["Insert"][] =
      [];
    const buyMethodUpdates: Database["public"]["Tables"]["buyMethod"]["Update"][] =
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

        const buyMethod = buyMethods.data?.find(
          (buyMethod) =>
            buyMethod.itemId === line.itemId &&
            buyMethod.supplierId === purchaseInvoice.data?.supplierId
        );

        if (buyMethod && buyMethod.id) {
          buyMethodUpdates.push({
            id: buyMethod.id,
            unitPrice: line.unitPrice,
            conversionFactor: line.conversionFactor ?? 1,
            supplierUnitOfMeasureCode: line.purchaseUnitOfMeasureCode,
            updatedBy: "system",
          });
        } else {
          buyMethodInserts.push({
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

      if (buyMethodInserts.length > 0) {
        await trx.insertInto("buyMethod").values(buyMethodInserts).execute();
      }

      if (buyMethodUpdates.length > 0) {
        for await (const buyMethodUpdate of buyMethodUpdates) {
          await trx
            .updateTable("buyMethod")
            .set(buyMethodUpdate)
            .where("id", "=", buyMethodUpdate.id!)
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
