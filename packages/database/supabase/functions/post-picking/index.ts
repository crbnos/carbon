import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { getLocalTimeZone, today as getToday } from "npm:@internationalized/date";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import type { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

// A pick is a TRANSFER of material from the warehouse source shelf
// (pickingListLine.storageUnitId) to the work center's lineside shelf
// (pickingListLine.toStorageUnitId). Consumption happens later at production,
// which is why we also point jobMaterial.storageUnitId at the lineside shelf.
const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inventory"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("unpickInventory"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("serial"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("batch"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    quantity: z.number().positive(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("unpickSerial"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("unpickBatch"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  // Return the un-consumed remainder of a tracked (batch/serial) allocation from
  // the lineside shelf back to the warehouse source at job complete. Unlike
  // unpickBatch (all-or-nothing, keyed to the original picked entity), this walks
  // the picked entity's split lineage and moves whatever is still physically on
  // hand at the lineside bin — because a partial consume splits the remainder
  // into a NEW entity the picking line never references.
  z.object({
    type: z.literal("returnPickedRemainder"),
    pickingListId: z.string(),
    pickingListLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  })
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const today = format(getToday(getLocalTimeZone()).toDate(getLocalTimeZone()), "yyyy-MM-dd");

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    let splitEntityId: string | undefined;

    switch (validatedPayload.type) {
      case "inventory": {
        const {
          pickingListId,
          pickingListLineId,
          quantity,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const inserts: ItemLedgerInsert[] = [
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: -quantity,
              locationId,
              storageUnitId: line.storageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: quantity,
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              createdBy: userId,
              companyId
            }
          ];

          await trx.insertInto("itemLedger").values(inserts).execute();

          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked: Number(line.quantityPicked ?? 0) + quantity,
              status: "Picked",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Production consumes from where the material now physically sits.
          await pointJobMaterialAtLineside(trx, line, userId);
        });
        break;
      }

      case "unpickInventory": {
        const {
          pickingListId,
          pickingListLineId,
          quantity,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const inserts: ItemLedgerInsert[] = [
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: -quantity,
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: quantity,
              locationId,
              storageUnitId: line.storageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              createdBy: userId,
              companyId
            }
          ];

          await trx.insertInto("itemLedger").values(inserts).execute();

          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked: Math.max(
                0,
                Number(line.quantityPicked ?? 0) - quantity
              ),
              status: "Pending",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Restore the warehouse source as the consumption point.
          await restoreJobMaterialSource(trx, line, userId);
        });
        break;
      }

      case "serial": {
        const {
          pickingListId,
          pickingListLineId,
          trackedEntityId,
          fromStorageUnitId,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Pick",
              sourceDocument: "Picking List",
              sourceDocumentId: pickingListId,
              attributes: {
                "Picking List": pickingListId,
                "Picking List Line": pickingListLineId,
                "From Shelf": fromStorageUnitId,
                "To Shelf": line.toStorageUnitId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity: 1,
              companyId,
              createdBy: userId
            })
            .execute();

          const inserts: ItemLedgerInsert[] = [
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: -1,
              locationId,
              storageUnitId: fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: 1,
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            }
          ];
          await trx.insertInto("itemLedger").values(inserts).execute();

          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked: Number(line.quantityPicked ?? 0) + 1,
              status: "Picked",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Record which lot this line picked (drives the line's picked-lot
          // display, unpick, and the allocation-dedup in the picker).
          await trx
            .insertInto("pickingListLineTrackedEntity")
            .values({
              pickingListLineId,
              trackedEntityId,
              quantity: 1,
              quantityPicked: 1
            })
            .onConflict((oc) =>
              oc.columns(["pickingListLineId", "trackedEntityId"]).doUpdateSet({
                quantity: (eb) => eb("pickingListLineTrackedEntity.quantity", "+", 1),
                quantityPicked: (eb) =>
                  eb("pickingListLineTrackedEntity.quantityPicked", "+", 1)
              })
            )
            .execute();

          await pointJobMaterialAtLineside(trx, line, userId);
        });
        break;
      }

      case "batch": {
        const {
          pickingListId,
          pickingListLineId,
          trackedEntityId,
          fromStorageUnitId,
          quantity,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const entityQuantity = Number(trackedEntity.quantity);
          const transferQuantity = quantity;
          const inserts: ItemLedgerInsert[] = [];

          // Split the batch when picking less than the whole entity.
          if (entityQuantity !== transferQuantity) {
            const remainingQuantity = entityQuantity - transferQuantity;
            const newTrackedEntityId = nanoid();
            splitEntityId = newTrackedEntityId;

            const splitActivityId = nanoid();
            await trx
              .insertInto("trackedActivity")
              .values({
                id: splitActivityId,
                type: "Split",
                sourceDocument: "Picking List",
                sourceDocumentId: pickingListId,
                attributes: {
                  "Original Quantity": entityQuantity,
                  "Transfer Quantity": transferQuantity,
                  "Remaining Quantity": remainingQuantity,
                  "Split Entity ID": newTrackedEntityId
                },
                companyId,
                createdBy: userId
              })
              .execute();

            await trx
              .insertInto("trackedActivityInput")
              .values({
                trackedActivityId: splitActivityId,
                trackedEntityId,
                quantity: entityQuantity,
                companyId,
                createdBy: userId
              })
              .execute();

            await trx
              .insertInto("trackedEntity")
              .values({
                id: newTrackedEntityId,
                readableId: trackedEntity.readableId,
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId: trackedEntity.sourceDocumentReadableId,
                quantity: remainingQuantity,
                status: "Available",
                attributes: trackedEntity.attributes,
                itemId: trackedEntity.itemId ?? null,
                expirationDate: trackedEntity.expirationDate ?? null,
                companyId,
                createdBy: userId
              })
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values([
                {
                  trackedActivityId: splitActivityId,
                  trackedEntityId: newTrackedEntityId,
                  quantity: remainingQuantity,
                  companyId,
                  createdBy: userId
                },
                {
                  trackedActivityId: splitActivityId,
                  trackedEntityId,
                  quantity: transferQuantity,
                  companyId,
                  createdBy: userId
                }
              ])
              .execute();

            await trx
              .updateTable("trackedEntity")
              .set({
                quantity: transferQuantity,
                attributes: {
                  ...(trackedEntity.attributes as Record<string, unknown>),
                  "Split Entity ID": newTrackedEntityId
                }
              })
              .where("id", "=", trackedEntityId)
              .execute();

            inserts.push(
              {
                postingDate: today,
                itemId: line.itemId,
                quantity: -entityQuantity,
                locationId,
                storageUnitId: fromStorageUnitId,
                entryType: "Negative Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId,
                createdBy: userId,
                companyId
              },
              {
                postingDate: today,
                itemId: line.itemId,
                quantity: transferQuantity,
                locationId,
                storageUnitId: fromStorageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId,
                createdBy: userId,
                companyId
              },
              {
                postingDate: today,
                itemId: line.itemId,
                quantity: remainingQuantity,
                locationId,
                storageUnitId: fromStorageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Batch Split",
                documentId: splitActivityId,
                trackedEntityId: newTrackedEntityId,
                createdBy: userId,
                companyId
              }
            );
          }

          const activityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: activityId,
              type: "Pick",
              sourceDocument: "Picking List",
              sourceDocumentId: pickingListId,
              attributes: {
                "Picking List": pickingListId,
                "Picking List Line": pickingListLineId,
                "From Shelf": fromStorageUnitId,
                "To Shelf": line.toStorageUnitId
              },
              companyId,
              createdBy: userId
            })
            .execute();

          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: activityId,
              trackedEntityId,
              quantity: transferQuantity,
              companyId,
              createdBy: userId
            })
            .execute();

          // A pick MOVES the batch — it stays Available (consumed at production).
          inserts.push(
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: -transferQuantity,
              locationId,
              storageUnitId: fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: transferQuantity,
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            }
          );

          await trx.insertInto("itemLedger").values(inserts).execute();

          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked:
                Number(line.quantityPicked ?? 0) + transferQuantity,
              status: "Picked",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Record which lot this line picked (drives picked-lot display,
          // unpick, and the picker's allocation-dedup).
          await trx
            .insertInto("pickingListLineTrackedEntity")
            .values({
              pickingListLineId,
              trackedEntityId,
              quantity: transferQuantity,
              quantityPicked: transferQuantity
            })
            .onConflict((oc) =>
              oc.columns(["pickingListLineId", "trackedEntityId"]).doUpdateSet({
                quantity: (eb) =>
                  eb("pickingListLineTrackedEntity.quantity", "+", transferQuantity),
                quantityPicked: (eb) =>
                  eb(
                    "pickingListLineTrackedEntity.quantityPicked",
                    "+",
                    transferQuantity
                  )
              })
            )
            .execute();

          await pointJobMaterialAtLineside(trx, line, userId);
        });
        break;
      }

      case "unpickSerial":
      case "unpickBatch": {
        const {
          pickingListId,
          pickingListLineId,
          trackedEntityId,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const qty = Number(trackedEntity.quantity);

          const activity = await trx
            .selectFrom("trackedActivity")
            .innerJoin(
              "trackedActivityInput",
              "trackedActivity.id",
              "trackedActivityInput.trackedActivityId"
            )
            .where("trackedActivity.type", "=", "Pick")
            .where("trackedActivity.sourceDocument", "=", "Picking List")
            .where("trackedActivity.sourceDocumentId", "=", pickingListId)
            .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
            .where("trackedActivity.companyId", "=", companyId)
            .selectAll("trackedActivity")
            .executeTakeFirstOrThrow();

          const inserts: ItemLedgerInsert[] = [
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: -qty,
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: qty,
              locationId,
              storageUnitId: line.storageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId,
              createdBy: userId,
              companyId
            }
          ];
          await trx.insertInto("itemLedger").values(inserts).execute();

          await trx
            .deleteFrom("trackedActivityInput")
            .where("trackedActivityId", "=", activity.id!)
            .execute();
          await trx
            .deleteFrom("trackedActivity")
            .where("id", "=", activity.id!)
            .execute();

          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked: Math.max(
                0,
                Number(line.quantityPicked ?? 0) - qty
              ),
              status: "Pending",
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          // Drop the recorded lot so it's pickable again + display clears.
          await trx
            .deleteFrom("pickingListLineTrackedEntity")
            .where("pickingListLineId", "=", pickingListLineId)
            .where("trackedEntityId", "=", trackedEntityId)
            .execute();

          await restoreJobMaterialSource(trx, line, userId);
        });
        break;
      }

      case "returnPickedRemainder": {
        const {
          pickingListId,
          pickingListLineId,
          trackedEntityId,
          locationId,
          userId,
          companyId
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const lineside = line.toStorageUnitId;
          const source = line.storageUnitId;
          // No lineside stage or no source to return to → nothing to do.
          if (!lineside || !source) return;

          // Walk the picked entity's split lineage (picked entity + every split
          // descendant). A partial consume splits the un-consumed remainder into
          // a new entity, so the leftover stock at lineside sits under a
          // descendant, not the originally-picked entity.
          const lineage = new Set<string>([trackedEntityId]);
          let frontier: string[] = [trackedEntityId];
          while (frontier.length > 0) {
            const rows = await trx
              .selectFrom("trackedActivityInput as tai")
              .innerJoin(
                "trackedActivityOutput as tao",
                "tao.trackedActivityId",
                "tai.trackedActivityId"
              )
              .where("tai.trackedEntityId", "in", frontier)
              .where("tai.companyId", "=", companyId)
              .whereRef("tao.trackedEntityId", "<>", "tai.trackedEntityId")
              .select("tao.trackedEntityId as id")
              .distinct()
              .execute();
            const next: string[] = [];
            for (const r of rows) {
              if (r.id && !lineage.has(r.id)) {
                lineage.add(r.id);
                next.push(r.id);
              }
            }
            frontier = next;
          }

          // Transfer each lineage entity's remaining lineside on-hand back to
          // the warehouse source bin.
          const inserts: ItemLedgerInsert[] = [];
          let totalReturned = 0;
          for (const entityId of lineage) {
            const onHandRow = await trx
              .selectFrom("itemLedger")
              .where("trackedEntityId", "=", entityId)
              .where("storageUnitId", "=", lineside)
              .where("itemId", "=", line.itemId)
              .where("companyId", "=", companyId)
              .select((eb) => eb.fn.sum<number>("quantity").as("qty"))
              .executeTakeFirst();
            const onHand = Number(onHandRow?.qty ?? 0);
            if (onHand <= 0) continue;
            inserts.push(
              ...transferPair({
                today,
                itemId: line.itemId,
                quantity: onHand,
                locationId,
                fromStorageUnitId: lineside,
                toStorageUnitId: source,
                documentId: pickingListId,
                trackedEntityId: entityId,
                userId,
                companyId
              })
            );
            totalReturned += onHand;
          }

          if (totalReturned <= 0) return;

          await trx.insertInto("itemLedger").values(inserts).execute();

          // Decrement the recorded picked qty by what was returned so the lot is
          // re-allocatable and the picked/to-pick display reflects reality.
          const allocation = await trx
            .selectFrom("pickingListLineTrackedEntity")
            .where("pickingListLineId", "=", pickingListLineId)
            .where("trackedEntityId", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();
          if (allocation) {
            const nextQuantity = Math.max(
              0,
              Number(allocation.quantity ?? 0) - totalReturned
            );
            const nextPicked = Math.max(
              0,
              Number(allocation.quantityPicked ?? 0) - totalReturned
            );
            if (nextPicked <= 0) {
              await trx
                .deleteFrom("pickingListLineTrackedEntity")
                .where("pickingListLineId", "=", pickingListLineId)
                .where("trackedEntityId", "=", trackedEntityId)
                .execute();
            } else {
              await trx
                .updateTable("pickingListLineTrackedEntity")
                .set({ quantity: nextQuantity, quantityPicked: nextPicked })
                .where("pickingListLineId", "=", pickingListLineId)
                .where("trackedEntityId", "=", trackedEntityId)
                .execute();
            }
          }

          const nextLinePicked = Math.max(
            0,
            Number(line.quantityPicked ?? 0) - totalReturned
          );
          await trx
            .updateTable("pickingListLine")
            .set({
              quantityPicked: nextLinePicked,
              // Fully returned → the line is no longer picked; mirror unpick's
              // reset so status doesn't linger on 'Picked' with 0 picked qty.
              ...(nextLinePicked <= 0 ? { status: "Pending" as const } : {}),
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .execute();

          await restoreJobMaterialSource(trx, line, userId);
        });
        break;
      }
    }

    return new Response(
      JSON.stringify({ success: true, splitEntityId }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ success: false, message: (err as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});

// A balanced Transfer ledger pair moving `quantity` of a tracked entity from one
// storage unit to another (a pick, unpick, or return is all the same shape).
function transferPair(args: {
  today: string;
  itemId: string;
  quantity: number;
  locationId: string;
  fromStorageUnitId: string;
  toStorageUnitId: string;
  documentId: string;
  trackedEntityId: string;
  userId: string;
  companyId: string;
}): ItemLedgerInsert[] {
  const base = {
    postingDate: args.today,
    itemId: args.itemId,
    locationId: args.locationId,
    entryType: "Transfer" as const,
    documentType: "Direct Transfer" as const,
    documentId: args.documentId,
    trackedEntityId: args.trackedEntityId,
    createdBy: args.userId,
    companyId: args.companyId
  };
  return [
    { ...base, quantity: -args.quantity, storageUnitId: args.fromStorageUnitId },
    { ...base, quantity: args.quantity, storageUnitId: args.toStorageUnitId }
  ];
}

// Point the job material at the lineside shelf so production (backflush/issue)
// consumes from where the pick just moved the stock.
async function pointJobMaterialAtLineside(
  trx: any,
  line: { jobMaterialId: string; toStorageUnitId: string | null },
  userId: string
) {
  if (!line.toStorageUnitId) return;
  await trx
    .updateTable("jobMaterial")
    .set({
      storageUnitId: line.toStorageUnitId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .where("id", "=", line.jobMaterialId)
    .execute();
}

// Restore the warehouse source on unpick.
async function restoreJobMaterialSource(
  trx: any,
  line: { jobMaterialId: string; storageUnitId: string | null },
  userId: string
) {
  await trx
    .updateTable("jobMaterial")
    .set({
      storageUnitId: line.storageUnitId,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .where("id", "=", line.jobMaterialId)
    .execute();
}
