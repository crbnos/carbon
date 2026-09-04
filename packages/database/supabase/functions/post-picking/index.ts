import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { sql } from "kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import type { Database } from "../lib/types.ts";
import { resolveTrackedEntityBin } from "../issue/resolve-tracked-entity-bin.ts";
import {
  buildBatchSplitRecords,
  buildMergeRecords
} from "../shared/batch-split.ts";
import { round } from "../shared/precision.ts";

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
  }),
  // Sweep every picking-list line of one operation (policy-gated: no-ops unless
  // companySettings.returnPickedMaterialTiming = 'operation') or of one job
  // (runs under both policies; requires job.status = 'Completed'). Tracked lines
  // return via the split-lineage walk; untracked lines return
  // picked − returned − max(issued, owed) per job material, where `owed` holds
  // back what completion-time backflush still needs.
  z.object({
    type: z.literal("returnOperationRemainders"),
    jobOperationId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("returnJobRemainders"),
    jobId: z.string(),
    userId: z.string(),
    companyId: z.string()
  })
]);

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const validatedPayload = payloadValidator.parse(payload);
    const today = datetime.today(await getCompanyTimeZone(db, validatedPayload.companyId)).toString();
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
              quantity: round(-quantity),
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
              quantity: round(quantity),
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
              quantity: round(-quantity),
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
              quantity: round(quantity),
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

          // Split the batch when picking less than the whole entity: the shelf
          // entity keeps its id and is decremented; a NEW child entity departs
          // to the lineside bin carrying the drawn quantity.
          let pickedEntityId = trackedEntityId;
          if (entityQuantity !== transferQuantity) {
            const childId = nanoid();
            splitEntityId = childId;
            pickedEntityId = childId;

            const split = buildBatchSplitRecords({
              parent: {
                id: trackedEntity.id,
                readableId: trackedEntity.readableId,
                quantity: entityQuantity,
                sourceDocument: trackedEntity.sourceDocument,
                sourceDocumentId: trackedEntity.sourceDocumentId,
                sourceDocumentReadableId:
                  trackedEntity.sourceDocumentReadableId,
                itemId: trackedEntity.itemId ?? null,
                expirationDate: trackedEntity.expirationDate ?? null,
                attributes: trackedEntity.attributes as Record<
                  string,
                  unknown
                > | null
              },
              drawQuantity: transferQuantity,
              childId,
              splitActivityId: nanoid(),
              activitySourceDocument: "Picking List",
              activitySourceDocumentId: pickingListId,
              bin: { storageUnitId: fromStorageUnitId, locationId },
              itemLedgerItemId: line.itemId,
              companyId,
              userId,
              postingDate: today,
              childStatus: "Available"
            });

            await trx
              .insertInto("trackedActivity")
              .values(split.activityInsert)
              .execute();

            await trx
              .insertInto("trackedEntity")
              .values(split.childEntityInsert)
              .execute();

            await trx
              .insertInto("trackedActivityInput")
              .values(split.activityInputInsert)
              .execute();

            await trx
              .insertInto("trackedActivityOutput")
              .values(split.activityOutputInsert)
              .execute();

            await trx
              .updateTable("trackedEntity")
              .set(split.parentUpdate)
              .where("id", "=", trackedEntityId)
              .execute();

            inserts.push(
              ...split.ledgerInserts.map((ledgerRow) => ({
                ...ledgerRow,
                quantity: round(ledgerRow.quantity)
              }))
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
              trackedEntityId: pickedEntityId,
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
              quantity: round(-transferQuantity),
              locationId,
              storageUnitId: fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId: pickedEntityId,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(transferQuantity),
              locationId,
              storageUnitId: line.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: pickingListId,
              trackedEntityId: pickedEntityId,
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
          // unpick, and the picker's allocation-dedup). On a split the picked
          // lot is the departing CHILD — the lineside entity the operator
          // consumes — never the shelf survivor.
          await trx
            .insertInto("pickingListLineTrackedEntity")
            .values({
              pickingListLineId,
              trackedEntityId: pickedEntityId,
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

      case "unpickSerial": {
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
              quantity: round(-qty),
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
              quantity: round(qty),
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

          // The unpick quantity is what THIS line picked of the entity — from
          // the allocation row, never trackedEntity.quantity: post-flip the
          // allocated entity is the departing child, and once consumption
          // starts its current quantity no longer equals what was picked.
          const allocation = await trx
            .selectFrom("pickingListLineTrackedEntity")
            .where("pickingListLineId", "=", pickingListLineId)
            .where("trackedEntityId", "=", trackedEntityId)
            .selectAll()
            .executeTakeFirst();

          if (!allocation) {
            throw new Error(
              `Cannot unpick batch: no allocation row for picking list line ${pickingListLineId} and tracked entity ${trackedEntityId}`
            );
          }

          const unpickQuantity = Number(allocation.quantityPicked);

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

          // Reverse the Transfer pair at the picked magnitude.
          const inserts: ItemLedgerInsert[] = [
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(-unpickQuantity),
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
              quantity: round(unpickQuantity),
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

          // Merge-back undo: post-flip the picked entity is a Split child
          // whose parent stayed on the shelf. Fold the quantity back into the
          // parent and delete the Split so genealogy reads as if the pick
          // never happened. Legacy allocations (no Split From pointer, or a
          // parent that no longer matches) skip this — the entity simply
          // returns to the source bin as its own lot, today's behavior.
          const attrs = (trackedEntity.attributes ?? {}) as Record<
            string,
            unknown
          >;
          const parentId = attrs["Split From Entity ID"];
          if (typeof parentId === "string" && parentId) {
            const parent = await trx
              .selectFrom("trackedEntity")
              .where("id", "=", parentId)
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirst();

            if (parent && parent.readableId === trackedEntity.readableId) {
              const childRemaining =
                Number(trackedEntity.quantity) - unpickQuantity;
              if (childRemaining < 0) {
                throw new Error(
                  `Cannot unpick batch: entity ${trackedEntityId} holds ${trackedEntity.quantity} but ${unpickQuantity} was picked — partial consumption must be unconsumed first`
                );
              }

              const splitActivity = await trx
                .selectFrom("trackedActivity")
                .where("type", "=", "Split")
                .where(
                  sql<boolean>`attributes->>'Split Entity ID' = ${trackedEntityId}`
                )
                .where("companyId", "=", companyId)
                .selectAll()
                .executeTakeFirst();

              await trx
                .updateTable("trackedEntity")
                .set({ quantity: Number(parent.quantity) + unpickQuantity })
                .where("id", "=", parent.id)
                .execute();

              await trx
                .updateTable("trackedEntity")
                .set(
                  childRemaining === 0
                    ? { quantity: 0, status: "Consumed" }
                    : { quantity: childRemaining }
                )
                .where("id", "=", trackedEntityId)
                .execute();

              // Net out the original split pair at the source bin. Keep the
              // child's entity row — itemLedger.trackedEntityId history stays
              // intact (the FK is ON DELETE SET NULL; deleting would null it).
              inserts.push(
                {
                  postingDate: today,
                  itemId: line.itemId,
                  quantity: round(-unpickQuantity),
                  locationId,
                  storageUnitId: line.storageUnitId,
                  entryType: "Negative Adjmt.",
                  documentType: "Batch Split",
                  documentId: splitActivity?.id ?? pickingListId,
                  trackedEntityId,
                  createdBy: userId,
                  companyId
                },
                {
                  postingDate: today,
                  itemId: line.itemId,
                  quantity: round(unpickQuantity),
                  locationId,
                  storageUnitId: line.storageUnitId,
                  entryType: "Positive Adjmt.",
                  documentType: "Batch Split",
                  documentId: splitActivity?.id ?? pickingListId,
                  trackedEntityId: parent.id,
                  createdBy: userId,
                  companyId
                }
              );

              // Clean undo: the Split never happened.
              if (splitActivity) {
                await trx
                  .deleteFrom("trackedActivityOutput")
                  .where("trackedActivityId", "=", splitActivity.id!)
                  .execute();
                await trx
                  .deleteFrom("trackedActivityInput")
                  .where("trackedActivityId", "=", splitActivity.id!)
                  .execute();
                await trx
                  .deleteFrom("trackedActivity")
                  .where("id", "=", splitActivity.id!)
                  .execute();
              }
            }
          }

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
                Number(line.quantityPicked ?? 0) - unpickQuantity
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
        const { pickingListLineId, trackedEntityId, locationId, userId, companyId } =
          validatedPayload;

        await db.transaction().execute(async (trx) => {
          const line = await trx
            .selectFrom("pickingListLine")
            .where("id", "=", pickingListLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const totalReturned = await returnTrackedAllocationRemainder(trx, {
            today,
            line,
            trackedEntityId,
            locationId,
            userId,
            companyId
          });

          // Legacy single-allocation call: restore the consumption pointer
          // only when something actually returned (matching the original
          // early-return behavior). The sweep cases decide per material.
          if (totalReturned > 0) {
            await restoreJobMaterialSource(trx, line, userId);
          }
        });
        break;
      }

      case "returnOperationRemainders": {
        const { jobOperationId, userId, companyId } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const settings = await trx
            .selectFrom("companySettings")
            .where("id", "=", companyId)
            .select("returnPickedMaterialTiming")
            .executeTakeFirst();
          // The policy gate lives here (not at call sites) so every op-Done
          // path can invoke unconditionally.
          if (settings?.returnPickedMaterialTiming !== "operation") return;

          const op = await trx
            .selectFrom("jobOperation")
            .where("id", "=", jobOperationId)
            .where("companyId", "=", companyId)
            .select(["id", "jobId", "quantityComplete"])
            .executeTakeFirstOrThrow();
          if (!op.jobId) return;

          const job = await trx
            .selectFrom("job")
            .where("id", "=", op.jobId)
            .where("companyId", "=", companyId)
            .select(["id", "quantity", "locationId", "status"])
            .executeTakeFirstOrThrow();
          if (!job.locationId) return;

          await runReturnSweep(trx, {
            scope: "operation",
            job: { id: job.id, quantity: job.quantity, locationId: job.locationId },
            opId: op.id,
            opQuantityComplete: Number(op.quantityComplete ?? 0),
            today,
            userId,
            companyId
          });
        });
        break;
      }

      case "returnJobRemainders": {
        const { jobId, userId, companyId } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          const job = await trx
            .selectFrom("job")
            .where("id", "=", jobId)
            .where("companyId", "=", companyId)
            .select(["id", "quantity", "locationId", "status"])
            .executeTakeFirstOrThrow();
          // Job scope is the final catch-all: only a completed job's remainder
          // is provably surplus (completion-time backflush has already run).
          if (job.status !== "Completed" || !job.locationId) return;

          await runReturnSweep(trx, {
            scope: "job",
            job: { id: job.id, quantity: job.quantity, locationId: job.locationId },
            today,
            userId,
            companyId
          });
        });
        break;
      }
    }

    return jsonResponse({ success: true, splitEntityId });
  } catch (err) {
    return errorResponse(err, 500);
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
    { ...base, quantity: round(-args.quantity), storageUnitId: args.fromStorageUnitId },
    { ...base, quantity: round(args.quantity), storageUnitId: args.toStorageUnitId }
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

type ReturnSweepLine = {
  id: string;
  pickingListId: string;
  jobMaterialId: string;
  jobOperationId: string | null;
  itemId: string;
  quantityPicked: number | string | null;
  quantityReturned: number | string | null;
  storageUnitId: string | null;
  toStorageUnitId: string | null;
  createdAt: string | Date | null;
};

// Return the un-consumed remainder of ONE tracked (batch/serial) allocation from
// the lineside shelf back to the warehouse source. Walks the picked entity's
// split lineage and moves whatever is still physically on hand at the lineside
// bin (a partial consume splits the remainder into a NEW entity the picking line
// never references). Idempotent: nothing on hand → nothing moves.
//
// Books the return on pickingListLine.quantityReturned instead of decrementing
// quantityPicked — the update_picking_list_status trigger reacts to
// quantityPicked/status changes and would demote a Completed/Partial header back
// to In Progress. quantityPicked stays gross-picked; net staged at lineside is
// quantityPicked - quantityReturned. The allocation row keeps its historical
// decrement/delete-at-0 so the lot becomes re-allocatable (the availability RPCs
// net allocations out of on-hand). Does NOT repoint jobMaterial.storageUnitId —
// callers decide that per material.
async function returnTrackedAllocationRemainder(
  trx: any,
  args: {
    today: string;
    line: {
      id: string;
      pickingListId: string;
      itemId: string;
      storageUnitId: string | null;
      toStorageUnitId: string | null;
    };
    trackedEntityId: string;
    locationId: string;
    userId: string;
    companyId: string;
  }
): Promise<number> {
  const { today, line, trackedEntityId, locationId, userId, companyId } = args;
  const lineside = line.toStorageUnitId;

  // Return target = the bin this lot was actually PICKED from, recorded
  // on its Pick trackedActivity at pick time — not the line's stale
  // generation-time source bin, which can be wrong per-lot and is null
  // for a shortage line that later got picked anyway.
  const pickActivities = await trx
    .selectFrom("trackedActivity as ta")
    .innerJoin("trackedActivityInput as tai", "tai.trackedActivityId", "ta.id")
    .where("ta.type", "=", "Pick")
    .where("ta.sourceDocument", "=", "Picking List")
    .where("ta.sourceDocumentId", "=", line.pickingListId)
    .where("tai.trackedEntityId", "=", trackedEntityId)
    .where("ta.companyId", "=", companyId)
    .where("tai.companyId", "=", companyId)
    .orderBy("ta.createdAt", "desc")
    .select("ta.attributes")
    .execute();

  // Use the LATEST pick for this line (activities are newest-first). Its
  // "From Shelf" is the current truth — even if null (picked from an
  // unassigned bin), fall through to the line bin rather than reusing an
  // older pick's stale shelf.
  const latestPickForLine = pickActivities
    .map((a: { attributes: unknown }) => a.attributes as Record<string, unknown> | null)
    // Disambiguate if the same entity was picked on multiple lines.
    .find((a: Record<string, unknown> | null) => a?.["Picking List Line"] === line.id);
  const pickedFromShelf = latestPickForLine?.["From Shelf"] as
    | string
    | null
    | undefined;

  const source = pickedFromShelf ?? line.storageUnitId;
  // No lineside stage or no source to return to → nothing to do.
  if (!lineside || !source) return 0;

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

  // Transfer each lineage entity's remaining lineside on-hand back to the
  // warehouse source bin. A split child whose parent still sits Available at
  // the source bin MERGES back into the parent (no standalone fragment);
  // anything ineligible falls back to today's standalone return — never
  // block a return on merge eligibility.
  const inserts: ItemLedgerInsert[] = [];
  let totalReturned = 0;
  for (const entityId of lineage) {
    const onHandRow = await trx
      .selectFrom("itemLedger")
      .where("trackedEntityId", "=", entityId)
      .where("storageUnitId", "=", lineside)
      .where("itemId", "=", line.itemId)
      .where("companyId", "=", companyId)
      .select((eb: any) => eb.fn.sum<number>("quantity").as("qty"))
      .executeTakeFirst();
    const onHand = Number(onHandRow?.qty ?? 0);
    if (onHand <= 0) continue;

    const entity = await trx
      .selectFrom("trackedEntity")
      .where("id", "=", entityId)
      .where("companyId", "=", companyId)
      .selectAll()
      .executeTakeFirst();
    const parentId = ((entity?.attributes ?? {}) as Record<string, unknown>)[
      "Split From Entity ID"
    ];

    let merged = false;
    if (entity && typeof parentId === "string" && parentId) {
      const parent = await trx
        .selectFrom("trackedEntity")
        .where("id", "=", parentId)
        .where("companyId", "=", companyId)
        .selectAll()
        .executeTakeFirst();

      if (
        parent &&
        parent.status === "Available" &&
        parent.readableId === entity.readableId &&
        onHand <= Number(entity.quantity)
      ) {
        const parentLedgers = await trx
          .selectFrom("itemLedger")
          .where("trackedEntityId", "=", parent.id)
          .where("companyId", "=", companyId)
          .select(["trackedEntityId", "storageUnitId", "quantity"])
          .execute();

        if (resolveTrackedEntityBin(parentLedgers, parent.id) === source) {
          const merge = buildMergeRecords({
            child: { id: entity.id, quantity: Number(entity.quantity) },
            parent: { id: parent.id, quantity: Number(parent.quantity) },
            mergeQuantity: onHand,
            mergeActivityId: nanoid(),
            companyId,
            userId
          });

          // Physical move: −r on the child at lineside, +r on the parent at
          // the source bin — same Transfer shape the sweep books today.
          inserts.push(
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(-onHand),
              locationId,
              storageUnitId: lineside,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: line.pickingListId,
              trackedEntityId: entity.id,
              createdBy: userId,
              companyId
            },
            {
              postingDate: today,
              itemId: line.itemId,
              quantity: round(onHand),
              locationId,
              storageUnitId: source,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: line.pickingListId,
              trackedEntityId: parent.id,
              createdBy: userId,
              companyId
            }
          );

          await trx
            .insertInto("trackedActivity")
            .values(merge.activityInsert)
            .execute();
          await trx
            .insertInto("trackedActivityInput")
            .values(merge.activityInputInsert)
            .execute();
          await trx
            .insertInto("trackedActivityOutput")
            .values(merge.activityOutputInsert)
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set(merge.parentUpdate)
            .where("id", "=", parent.id)
            .execute();
          await trx
            .updateTable("trackedEntity")
            .set(merge.childUpdate)
            .where("id", "=", entity.id)
            .execute();

          merged = true;
        }
      }
    }

    if (!merged) {
      inserts.push(
        ...transferPair({
          today,
          itemId: line.itemId,
          quantity: onHand,
          locationId,
          fromStorageUnitId: lineside,
          toStorageUnitId: source,
          documentId: line.pickingListId,
          trackedEntityId: entityId,
          userId,
          companyId
        })
      );
    }
    totalReturned += onHand;
  }

  if (totalReturned <= 0) return 0;

  await trx.insertInto("itemLedger").values(inserts).execute();

  // Decrement the recorded allocation by what was returned so the lot is
  // re-allocatable.
  const allocation = await trx
    .selectFrom("pickingListLineTrackedEntity")
    .where("pickingListLineId", "=", line.id)
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
        .where("pickingListLineId", "=", line.id)
        .where("trackedEntityId", "=", trackedEntityId)
        .execute();
    } else {
      await trx
        .updateTable("pickingListLineTrackedEntity")
        .set({ quantity: nextQuantity, quantityPicked: nextPicked })
        .where("pickingListLineId", "=", line.id)
        .where("trackedEntityId", "=", trackedEntityId)
        .execute();
    }
  }

  await trx
    .updateTable("pickingListLine")
    .set((eb: any) => ({
      quantityReturned: eb("quantityReturned", "+", totalReturned),
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    }))
    .where("id", "=", line.id)
    .where("companyId", "=", companyId)
    .execute();

  return totalReturned;
}

// Return the un-consumed remainder of an UNTRACKED job material. There is no
// per-line consumption attribution (jobMaterial.quantityIssued is one counter
// across N lines), so the remainder is computed per material —
//   returnable = max(0, Σ(line.picked − line.returned) − max(issued, owed))
// — and allocated back across the material's lines newest-first. `owed` is what
// completion-time backflush is still entitled to draw from lineside; holding it
// back is what keeps the top-up suppliable (never derived from bin on-hand: the
// lineside bin is shared per work center across jobs).
async function returnUntrackedMaterialRemainder(
  trx: any,
  args: {
    today: string;
    material: { id: string; itemId: string; quantityIssued: number | string | null };
    lines: ReturnSweepLine[];
    owed: number;
    locationId: string;
    userId: string;
    companyId: string;
  }
): Promise<number> {
  const { today, material, lines, owed, locationId, userId, companyId } = args;

  const staged = lines
    .map((l) => ({
      ...l,
      stagedNet: Math.max(
        0,
        Number(l.quantityPicked ?? 0) - Number(l.quantityReturned ?? 0)
      )
    }))
    .filter((l) => l.stagedNet > 0 && l.toStorageUnitId);
  if (staged.length === 0) return 0;

  const totalStaged = staged.reduce((sum, l) => sum + l.stagedNet, 0);
  const issued = Number(material.quantityIssued ?? 0);
  let returnable = Math.max(0, totalStaged - Math.max(issued, owed));
  if (returnable <= 0) return 0;

  // Newest-first: return the most recently staged stock, deterministic.
  staged.sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  // Lazy fallback bin for lines picked from an unassigned source.
  let fallbackBin: string | null | undefined;
  const resolveFallbackBin = async () => {
    if (fallbackBin !== undefined) return fallbackBin;
    const pickMethod = await trx
      .selectFrom("pickMethod")
      .where("itemId", "=", material.itemId)
      .where("locationId", "=", locationId)
      .where("companyId", "=", companyId)
      .select("defaultStorageUnitId")
      .executeTakeFirst();
    fallbackBin = pickMethod?.defaultStorageUnitId ?? null;
    return fallbackBin;
  };

  const inserts: ItemLedgerInsert[] = [];
  let totalReturned = 0;
  for (const line of staged) {
    if (returnable <= 0) break;
    const quantity = Math.min(line.stagedNet, returnable);
    // Return target: the line's source bin, else the item's default pick bin,
    // else location-level unassigned stock (mirrors picks from unassigned bins;
    // never strands the return).
    const target = line.storageUnitId ?? (await resolveFallbackBin());

    const base = {
      postingDate: today,
      itemId: line.itemId,
      locationId,
      entryType: "Transfer" as const,
      documentType: "Direct Transfer" as const,
      documentId: line.pickingListId,
      createdBy: userId,
      companyId
    };
    inserts.push(
      { ...base, quantity: round(-quantity), storageUnitId: line.toStorageUnitId },
      { ...base, quantity: round(quantity), storageUnitId: target }
    );

    await trx
      .updateTable("pickingListLine")
      .set((eb: any) => ({
        quantityReturned: eb("quantityReturned", "+", quantity),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      }))
      .where("id", "=", line.id)
      .where("companyId", "=", companyId)
      .execute();

    returnable -= quantity;
    totalReturned += quantity;
  }

  if (totalReturned <= 0) return 0;
  await trx.insertInto("itemLedger").values(inserts).execute();
  return totalReturned;
}

// Sweep every live picking-list line of one operation (scope "operation") or of
// one whole job (scope "job"), returning each material's un-consumed remainder
// and repointing jobMaterial.storageUnitId back at the warehouse source when
// nothing staged remains to consume.
async function runReturnSweep(
  trx: any,
  args: {
    scope: "operation" | "job";
    job: { id: string; quantity: number | string | null; locationId: string };
    opId?: string;
    opQuantityComplete?: number;
    today: string;
    userId: string;
    companyId: string;
  }
) {
  const { scope, job, opId, opQuantityComplete, today, userId, companyId } = args;

  let lineQuery = trx
    .selectFrom("pickingListLine as pll")
    .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
    .where("pll.companyId", "=", companyId)
    .where("pll.jobId", "=", job.id)
    .where("pll.status", "<>", "Cancelled")
    .where("pl.status", "not in", ["Draft", "Cancelled"])
    .select([
      "pll.id",
      "pll.pickingListId",
      "pll.jobMaterialId",
      "pll.jobOperationId",
      "pll.itemId",
      "pll.quantityPicked",
      "pll.quantityReturned",
      "pll.storageUnitId",
      "pll.toStorageUnitId",
      "pll.createdAt"
    ]);
  if (scope === "operation") {
    lineQuery = lineQuery.where("pll.jobOperationId", "=", opId);
  }
  const lines: ReturnSweepLine[] = await lineQuery.execute();
  if (lines.length === 0) return;

  const materialIds = [...new Set(lines.map((l) => l.jobMaterialId))];
  const materials = await trx
    .selectFrom("jobMaterial")
    .where("id", "in", materialIds)
    .where("companyId", "=", companyId)
    .select([
      "id",
      "itemId",
      "jobOperationId",
      "quantityIssued",
      "estimatedQuantity",
      "requiresBatchTracking",
      "requiresSerialTracking"
    ])
    .execute();

  const jobQuantity = Number(job.quantity ?? 0);

  for (const material of materials) {
    const materialLines = lines.filter((l) => l.jobMaterialId === material.id);
    const tracked =
      Boolean(material.requiresBatchTracking) ||
      Boolean(material.requiresSerialTracking);

    // What completion-time backflush is still entitled to consume from lineside.
    // Op scope, material owned by the completing op: its completed quantity is
    // final, so owed = (estimatedQuantity ÷ job quantity) × op completed — the
    // estimated ratio keeps the scrap allowance staged. A material owned by a
    // DIFFERENT (possibly not-yet-run) op has no final quantity yet: hold its
    // full estimate. Job scope: backflush already ran inside
    // complete_job_to_inventory, nothing further is owed.
    let owed = 0;
    if (scope === "operation") {
      const estimated = Number(material.estimatedQuantity ?? 0);
      if (material.jobOperationId === opId && jobQuantity > 0) {
        owed = (estimated / jobQuantity) * Number(opQuantityComplete ?? 0);
      } else {
        owed = estimated;
      }
    }

    if (tracked) {
      for (const line of materialLines) {
        const allocations = await trx
          .selectFrom("pickingListLineTrackedEntity")
          .where("pickingListLineId", "=", line.id)
          .select("trackedEntityId")
          .execute();
        for (const allocation of allocations) {
          await returnTrackedAllocationRemainder(trx, {
            today,
            line,
            trackedEntityId: allocation.trackedEntityId,
            locationId: job.locationId,
            userId,
            companyId
          });
        }
      }
    } else {
      await returnUntrackedMaterialRemainder(trx, {
        today,
        material,
        lines: materialLines,
        owed,
        locationId: job.locationId,
        userId,
        companyId
      });
    }

    await maybeRestoreJobMaterialSource(trx, {
      scope,
      material: { id: material.id, quantityIssued: material.quantityIssued },
      userId,
      companyId
    });
  }
}

// Repoint jobMaterial.storageUnitId back at the warehouse source once nothing
// staged remains for it to consume at lineside. Job scope: the job is done —
// always restore. Op scope: restore only when net staged (Σ picked − returned
// across ALL live lines of the material) is covered by what was already issued —
// otherwise the held-back (owed) stock must stay consumable at lineside by the
// completion-time backflush. Skips the restore when no line has a source bin,
// rather than nulling the pointer.
async function maybeRestoreJobMaterialSource(
  trx: any,
  args: {
    scope: "operation" | "job";
    material: { id: string; quantityIssued: number | string | null };
    userId: string;
    companyId: string;
  }
) {
  const { scope, material, userId, companyId } = args;

  const liveLines = await trx
    .selectFrom("pickingListLine as pll")
    .innerJoin("pickingList as pl", "pl.id", "pll.pickingListId")
    .where("pll.jobMaterialId", "=", material.id)
    .where("pll.companyId", "=", companyId)
    .where("pll.status", "<>", "Cancelled")
    .where("pl.status", "not in", ["Draft", "Cancelled"])
    .select(["pll.storageUnitId", "pll.quantityPicked", "pll.quantityReturned", "pll.createdAt"])
    .execute();

  if (scope === "operation") {
    const netStaged = liveLines.reduce(
      (sum: number, l: ReturnSweepLine) =>
        sum +
        Math.max(0, Number(l.quantityPicked ?? 0) - Number(l.quantityReturned ?? 0)),
      0
    );
    if (netStaged - Number(material.quantityIssued ?? 0) > 0) return;
  }

  const sourceLine = liveLines
    .filter((l: ReturnSweepLine) => l.storageUnitId)
    .sort(
      (a: ReturnSweepLine, b: ReturnSweepLine) =>
        new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    )[0];
  if (!sourceLine) return;

  await restoreJobMaterialSource(
    trx,
    { jobMaterialId: material.id, storageUnitId: sourceLine.storageUnitId },
    userId
  );
}
