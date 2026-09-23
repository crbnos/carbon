import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { type CalendarDate, parseDate } from "@internationalized/date";
import { nanoid } from "https://deno.land/x/nanoid@v3.0.0/nanoid.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { sql } from "kysely";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { datetime, getCompanyTimeZone } from "../lib/datetime.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import type { Database } from "../lib/types.ts";
import { buildBatchSplitRecords, isFullDraw } from "../shared/batch-split.ts";
import { round } from "../shared/precision.ts";
import {
  assertEntityCoversPick,
  PickGuardError,
  resolvePick,
} from "../shared/pick-guards.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

async function getExpiredEntityPolicy(companyId: string): Promise<ExpiredEntityPolicy> {
  const row = await db
    .selectFrom("companySettings")
    .select("inventoryShelfLife")
    .where("id", "=", companyId)
    .executeTakeFirst();
  const blob = row?.inventoryShelfLife as
    | { expiredEntityPolicy?: ExpiredEntityPolicy }
    | null;
  return blob?.expiredEntityPolicy ?? "Block";
}

/**
 * Reject expiry-violating consumption based on the company's policy.
 * Returns the warning message when policy is 'Warn' so callers can echo
 * it back in the response. Throws an Error in all reject cases so the
 * outer try/catch surfaces it as a 400.
 */
function checkExpiredEntity(
  entity: { id: string; expirationDate: string | null },
  policy: ExpiredEntityPolicy,
  override: { allowed: boolean; reason: string | null },
  today: CalendarDate
): { warning?: string } {
  if (!entity.expirationDate) return {};
  try {
    if (parseDate(entity.expirationDate).compare(today) >= 0) return {};
  } catch {
    return {};
  }

  if (policy === "Warn") {
    return { warning: `Transferred expired tracked entity: ${entity.id}` };
  }

  if (
    policy === "BlockWithOverride" &&
    override.allowed &&
    override.reason &&
    override.reason.trim().length > 0
  ) {
    return {};
  }

  throw new Error(`Cannot transfer expired tracked entity: ${entity.id}`);
}

const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inventory"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    quantity: z.number().positive(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
  z.object({
    type: z.literal("unpickInventory"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
  z.object({
    type: z.literal("serial"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
  z.object({
    type: z.literal("batch"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    fromStorageUnitId: z.string().nullable(),
    quantity: z.number().positive(),
    overrideExpired: z.boolean().optional(),
    overrideReason: z.string().optional(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
  z.object({
    type: z.literal("unpickSerial"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
  z.object({
    type: z.literal("unpickBatch"),
    stockTransferId: z.string(),
    stockTransferLineId: z.string(),
    trackedEntityId: z.string(),
    locationId: z.string(),
    userId: z.string(),
    companyId: z.string(),
  }),
]);

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  const payload = await req.json();

  try {
    const validatedPayload = payloadValidator.parse(payload);
    const companyToday = datetime.today(await getCompanyTimeZone(db, validatedPayload.companyId));
    const today = companyToday.toString();
    let expiredWarning: string | undefined;
    let splitEntityId: string | undefined;

    console.log({
      function: "post-stock-transfer",
      ...validatedPayload,
    });

    switch (validatedPayload.type) {
      case "inventory": {
        const {
          stockTransferId,
          stockTransferLineId,
          quantity,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Get stock transfer line details
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          // Create item ledger entries for inventory transfer
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(-quantity),
            locationId: locationId,
            storageUnitId: stockTransferLine.fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            createdBy: userId,
            companyId,
          });

          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: round(quantity),
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            createdBy: userId,
            companyId,
          });

          // Insert item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          // Update stock transfer line with picked quantity
          await trx
            .updateTable("stockTransferLine")
            .set({
              pickedQuantity:
                (stockTransferLine.pickedQuantity ?? 0) + quantity,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }

      case "unpickInventory": {
        const {
          stockTransferId,
          stockTransferLineId,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Get stock transfer line details
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .executeTakeFirstOrThrow();

          const currentPickedQuantity = stockTransferLine.pickedQuantity ?? 0;

          if (currentPickedQuantity > 0) {
            const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
              [];

            // Create reverse item ledger entries to undo the transfer
            itemLedgerInserts.push({
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(currentPickedQuantity), // Positive to restore inventory at from shelf
              locationId: locationId,
              storageUnitId: stockTransferLine.fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              createdBy: userId,
              companyId,
            });

            itemLedgerInserts.push({
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-currentPickedQuantity), // Negative to remove inventory from to shelf
              locationId: locationId,
              storageUnitId: stockTransferLine.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              createdBy: userId,
              companyId,
            });

            // Insert reverse item ledger entries
            if (itemLedgerInserts.length > 0) {
              await trx
                .insertInto("itemLedger")
                .values(itemLedgerInserts)
                .execute();
            }
          }

          // Reset picked quantity to 0
          await trx
            .updateTable("stockTransferLine")
            .set({
              trackedEntityId: null,
              pickedQuantity: 0,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }

      case "serial": {
        const {
          fromStorageUnitId,
          stockTransferId,
          stockTransferLineId,
          trackedEntityId,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Get stock transfer line details. Lock the row so concurrent scans
          // of the same line cannot both write a +1 over a stale read.
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Refuse a scan that would exceed the line's serial count.
          const newPickedQuantity = resolvePick({
            lineQuantity: Number(stockTransferLine.quantity ?? 0),
            pickedQuantity: Number(stockTransferLine.pickedQuantity ?? 0),
            transferQuantity: 1,
          });

          // Lock the serial itself BEFORE the repeat-scan query: the guard
          // below reads trackedActivityInput, and two concurrent scans of the
          // same serial would both read "not on this transfer" and both post a
          // Transfer activity + ledger pair. The batch case takes the same
          // lock; here it serializes the guard rather than an on-hand draw.
          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .select(["id", "readableId"])
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Refuse a REPEAT scan of the same serial on this transfer. Each scan
          // posts a Transfer activity + a −1/+1 ledger pair, so a silent no-op
          // would let the ledger double; the guard is an explicit 400.
          const alreadyOnTransfer = await trx
            .selectFrom("trackedActivityInput as tai")
            .innerJoin("trackedActivity as ta", "ta.id", "tai.trackedActivityId")
            .where("tai.trackedEntityId", "=", trackedEntityId)
            .where("tai.companyId", "=", companyId)
            .where("ta.type", "=", "Transfer")
            .where("ta.sourceDocument", "=", "Stock Transfer")
            .where("ta.sourceDocumentId", "=", stockTransferId)
            .select("tai.trackedEntityId")
            .executeTakeFirst();
          if (alreadyOnTransfer) {
            throw new PickGuardError(
              "already-picked",
              `Serial ${trackedEntity.readableId ?? trackedEntityId} is already picked on this transfer`
            );
          }

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          // Create transfer activity
          const transferActivityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: transferActivityId,
              type: "Transfer",
              sourceDocument: "Stock Transfer",
              sourceDocumentId: stockTransferId,
              attributes: {
                "Stock Transfer": stockTransferId,
                "Stock Transfer Line": stockTransferLineId,
                "From Location": locationId,
                "To Location": locationId,
                // The line's own column is overwritten with this same payload
                // value later in the transaction — read the payload directly.
                "From Shelf": fromStorageUnitId,
                "To Shelf": stockTransferLine.toStorageUnitId,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          // Record tracked entity as input to transfer
          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: transferActivityId,
              trackedEntityId: trackedEntityId,
              quantity: 1,
              companyId,
              createdBy: userId,
            })
            .execute();

          // Create item ledger entries for transfer
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: -1,
            locationId: locationId,
            storageUnitId: fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId,
          });

          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: 1,
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId,
          });

          // Insert item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          // Update stock transfer line with the accumulated picked quantity.
          await trx
            .updateTable("stockTransferLine")
            .set({
              trackedEntityId,
              fromStorageUnitId: fromStorageUnitId,
              pickedQuantity: newPickedQuantity,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }

      case "batch": {
        const {
          fromStorageUnitId,
          stockTransferId,
          stockTransferLineId,
          trackedEntityId,
          quantity,
          overrideExpired,
          overrideReason,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        const policy = await getExpiredEntityPolicy(companyId);

        await db.transaction().execute(async (trx) => {
          // Get stock transfer line details. Lock the row so two concurrent
          // scans of the same line accumulate instead of racing to overwrite
          // pickedQuantity (the ledger would double otherwise).
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Get tracked entity details. Lock it too so the on-hand this pick
          // draws against cannot be spent by a concurrent transaction.
          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Refuse a pick that over-draws the line or the source lot before any
          // record is written; resolvePick returns the new running total.
          const newPickedQuantity = resolvePick({
            lineQuantity: Number(stockTransferLine.quantity ?? 0),
            pickedQuantity: Number(stockTransferLine.pickedQuantity ?? 0),
            transferQuantity: quantity,
          });
          assertEntityCoversPick({
            entityQuantity: Number(trackedEntity.quantity),
            transferQuantity: quantity,
          });

          // Expiry policy gate (throws on hard reject; returns warning for 'Warn').
          const expiredCheck = checkExpiredEntity(
            { id: trackedEntity.id, expirationDate: trackedEntity.expirationDate },
            policy,
            { allowed: !!overrideExpired, reason: overrideReason ?? null },
            companyToday
          );
          if (expiredCheck.warning) {
            expiredWarning = expiredCheck.warning;
          }

          // Round BOTH operands once, here: everything downstream — the split
          // gate, the split records, the Transfer activity input and the two
          // ledger rows — derives from these, so a residue draw can never book
          // an unrounded quantity against a lot the gate treated as whole.
          const entityQuantity = round(Number(trackedEntity.quantity));
          const transferQuantity = round(quantity);
          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          // Split the batch when transferring less than the whole entity: the
          // source entity keeps its id and is decremented; a NEW child entity
          // departs to the destination bin with the transfer quantity.
          let transferredEntityId = trackedEntityId;
          if (!isFullDraw(entityQuantity, transferQuantity)) {
            const childId = nanoid();
            splitEntityId = childId;
            transferredEntityId = childId;

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
                > | null,
              },
              drawQuantity: transferQuantity,
              childId,
              splitActivityId: nanoid(),
              activitySourceDocument: "Stock Transfer",
              activitySourceDocumentId: stockTransferId,
              bin: { storageUnitId: fromStorageUnitId, locationId },
              itemLedgerItemId: stockTransferLine.itemId,
              companyId,
              userId,
              postingDate: today,
              childStatus: "Available",
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

            itemLedgerInserts.push(
              ...split.ledgerInserts.map((ledgerRow) => ({
                ...ledgerRow,
                quantity: round(ledgerRow.quantity),
              }))
            );
          }

          // Create transfer activity
          const transferActivityId = nanoid();
          await trx
            .insertInto("trackedActivity")
            .values({
              id: transferActivityId,
              type: "Transfer",
              sourceDocument: "Stock Transfer",
              sourceDocumentId: stockTransferId,
              attributes: {
                "Stock Transfer": stockTransferId,
                "Stock Transfer Line": stockTransferLineId,
                "From Location": locationId,
                "To Location": locationId,
                // The line's own column is overwritten with this same payload
                // value later in the transaction — read the payload directly.
                "From Shelf": fromStorageUnitId,
                "To Shelf": stockTransferLine.toStorageUnitId,
              },
              companyId,
              createdBy: userId,
            })
            .execute();

          // Record the DEPARTING entity (split child, or the whole entity on
          // a full-quantity transfer) as input to the transfer.
          await trx
            .insertInto("trackedActivityInput")
            .values({
              trackedActivityId: transferActivityId,
              trackedEntityId: transferredEntityId,
              quantity: transferQuantity,
              companyId,
              createdBy: userId,
            })
            .execute();

          // A transfer MOVES the batch between bins — it stays Available
          // (consumed at production). Matches the serial case and post-picking.

          // Create item ledger entries for transfer
          itemLedgerInserts.push(
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-transferQuantity),
              locationId: locationId,
              storageUnitId: fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              trackedEntityId: transferredEntityId,
              createdBy: userId,
              companyId,
            },
            {
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(transferQuantity),
              locationId: locationId,
              storageUnitId: stockTransferLine.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              trackedEntityId: transferredEntityId,
              createdBy: userId,
              companyId,
            }
          );

          // Insert item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          // Update stock transfer line with the accumulated picked quantity.
          // trackedEntityId is keep-last: each partial pick mints a fresh child
          // entity, so the line points at the newest departing lot (matching
          // serial). Unpick reverses only the last activity on such a line.
          await trx
            .updateTable("stockTransferLine")
            .set({
              trackedEntityId: transferredEntityId,
              fromStorageUnitId: fromStorageUnitId,
              pickedQuantity: newPickedQuantity,
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }

      case "unpickSerial": {
        const {
          stockTransferId,
          stockTransferLineId,
          trackedEntityId,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Lock the line AND the entity: an unpick read-modify-writes the
          // entity's quantity/status and the line's pickedQuantity, so two
          // concurrent unpicks of the same child would both credit the parent
          // and both decrement the line off the same stale read. Same locks the
          // pick paths take.
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Find the transfer activity for this tracked entity
          const transferActivity = await trx
            .selectFrom("trackedActivity")
            .innerJoin(
              "trackedActivityInput",
              "trackedActivity.id",
              "trackedActivityInput.trackedActivityId"
            )
            .where("trackedActivity.type", "=", "Transfer")
            .where("trackedActivity.sourceDocument", "=", "Stock Transfer")
            .where("trackedActivity.sourceDocumentId", "=", stockTransferId)
            .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
            .where("trackedActivity.companyId", "=", companyId)
            .selectAll("trackedActivity")
            .executeTakeFirstOrThrow();

          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          // Create reverse item ledger entries to undo the transfer
          // First, remove the entity from the destination shelf (toStorageUnitId)
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: -1, // Negative to remove inventory from to shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.toStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId,
          });

          // Then, restore the entity to the source shelf (fromStorageUnitId)
          itemLedgerInserts.push({
            postingDate: today,
            itemId: stockTransferLine.itemId,
            quantity: 1, // Positive to restore inventory at from shelf
            locationId: locationId,
            storageUnitId: stockTransferLine.fromStorageUnitId,
            entryType: "Transfer",
            documentType: "Direct Transfer",
            documentId: stockTransferId,
            trackedEntityId: trackedEntityId,
            createdBy: userId,
            companyId,
          });

          // Insert reverse item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          // Delete the tracked activity and its related records
          await trx
            .deleteFrom("trackedActivityInput")
            .where("trackedActivityId", "=", transferActivity.id!)
            .execute();

          await trx
            .deleteFrom("trackedActivity")
            .where("id", "=", transferActivity.id!)
            .execute();

          // Update tracked entity status back to available and restore shelf location
          await trx
            .updateTable("trackedEntity")
            .set({
              status: "Available",
              attributes: {
                ...(trackedEntity.attributes as Record<string, unknown>),
                Shelf: stockTransferLine.fromStorageUnitId,
              },
            })
            .where("id", "=", trackedEntityId)
            .execute();

          // Update stock transfer line with reduced picked quantity
          await trx
            .updateTable("stockTransferLine")
            .set({
              trackedEntityId: null,
              pickedQuantity: Math.max(
                0,
                (stockTransferLine.pickedQuantity ?? 0) - 1
              ),
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }

      case "unpickBatch": {
        const {
          stockTransferId,
          stockTransferLineId,
          trackedEntityId,
          locationId,
          userId,
          companyId,
        } = validatedPayload;

        await db.transaction().execute(async (trx) => {
          // Lock the line AND the entity: an unpick read-modify-writes the
          // entity's quantity/status and the line's pickedQuantity, so two
          // concurrent unpicks of the same child would both credit the parent
          // and both decrement the line off the same stale read. Same locks the
          // pick paths take.
          const stockTransferLine = await trx
            .selectFrom("stockTransferLine")
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          const trackedEntity = await trx
            .selectFrom("trackedEntity")
            .where("id", "=", trackedEntityId)
            .where("companyId", "=", companyId)
            .selectAll()
            .forUpdate()
            .executeTakeFirstOrThrow();

          // Find the transfer activity for this tracked entity
          const transferActivity = await trx
            .selectFrom("trackedActivity")
            .innerJoin(
              "trackedActivityInput",
              "trackedActivity.id",
              "trackedActivityInput.trackedActivityId"
            )
            .where("trackedActivity.type", "=", "Transfer")
            .where("trackedActivity.sourceDocument", "=", "Stock Transfer")
            .where("trackedActivity.sourceDocumentId", "=", stockTransferId)
            .where("trackedActivityInput.trackedEntityId", "=", trackedEntityId)
            .where("trackedActivity.companyId", "=", companyId)
            .selectAll("trackedActivity")
            .executeTakeFirstOrThrow();

          // The whole child returns to its parent, so round once here and let
          // the parent increase, the ledger pair and the pickedQuantity
          // decrement all derive from the same value.
          const transferQuantity = round(Number(trackedEntity.quantity));

          // Re-checked UNDER the lock: a lot holding nothing has either already
          // been unpicked or been consumed at production. Either way there is
          // nothing to return, and proceeding would delete the transfer
          // activity and reset pickedQuantity for a no-op.
          if (transferQuantity <= 0) {
            throw new PickGuardError(
              "already-picked",
              `Lot ${trackedEntity.readableId ?? trackedEntityId} has no quantity left to unpick`
            );
          }
          const itemLedgerInserts: Database["public"]["Tables"]["itemLedger"]["Insert"][] =
            [];

          const entityAttributes = (trackedEntity.attributes ?? {}) as Record<
            string,
            unknown
          >;
          // New convention: the line's entity is a split CHILD carrying a
          // back-pointer to the parent that stayed at the source bin.
          const splitFromParentId = entityAttributes["Split From Entity ID"] as
            | string
            | undefined;
          // Legacy convention (pre-flip rows): the departed ORIGINAL carries a
          // forward pointer to the remainder entity it left behind.
          const legacyRemainderId = entityAttributes["Split Entity ID"] as
            | string
            | undefined;

          if (splitFromParentId) {
            // Merge the child fully back into its parent and delete the Split
            // — a clean undo, as if the partial transfer never happened.
            // Locked too — its quantity is incremented from this read.
            const parent = await trx
              .selectFrom("trackedEntity")
              .where("id", "=", splitFromParentId)
              .where("companyId", "=", companyId)
              .selectAll()
              .forUpdate()
              .executeTakeFirstOrThrow();

            await trx
              .updateTable("trackedEntity")
              .set({
                quantity: round(round(Number(parent.quantity)) + transferQuantity),
              })
              .where("id", "=", parent.id)
              .execute();

            // Drain the child (don't delete it — ledger history keeps the FK).
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed",
                quantity: 0,
              })
              .where("id", "=", trackedEntityId)
              .execute();

            itemLedgerInserts.push(
              {
                postingDate: today,
                itemId: stockTransferLine.itemId,
                quantity: round(-transferQuantity), // drain the child at the destination
                locationId: locationId,
                storageUnitId: stockTransferLine.toStorageUnitId,
                entryType: "Negative Adjmt.",
                documentType: "Direct Transfer",
                documentId: stockTransferId!,
                trackedEntityId: trackedEntityId,
                createdBy: userId,
                companyId,
              },
              {
                postingDate: today,
                itemId: stockTransferLine.itemId,
                quantity: round(transferQuantity), // restore the parent at the source
                locationId: locationId,
                storageUnitId: stockTransferLine.fromStorageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Direct Transfer",
                documentId: stockTransferId!,
                trackedEntityId: parent.id,
                createdBy: userId,
                companyId,
              }
            );

            // Delete the Split activity that minted the child — scoped to the
            // entity AND this transfer (a bare sourceDocumentId lookup grabs
            // a sibling line's split on multi-line transfers).
            const splitActivity = await trx
              .selectFrom("trackedActivity")
              .where("type", "=", "Split")
              .where("sourceDocument", "=", "Stock Transfer")
              .where("sourceDocumentId", "=", stockTransferId)
              .where(
                sql<boolean>`attributes->>'Split Entity ID' = ${trackedEntityId}`
              )
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirst();

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
          } else if (legacyRemainderId) {
            // This entity was created from a split, need to merge it back
            const originalEntity = await trx
              .selectFrom("trackedEntity")
              .where("id", "=", legacyRemainderId)
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirstOrThrow();

            const originalQuantity = round(
              round(Number(originalEntity.quantity)) + transferQuantity
            );

            // Find the split activity — scoped to the remainder entity this
            // pointer names, not just the transfer (multi-line safety).
            const splitActivity = await trx
              .selectFrom("trackedActivity")
              .where("type", "=", "Split")
              .where("sourceDocument", "=", "Stock Transfer")
              .where("sourceDocumentId", "=", stockTransferId)
              .where(
                sql<boolean>`attributes->>'Split Entity ID' = ${legacyRemainderId}`
              )
              .where("companyId", "=", companyId)
              .selectAll()
              .executeTakeFirstOrThrow();

            // Update original entity with merged quantity and restore shelf location
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Consumed",
                quantity: 0,
              })
              .where("id", "=", legacyRemainderId)
              .execute();

            // Mark the split entity as consumed (don't delete it)
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                quantity: originalQuantity,
              })
              .where("id", "=", trackedEntityId)
              .execute();

            // Create item ledger entries for merge
            // Both entities are on the fromStorageUnitId during the merge operation
            itemLedgerInserts.push(
              {
                postingDate: today,
                itemId: stockTransferLine.itemId,
                quantity: round(originalQuantity), // zero out the split entity
                locationId: locationId,
                storageUnitId: stockTransferLine.fromStorageUnitId,
                entryType: "Positive Adjmt.",
                documentType: "Direct Transfer",
                documentId: stockTransferId!,
                trackedEntityId: trackedEntityId,
                createdBy: userId,
                companyId,
              },
              {
                postingDate: today,
                itemId: stockTransferLine.itemId,
                quantity: round(-transferQuantity), // Positive to restore to original entity
                locationId: locationId,
                storageUnitId: stockTransferLine.toStorageUnitId, // Both entities are on the source shelf
                entryType: "Negative Adjmt.",
                documentType: "Direct Transfer",
                documentId: stockTransferId!,
                trackedEntityId: trackedEntityId,
                createdBy: userId,
                companyId,
              },
              {
                postingDate: today,
                itemId: stockTransferLine.itemId,
                quantity: round(-(originalQuantity - transferQuantity)), // Positive to restore to original entity
                locationId: locationId,
                storageUnitId: stockTransferLine.fromStorageUnitId, // Both entities are on the source shelf
                entryType: "Negative Adjmt.",
                documentType: "Direct Transfer",
                documentId: stockTransferId!,
                trackedEntityId: legacyRemainderId,
                createdBy: userId,
                companyId,
              }
            );

            // Delete split activity records
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
          } else {
            // This was a direct transfer, just restore the entity and shelf location
            await trx
              .updateTable("trackedEntity")
              .set({
                status: "Available",
                attributes: {
                  ...(trackedEntity.attributes as Record<string, unknown>),
                  Shelf: stockTransferLine.fromStorageUnitId,
                },
              })
              .where("id", "=", trackedEntityId)
              .execute();

            // Create reverse item ledger entries to undo the transfer
            itemLedgerInserts.push({
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(transferQuantity), // Positive to restore inventory at from shelf
              locationId: locationId,
              storageUnitId: stockTransferLine.fromStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              trackedEntityId: trackedEntityId,
              createdBy: userId,
              companyId,
            });

            itemLedgerInserts.push({
              postingDate: today,
              itemId: stockTransferLine.itemId,
              quantity: round(-transferQuantity), // Negative to remove inventory from to shelf
              locationId: locationId,
              storageUnitId: stockTransferLine.toStorageUnitId,
              entryType: "Transfer",
              documentType: "Direct Transfer",
              documentId: stockTransferId,
              trackedEntityId: trackedEntityId,
              createdBy: userId,
              companyId,
            });
          }

          // Insert item ledger entries
          if (itemLedgerInserts.length > 0) {
            await trx
              .insertInto("itemLedger")
              .values(itemLedgerInserts)
              .execute();
          }

          // Delete the transfer activity and its related records
          await trx
            .deleteFrom("trackedActivityInput")
            .where("trackedActivityId", "=", transferActivity.id!)
            .execute();

          await trx
            .deleteFrom("trackedActivity")
            .where("id", "=", transferActivity.id!)
            .execute();

          // Update stock transfer line with reduced picked quantity
          await trx
            .updateTable("stockTransferLine")
            .set({
              trackedEntityId: null,
              pickedQuantity: Math.max(
                0,
                round(round(stockTransferLine.pickedQuantity ?? 0) - transferQuantity)
              ),
              updatedBy: userId,
              updatedAt: new Date().toISOString(),
            })
            .where("id", "=", stockTransferLineId)
            .where("companyId", "=", companyId)
            .execute();
        });

        break;
      }
    }

    return jsonResponse({
      success: true,
      warning: expiredWarning,
      splitEntityId,
    });
  } catch (err) {
    // A pick guard is a caller-input refusal, not a server fault — surface it
    // as a 400 with its message so the scan UI can show "already fully picked"
    // instead of a generic failure.
    const status = err instanceof PickGuardError ? 400 : 500;
    return errorResponse(err, status);
  }
});
