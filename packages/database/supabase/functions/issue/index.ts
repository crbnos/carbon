import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  type: z.enum(["jobOperation"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const { type, id, companyId, userId } = payloadValidator.parse(payload);

    console.log({
      function: "issue",
      type,
      id,
      companyId,
      userId,
    });

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    switch (type) {
      case "jobOperation": {
        await db.transaction().execute(async (trx) => {
          const materialsToIssue = await trx
            .selectFrom("jobMaterial")
            .where("jobOperationId", "=", id)
            .where("quantityToIssue", ">", 0)
            .where("itemType", "in", ["Material", "Part", "Consumable"])
            .where("methodType", "!=", "Make")
            .selectAll()
            .execute();

          if (materialsToIssue.length > 0) {
            const itemIds = new Set(
              materialsToIssue.map((material) => material.itemId)
            );
            const itemIdsWithDefaultShelf = new Set(
              materialsToIssue
                .filter((material) => material.defaultShelf)
                .map((material) => material.itemId)
            );

            const jobId = materialsToIssue[0].jobId;

            const [job, items] = await Promise.all([
              trx
                .selectFrom("job")
                .where("id", "=", jobId)
                .select("locationId")
                .executeTakeFirst(),
              trx
                .selectFrom("item")
                .where("id", "in", Array.from(itemIds))
                .select(["id", "item.itemTrackingType"])
                .execute(),
            ]);

            if (!job?.locationId) {
              throw new Error("Job location is required");
            }

            const pickMethods = await trx
              .selectFrom("pickMethod")
              .select(["itemId", "defaultShelfId"])
              .where("itemId", "in", Array.from(itemIdsWithDefaultShelf))
              .where("locationId", "=", job?.locationId!)
              .where("companyId", "=", companyId)
              .execute();

            const shelfIdsToUse = new Map(
              pickMethods.map((pickMethod) => [
                pickMethod.itemId,
                pickMethod.defaultShelfId,
              ])
            );

            const itemIdIsTracked = new Map(
              items.map((item) => [
                item.id,
                item.itemTrackingType === "Inventory",
              ])
            );

            for await (const material of materialsToIssue) {
              if (material.quantityToIssue) {
                if (itemIdIsTracked.get(material.itemId)) {
                  itemLedgerInserts.push({
                    entryType: "Consumption",
                    documentType: "Job Consumption",
                    documentId: jobId,
                    documentLineId: id,
                    companyId,
                    itemId: material.itemId,
                    itemReadableId: material.itemReadableId,
                    quantity: -Number(material.quantityToIssue),
                    locationId: job?.locationId,
                    shelfId: material.defaultShelf
                      ? shelfIdsToUse.get(material.itemId)
                      : material.shelfId,
                    createdBy: userId,
                  });
                }

                await trx
                  .updateTable("jobMaterial")
                  .set({
                    quantityIssued:
                      (Number(material.quantityIssued) ?? 0) +
                      Number(material.quantityToIssue),
                  })
                  .where("id", "=", material.id)
                  .execute();
              }
            }

            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }
        });

        break;
      }

      default:
        throw new Error(`Invalid type  ${type}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
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
