import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { corsHeaders } from "../lib/headers.ts";
import { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("jobOperation"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("partToOperation"),
    id: z.string(),
    itemId: z.string(),
    quantity: z.number(),
    adjustmentType: z.enum([
      "Set Quantity",
      "Positive Adjmt.",
      "Negative Adjmt.",
    ]),
    materialId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobComplete"),
    jobId: z.string(),
    quantityComplete: z.number(),
    shelfId: z.string().optional(),
    locationId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);

    console.log({
      function: "issue",
      ...validatedPayload,
    });

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    switch (validatedPayload.type) {
      case "jobOperation": {
        const { id, companyId, userId } = validatedPayload;
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

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();
            }
          }
        });

        break;
      }
      case "partToOperation": {
        const {
          id,
          companyId,
          userId,
          itemId,
          quantity,
          materialId,
          adjustmentType,
        } = validatedPayload;
        await db.transaction().execute(async (trx) => {
          const jobOperation = await trx
            .selectFrom("jobOperation")
            .where("id", "=", id)
            .select(["jobId", "jobMakeMethodId"])
            .executeTakeFirst();

          const [job, item] = await Promise.all([
            trx
              .selectFrom("job")
              .where("id", "=", jobOperation?.jobId!)
              .select("locationId")
              .executeTakeFirst(),
            trx
              .selectFrom("item")
              .where("id", "=", itemId)
              .select(["id", "itemTrackingType", "name", "readableId", "type"])
              .executeTakeFirst(),
          ]);

          if (materialId) {
            const [material, pickMethod] = await Promise.all([
              trx
                .selectFrom("jobMaterial")
                .where("id", "=", materialId)
                .selectAll()
                .executeTakeFirst(),
              trx
                .selectFrom("pickMethod")
                .where("itemId", "=", itemId)
                .where("locationId", "=", job?.locationId!)
                .select("defaultShelfId")
                .executeTakeFirst(),
            ]);

            const quantityToIssue =
              adjustmentType === "Positive Adjmt."
                ? Number(quantity)
                : adjustmentType === "Negative Adjmt."
                ? -Number(quantity)
                : Number(quantity) - Number(material?.quantityIssued); // set quantity

            console.log({ quantityToIssue });

            if (
              material?.methodType !== "Make" &&
              item?.itemTrackingType === "Inventory"
            ) {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: material?.jobId,
                documentLineId: id,
                companyId,
                itemId: material?.itemId!,
                locationId: job?.locationId,
                shelfId: material?.defaultShelf
                  ? pickMethod?.defaultShelfId
                  : material?.shelfId,
                quantity: -Number(quantityToIssue),
                createdBy: userId,
              });
            }

            await trx
              .updateTable("jobMaterial")
              .set({
                quantityIssued:
                  (Number(material?.quantityIssued) ?? 0) +
                  Number(quantityToIssue),
              })
              .where("id", "=", materialId)
              .execute();

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();
            }
          } else {
            if (item?.itemTrackingType === "Inventory") {
              const pickMethod = await trx
                .selectFrom("pickMethod")
                .where("itemId", "=", itemId)
                .where("locationId", "=", job?.locationId!)
                .select("defaultShelfId")
                .executeTakeFirst();

              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: jobOperation?.jobId,
                documentLineId: id,
                companyId,
                itemId: itemId!,
                quantity: -Number(quantity ?? 0),
                locationId: job?.locationId,
                shelfId: pickMethod?.defaultShelfId,
                createdBy: userId,
              });
            }

            const [itemCost, pickMethod] = await Promise.all([
              trx
                .selectFrom("itemCost")
                .where("itemId", "=", itemId!)
                .select("unitCost")
                .executeTakeFirst(),
              trx
                .selectFrom("pickMethod")
                .where("itemId", "=", itemId!)
                .where("locationId", "=", job?.locationId!)
                .select("defaultShelfId")
                .executeTakeFirst(),
            ]);

            await trx
              .insertInto("jobMaterial")
              .values({
                // @ts-ignore // not sure why ts is complaining here
                companyId,
                createdBy: userId,
                description: item?.name,
                estimatedQuantity: 0,
                itemId: itemId!,
                itemReadableId: item?.readableId,
                itemType: item?.type,
                jobId: jobOperation?.jobId!,
                jobMakeMethodId: jobOperation?.jobMakeMethodId,
                jobOperationId: id,
                shelfId: pickMethod?.defaultShelfId,
                methodType: "Pick",
                quantity: 0,
                quantityIssued: Number(quantity ?? 0),
                unitCost: itemCost?.unitCost,
              })
              .executeTakeFirst();

            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();
            }
          }
        });
        break;
      }
      case "jobComplete": {
        const {
          jobId,
          quantityComplete,
          shelfId,
          locationId,
          companyId,
          userId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const job = await trx
            .selectFrom("job")
            .where("id", "=", jobId)
            .select(["itemId", "quantityReceivedToInventory"])
            .executeTakeFirst();

          const item = await trx
            .selectFrom("item")
            .where("id", "=", job?.itemId!)
            .select(["readableId"])
            .executeTakeFirst();

          const quantityReceivedToInventory =
            quantityComplete - (job?.quantityReceivedToInventory ?? 0);

          await trx
            .updateTable("job")
            .set({
              status: "Completed" as const,
              quantityComplete,
              quantityReceivedToInventory,
              updatedAt: new Date().toISOString(),
              updatedBy: userId,
            })
            .where("id", "=", jobId)
            .execute();

          itemLedgerInserts.push({
            entryType: "Assembly Output",
            documentType: "Job Receipt",
            documentId: jobId,
            companyId,
            itemId: job?.itemId!,
            itemReadableId: item?.readableId,
            quantity: quantityReceivedToInventory,
            locationId,
            shelfId,
            createdBy: userId,
          });

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }
        });

        break;
      }
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
