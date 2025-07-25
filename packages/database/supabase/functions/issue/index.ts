import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";

import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getSupabaseServiceRole } from "../lib/supabase.ts";
import { Database } from "../lib/types.ts";
import { TrackedEntityAttributes } from "../lib/utils.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("jobCompleteInventory"),
    jobId: z.string(),
    quantityComplete: z.number(),
    shelfId: z.string().optional(),
    locationId: z.string().optional(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobCompleteMakeToOrder"),
    jobId: z.string(),
    quantityComplete: z.number(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobOperation"),
    id: z.string(),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("jobOperationBatchComplete"),
    trackedEntityId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
  }),
  z.object({
    type: z.literal("jobOperationSerialComplete"),
    trackedEntityId: z.string(),
    companyId: z.string(),
    userId: z.string(),
    quantity: z.number(),
    jobOperationId: z.string(),
    notes: z.string().optional(),
    laborProductionEventId: z.string().optional(),
    machineProductionEventId: z.string().optional(),
    setupProductionEventId: z.string().optional(),
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
    type: z.literal("trackedEntitiesToOperation"),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number(),
      })
    ),
    companyId: z.string(),
    userId: z.string(),
  }),
  z.object({
    type: z.literal("unconsumeTrackedEntities"),
    materialId: z.string(),
    parentTrackedEntityId: z.string(),
    children: z.array(
      z.object({
        trackedEntityId: z.string(),
        quantity: z.number(),
      })
    ),
    companyId: z.string(),
    userId: z.string(),
  }),
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const payload = await req.json();
  console.log({ payload });

  try {
    const validatedPayload = payloadValidator.parse(payload);

    console.log({
      function: "issue",
      ...validatedPayload,
    });

    const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
      [];

    switch (validatedPayload.type) {
      case "jobCompleteInventory": {
        const {
          jobId,
          quantityComplete,
          shelfId,
          locationId,
          companyId,
          userId,
        } = validatedPayload;

        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        await db.transaction().execute(async (trx) => {
          const job = await trx
            .selectFrom("job")
            .where("id", "=", jobId)
            .select(["itemId", "quantityReceivedToInventory"])
            .executeTakeFirstOrThrow();

          const jobMakeMethod = await trx
            .selectFrom("jobMakeMethod")
            .where("jobId", "=", jobId)
            .where("parentMaterialId", "is", null)
            .selectAll()
            .executeTakeFirstOrThrow();

          const item = await trx
            .selectFrom("item")
            .where("id", "=", job?.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirstOrThrow();

          const quantityReceivedToInventory =
            quantityComplete - (job?.quantityReceivedToInventory ?? 0);

          await trx
            .updateTable("job")
            .set({
              status: "Completed" as const,
              completedDate: new Date().toISOString(),
              quantityComplete,
              quantityReceivedToInventory,
              updatedAt: new Date().toISOString(),
              updatedBy: userId,
            })
            .where("id", "=", jobId)
            .execute();

          if (jobMakeMethod.requiresBatchTracking) {
            const trackedEntity = await client
              .from("trackedEntity")
              .select("*")
              .eq("attributes->>Job Make Method", jobMakeMethod.id!)
              .single();

            if (!trackedEntity.data) {
              throw new Error("Tracked entity not found");
            }

            itemLedgerInserts.push({
              entryType: "Assembly Output",
              documentType: "Job Receipt",
              documentId: jobId,
              companyId,
              itemId: job?.itemId!,
              quantity: quantityReceivedToInventory,
              locationId,
              shelfId,
              trackedEntityId: trackedEntity.data.id,
              createdBy: userId,
            });
          } else if (jobMakeMethod.requiresSerialTracking) {
            const trackedEntities = await client
              .from("trackedEntity")
              .select("*")
              .eq("attributes->>Job Make Method", jobMakeMethod.id!)
              .neq("status", "Consumed");

            if (!trackedEntities.data) {
              throw new Error("Tracked entities not found");
            }

            // TODO: we probably need some user input for determining which entities go into inventory
            trackedEntities.data.forEach((trackedEntity) => {
              itemLedgerInserts.push({
                entryType: "Assembly Output",
                documentType: "Job Receipt",
                documentId: jobId,
                companyId,
                itemId: job?.itemId!,
                quantity: 1,
                locationId,
                shelfId,
                trackedEntityId: trackedEntity.id,
                createdBy: userId,
              });
            });

            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
              })
              .where(
                "id",
                "in",
                trackedEntities.data.map((trackedEntity) => trackedEntity.id)
              )
              .execute();
          } else {
            itemLedgerInserts.push({
              entryType: "Assembly Output",
              documentType: "Job Receipt",
              documentId: jobId,
              companyId,
              itemId: job?.itemId!,
              quantity: quantityReceivedToInventory,
              locationId,
              shelfId,
              createdBy: userId,
            });
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }
        });

        break;
      }
      case "jobOperation": {
        const { id, companyId, userId } = validatedPayload;
        await db.transaction().execute(async (trx) => {
          const materialsToIssue = await trx
            .selectFrom("jobMaterial")
            .where("jobOperationId", "=", id)
            .where("quantityToIssue", ">", 0)
            .where("itemType", "in", ["Material", "Part", "Consumable"])
            .where("methodType", "!=", "Make")
            .where("estimatedQuantity", ">", 0)
            .where("requiresBatchTracking", "=", false)
            .where("requiresSerialTracking", "=", false)
            .selectAll()
            .execute();

          const kittedChildren = await trx
            .selectFrom("jobMaterialWithMakeMethodId")
            .where("jobOperationId", "=", id)
            .where("itemType", "in", ["Material", "Part", "Consumable"])
            .where("methodType", "=", "Make")
            .where("kit", "=", true)
            .selectAll()
            .execute();

          const jobMakeMethodIdsOfKittedChildren = kittedChildren.map(
            (kittedChild) => kittedChild.jobMaterialMakeMethodId
          );

          if (jobMakeMethodIdsOfKittedChildren.length > 0) {
            const materialsToIssueFromKittedChildren = await trx
              .selectFrom("jobMaterial")
              .where("jobMakeMethodId", "in", jobMakeMethodIdsOfKittedChildren)
              .where("quantityToIssue", ">", 0)
              .where("itemType", "in", ["Material", "Part", "Consumable"])
              .where("methodType", "!=", "Make")
              .where("estimatedQuantity", ">", 0)
              .where("requiresBatchTracking", "=", false)
              .where("requiresSerialTracking", "=", false)
              .selectAll()
              .execute();

            materialsToIssue.push(...materialsToIssueFromKittedChildren);
          }

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
      case "jobOperationBatchComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const [jobOperation, productionQuantities] = await Promise.all([
          client
            .from("jobOperation")
            .select("*")
            .eq("id", row.jobOperationId)
            .single(),
          client
            .from("productionQuantity")
            .select("*")
            .eq("jobOperationId", row.jobOperationId)
            .eq("type", "Production"),
        ]);

        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new Error("Job operation not found");
        }

        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId,
            })
            .executeTakeFirst();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();

          if (!trackedEntity) {
            throw new Error("Tracked entity not found");
          }

          if (trackedEntity.status !== "Consumed") {
            const activityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: activityId,
                type: "Produce",
                sourceDocument: "Job Operation",
                sourceDocumentId: row.jobOperationId,
                attributes: {
                  "Job Operation": row.jobOperationId,
                  Employee: userId,
                  Quantity: row.quantity,
                },
                companyId,
                createdBy: userId,
              })
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values({
                trackedActivityId: activityId,
                trackedEntityId: trackedEntityId,
                quantity: row.quantity,
                companyId,
                createdBy: userId,
              })
              .execute();

            const previousProductionQuantities =
              productionQuantities?.data?.reduce((acc, curr) => {
                const quantity = Number(curr.quantity);
                return acc + quantity;
              }, 0) ?? 0;

            // Update the current trackedEntity to Complete
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                quantity: previousProductionQuantities + row.quantity,
              })
              .where("id", "=", trackedEntityId)
              .execute();
          }
        });

        return new Response(
          JSON.stringify({
            success: true,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      case "jobOperationSerialComplete": {
        const { trackedEntityId, companyId, userId, ...row } = validatedPayload;
        const client = await getSupabaseServiceRole(
          req.headers.get("Authorization"),
          req.headers.get("carbon-key") ?? "",
          companyId
        );

        const jobOperation = await client
          .from("jobOperation")
          .select("*")
          .eq("id", row.jobOperationId)
          .single();
        if (!jobOperation.data || !jobOperation.data.jobMakeMethodId) {
          throw new Error("Job operation not found");
        }

        const trackedEntities = await client
          .from("trackedEntity")
          .select("*")
          .eq("attributes->>Job Make Method", jobOperation.data.jobMakeMethodId)
          .order("createdAt", { ascending: true });

        if (!trackedEntities.data || trackedEntities.data.length === 0) {
          throw new Error("Tracked entities not found");
        }

        const relatedTrackedEntities = trackedEntities.data.filter(
          (trackedEntity) =>
            `Operation ${row.jobOperationId}` in
            (trackedEntity.attributes as TrackedEntityAttributes)
        );

        let newEntityId: string | undefined;
        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto("productionQuantity")
            .values({
              ...row,
              type: "Production",
              companyId,
              createdBy: userId,
            })
            .executeTakeFirst();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();

          if (!trackedEntity) {
            throw new Error("Tracked entity not found");
          }

          if (trackedEntity.status !== "Consumed") {
            // const activityId = nanoid();
            // await trx
            //   .insertInto("trackedActivity")
            //   .values({
            //     id: activityId,
            //     type: "Complete",
            //     sourceDocument: "Job Operation",
            //     sourceDocumentId: row.jobOperationId,
            //     attributes: {
            //       "Job Operation": row.jobOperationId,
            //       Employee: userId,
            //     },
            //     companyId,
            //     createdBy: userId,
            //   })
            //   .execute();

            // await trx
            //   .insertInto("trackedActivityOutput")
            //   .values({
            //     trackedActivityId: activityId,
            //     trackedEntityId: trackedEntityId,
            //     quantity: 1,
            //     companyId,
            //     createdBy: userId,
            //   })
            //   .execute();
            // Update the current trackedEntity to Complete
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                quantity: 1,
                attributes: {
                  ...(trackedEntity.attributes as TrackedEntityAttributes),
                  [`Operation ${row.jobOperationId}`]:
                    relatedTrackedEntities.length + 1,
                },
              })
              .where("id", "=", trackedEntityId)
              .execute();
          }

          if (
            trackedEntities.data.length <
            (jobOperation.data.operationQuantity ?? 0)
          ) {
            // Create a new trackedEntity with the same attributes but status = Reserved
            const newTrackedEntityResult = await trx
              .insertInto("trackedEntity")
              .values({
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                quantity: 1,
                status: "Reserved",
                attributes: trackedEntity.attributes,
                companyId,
                createdBy: userId,
              })
              .returning(["id"])
              .executeTakeFirst();

            newEntityId = newTrackedEntityResult?.id;
          }
        });

        return new Response(
          JSON.stringify({
            success: true,
            newTrackedEntityId: newEntityId,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
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
              .select([
                "id",
                "itemTrackingType",
                "name",
                "readableIdWithRevision",
                "type",
              ])
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
                ? Number(quantity)
                : Number(quantity) - Number(material?.quantityIssued); // set quantity

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
                quantity:
                  adjustmentType === "Positive Adjmt."
                    ? Number(quantityToIssue)
                    : -Number(quantityToIssue),
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
                quantity:
                  adjustmentType === "Positive Adjmt."
                    ? Number(quantity)
                    : -Number(quantity),
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
      case "trackedEntitiesToOperation": {
        const {
          materialId,
          parentTrackedEntityId,
          children,
          companyId,
          userId,
        } = validatedPayload;

        if (!parentTrackedEntityId) {
          throw new Error("Parent ID is required");
        }

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        await db.transaction().execute(async (trx) => {
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .selectAll()
            .execute();

          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", [
              ...children.map((child) => child.trackedEntityId),
            ])
            .orderBy("createdBy", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new Error("Tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Available")) {
            throw new Error("Tracked entities are not available");
          }

          const jobMaterial = await trx
            .selectFrom("jobMaterial")
            .where("id", "=", materialId)
            .selectAll()
            .executeTakeFirst();

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", jobMaterial?.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          // Get job location
          const job = await trx
            .selectFrom("job")
            .select(["id", "locationId"])
            .where("id", "=", jobMaterial?.jobId!)
            .executeTakeFirst();

          // Get parent tracked entity details
          const parentTrackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", parentTrackedEntityId)
            .select([
              "id",
              "sourceDocumentId",
              "quantity",
              "attributes",
              "status",
            ])
            .executeTakeFirst();

          if (!parentTrackedEntity) {
            throw new Error("Parent tracked entity not found");
          }

          // Create tracked activity
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Consume",
              sourceDocument: "Job Material",
              sourceDocumentId: materialId,
              sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
              attributes: {
                Job: job?.id!,
                "Job Make Method": jobMaterial?.jobMakeMethodId!,
                "Job Material": jobMaterial?.id!,
                Employee: userId,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          await trx
            .insertInto("trackedActivityOutput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity: parentTrackedEntity.quantity,
              companyId,
              createdBy: userId,
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityInputs: Database["public"]["Tables"]["trackedActivityInput"]["Insert"][] =
            [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;

            // If quantities don't match, split the batch
            if (Number(trackedEntity.quantity) !== quantity) {
              const remainingQuantity =
                Number(trackedEntity.quantity) - quantity;
              const newTrackedEntityId = nanoid();

              console.log("Split quantities:", {
                childQuantity: Number(trackedEntity.quantity),
                availableQuantity: quantity,
                remainingQuantity,
              });

              // Create split activity
              const splitActivityId = nanoid();
              await trx
                .insertInto("trackedActivity")
                .values({
                  id: splitActivityId,
                  type: "Split",
                  sourceDocument: "Job Material",
                  sourceDocumentId: materialId,
                  attributes: {
                    "Original Quantity": Number(trackedEntity.quantity),
                    "Consumed Quantity": quantity,
                    "Remaining Quantity": remainingQuantity,
                    "Split Entity ID": newTrackedEntityId,
                  },
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Record original entity as input
              await trx
                .insertInto("trackedActivityInput")
                .values({
                  trackedActivityId: splitActivityId,
                  trackedEntityId: trackedEntity.id!,
                  quantity: Number(trackedEntity.quantity),
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Create new tracked entity for remaining quantity
              await trx
                .insertInto("trackedEntity")
                .values({
                  id: newTrackedEntityId,
                  sourceDocumentId: trackedEntity.sourceDocumentId,
                  sourceDocument: "Item",
                  sourceDocumentReadableId:
                    trackedEntity.sourceDocumentReadableId,
                  quantity: remainingQuantity,
                  status: trackedEntity.status ?? "Available",
                  attributes: trackedEntity.attributes,
                  companyId,
                  createdBy: userId,
                })
                .execute();

              // Update original entity attributes with split reference
              await trx
                .updateTable("trackedEntity")
                .set({
                  quantity: quantity,
                  attributes: {
                    ...((trackedEntity.attributes as Record<string, unknown>) ??
                      {}),
                    "Split Entity ID": newTrackedEntityId,
                  },
                })
                .where("id", "=", trackedEntityId)
                .execute();

              // Record outputs from split
              await trx
                .insertInto("trackedActivityOutput")
                .values([
                  {
                    trackedActivityId: splitActivityId!,
                    trackedEntityId: newTrackedEntityId!,
                    quantity: remainingQuantity,
                    companyId,
                    createdBy: userId,
                  },
                  {
                    trackedActivityId: splitActivityId!,
                    trackedEntityId: trackedEntity.id!,
                    quantity: quantity,
                    companyId,
                    createdBy: userId,
                  },
                ])
                .execute();

              // Create item ledger entries for split
              console.log("Item ledger split entries:", {
                parentQuantity: -Number(trackedEntity.quantity),
                quantity,
                remainingQuantity,
              });

              if (jobMaterial?.methodType !== "Make") {
                itemLedgerInserts.push(
                  {
                    entryType: "Negative Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: -Number(trackedEntity.quantity),
                    locationId: job?.locationId,
                    shelfId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.shelfId,
                    trackedEntityId: trackedEntity.id!,
                    createdBy: userId,
                  },
                  {
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: quantity,
                    locationId: job?.locationId,
                    shelfId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.shelfId,
                    trackedEntityId: trackedEntity.id!,
                    createdBy: userId,
                  },
                  {
                    entryType: "Positive Adjmt.",
                    documentType: "Batch Split",
                    documentId: splitActivityId,
                    companyId,
                    itemId: trackedEntity.sourceDocumentId,
                    quantity: remainingQuantity,
                    locationId: job?.locationId,
                    shelfId: itemLedgers.find(
                      (itemLedger) =>
                        itemLedger.trackedEntityId === trackedEntityId
                    )?.shelfId,
                    trackedEntityId: newTrackedEntityId,
                    createdBy: userId,
                  }
                );
              }
            }

            // Update tracked entity status to consumed
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityInputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
            });

            if (jobMaterial?.methodType !== "Make") {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: job?.id!,
                companyId,
                itemId: trackedEntity.sourceDocumentId,
                quantity: -quantity,
                locationId: job?.locationId,
                shelfId: itemLedgers.find(
                  (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
                )?.shelfId,
                trackedEntityId,
                createdBy: userId,
              });
            }
          }

          if (trackedActivityInputs.length > 0) {
            await trx
              .insertInto("trackedActivityInput")
              .values(trackedActivityInputs)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          const totalChildQuantity = children.reduce((sum, child) => {
            return sum + Number(child.quantity);
          }, 0);

          const currentQuantityIssued =
            Number(jobMaterial?.quantityIssued) || 0;
          const newQuantityIssued = currentQuantityIssued + totalChildQuantity;

          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: newQuantityIssued,
            })
            .where("id", "=", materialId)
            .execute();

          console.log("Job material quantity updated:", {
            materialId,
            newQuantityIssued,
          });
        });

        break;
      }
      case "unconsumeTrackedEntities": {
        const {
          materialId,
          parentTrackedEntityId,
          children,
          companyId,
          userId,
        } = validatedPayload;

        if (!parentTrackedEntityId) {
          throw new Error("Parent ID is required");
        }

        if (children.length === 0) {
          throw new Error("Children are required");
        }

        await db.transaction().execute(async (trx) => {
          const trackedEntities = await trx
            .selectFrom("trackedEntity")
            .where(
              "id",
              "in",
              children.map((child) => child.trackedEntityId)
            )
            .selectAll()
            .execute();

          const itemLedgers = await trx
            .selectFrom("itemLedger")
            .where("trackedEntityId", "in", [
              ...children.map((child) => child.trackedEntityId),
            ])
            .orderBy("createdBy", "desc")
            .selectAll()
            .execute();

          if (trackedEntities.length !== children.length) {
            throw new Error("Tracked entities not found");
          }

          if (trackedEntities.some((entity) => entity.status !== "Consumed")) {
            throw new Error(
              "Tracked entities must be in Consumed status to unconsume"
            );
          }

          const jobMaterial = await trx
            .selectFrom("jobMaterial")
            .where("id", "=", materialId)
            .selectAll()
            .executeTakeFirst();

          // Get item details
          const item = await trx
            .selectFrom("item")
            .where("id", "=", jobMaterial?.itemId!)
            .select(["readableIdWithRevision"])
            .executeTakeFirst();

          // Get job location
          const job = await trx
            .selectFrom("job")
            .select(["id", "locationId"])
            .where("id", "=", jobMaterial?.jobId!)
            .executeTakeFirst();

          // Get parent tracked entity details
          const parentTrackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", parentTrackedEntityId)
            .select([
              "id",
              "sourceDocumentId",
              "quantity",
              "attributes",
              "status",
            ])
            .executeTakeFirst();

          if (!parentTrackedEntity) {
            throw new Error("Parent tracked entity not found");
          }

          // Create tracked activity for unconsume
          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Unconsume",
              sourceDocument: "Job Material",
              sourceDocumentId: materialId,
              sourceDocumentReadableId: item?.readableIdWithRevision ?? "",
              attributes: {
                Job: job?.id!,
                "Job Make Method": jobMaterial?.jobMakeMethodId!,
                "Job Material": jobMaterial?.id!,
                Employee: userId,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId: parentTrackedEntityId,
              quantity: parentTrackedEntity.quantity,
              companyId,
              createdBy: userId,
            })
            .execute();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];
          const trackedActivityOutputs: Database["public"]["Tables"]["trackedActivityOutput"]["Insert"][] =
            [];

          // Process each child tracked entity
          for (const child of children) {
            const trackedEntity = trackedEntities.find(
              (entity) => entity.id === child.trackedEntityId
            );
            if (!trackedEntity) {
              throw new Error("Tracked entity not found");
            }
            const { trackedEntityId, quantity } = child;
            // Update tracked entity status back to Available
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
              })
              .where("id", "=", trackedEntityId)
              .execute();

            trackedActivityOutputs.push({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity,
              companyId,
              createdBy: userId,
            });

            if (jobMaterial?.methodType !== "Make") {
              itemLedgerInserts.push({
                entryType: "Consumption",
                documentType: "Job Consumption",
                documentId: job?.id!,
                companyId,
                itemId: trackedEntity.sourceDocumentId,
                quantity: quantity,
                locationId: job?.locationId,
                shelfId: itemLedgers.find(
                  (itemLedger) => itemLedger.trackedEntityId === trackedEntityId
                )?.shelfId,
                trackedEntityId,
                createdBy: userId,
              });
            }
          }

          if (trackedActivityOutputs.length > 0) {
            await trx
              .insertInto("trackedActivityOutput")
              .values(trackedActivityOutputs)
              .execute();
          }

          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          const totalChildQuantity = children.reduce((sum, child) => {
            return sum + Number(child.quantity);
          }, 0);

          const currentQuantityIssued =
            Number(jobMaterial?.quantityIssued) || 0;
          const newQuantityIssued = currentQuantityIssued - totalChildQuantity;

          await trx
            .updateTable("jobMaterial")
            .set({
              quantityIssued: newQuantityIssued,
            })
            .where("id", "=", materialId)
            .execute();

          console.log("Job material quantity updated for unconsume:", {
            materialId,
            newQuantityIssued,
          });
        });

        break;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "x",
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
