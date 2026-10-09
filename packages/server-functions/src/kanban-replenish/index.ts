// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { toJson } from "@carbon/database/json";
import { getNextSequence } from "@carbon/database/sequence";
import {
  expandSerialTrackedLines,
  isBelowReplenishmentLevel,
  kanbanReplenishmentNote,
  type StockTransferLineDraft
} from "@carbon/database/stock-transfer";
import { getLogger } from "@carbon/logger";
import { type Insertable, sql } from "kysely";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";

const logger = getLogger("server-functions", "kanban-replenish");

export const kanbanReplenishInput = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("scan"), kanbanId: z.string().min(1) }),
  z.object({
    mode: z.literal("level"),
    kanbanIds: z.array(z.string().min(1)).optional()
  })
]);

// The first three are the scan route's own error strings, kept exact.
export const KANBAN_REPLENISH_REASONS = {
  missingStorageUnit: "Kanban is missing a from or to storage unit",
  foreignStorageUnit: "Storage unit does not belong to the kanban location",
  missingItem: "Failed to get item",
  notTransfer: "Kanban is not a transfer kanban",
  notArmed: "Kanban has no replenishment level"
} as const;

type KanbanReplenishReason =
  (typeof KANBAN_REPLENISH_REASONS)[keyof typeof KANBAN_REPLENISH_REASONS];

export type KanbanReplenishOutcome =
  | {
      kanbanId: string;
      outcome: "created";
      id: string;
      stockTransferId: string;
    }
  | { kanbanId: string; outcome: "at-level"; projectedQuantity: number }
  | { kanbanId: string; outcome: "invalid"; reason: KanbanReplenishReason };

export type KanbanReplenishResult = { results: KanbanReplenishOutcome[] };

/**
 * The only writer of a kanban replenishment: a Released stock transfer from a
 * Transfer kanban's From storage unit to its To storage unit, marked with
 * `kanbanId` and a "Kanban replenishment" note.
 *
 * - `scan` always creates (the operator asked for it).
 * - `level` creates only while the projected quantity at the To storage unit
 *   (on-hand + open inbound transfers) is below `replenishmentLevel`, so a
 *   second signal for the same shortfall writes nothing.
 *
 * The kanban rows are locked `FOR UPDATE` in id order, so two signals for one
 * kanban serialise and the second reads the first one's transfer as supply.
 */
const kanbanReplenish = defineServerFn({
  name: "kanban-replenish",
  input: kanbanReplenishInput,
  // Both callers elevate: the scan route after requirePermissions, the job
  // with no user. Every statement below is scoped by companyId.
  permissions: "system",
  async run(ctx, input): Promise<KanbanReplenishResult> {
    const { db, companyId, userId } = ctx;

    if (input.mode === "level" && input.kanbanIds?.length === 0) {
      return { results: [] };
    }

    const { results, created } = await db.transaction().execute(async (trx) => {
      let kanbanQuery = trx
        .selectFrom("kanban")
        .select([
          "id",
          "itemId",
          "locationId",
          "replenishmentSystem",
          "replenishmentLevel",
          "quantity",
          "fromStorageUnitId",
          "storageUnitId"
        ])
        .where("companyId", "=", companyId);

      if (input.mode === "scan") {
        kanbanQuery = kanbanQuery.where("id", "=", input.kanbanId);
      } else if (input.kanbanIds) {
        kanbanQuery = kanbanQuery.where("id", "in", input.kanbanIds);
      } else {
        kanbanQuery = kanbanQuery
          .where("replenishmentSystem", "=", "Transfer")
          .where("replenishmentLevel", "is not", null);
      }

      const kanbans = await kanbanQuery.orderBy("id").forUpdate().execute();

      if (input.mode === "scan" && kanbans.length === 0) {
        throw new NotFoundError("Kanban not found");
      }

      const outcomes = new Map<string, KanbanReplenishOutcome>();
      const invalid = (kanbanId: string, reason: KanbanReplenishReason) =>
        outcomes.set(kanbanId, { kanbanId, outcome: "invalid", reason });

      let candidates = kanbans.filter((kanban) => {
        if (kanban.replenishmentSystem !== "Transfer") {
          invalid(kanban.id, KANBAN_REPLENISH_REASONS.notTransfer);
          return false;
        }
        if (!kanban.fromStorageUnitId || !kanban.storageUnitId) {
          invalid(kanban.id, KANBAN_REPLENISH_REASONS.missingStorageUnit);
          return false;
        }
        if (input.mode === "level" && kanban.replenishmentLevel === null) {
          invalid(kanban.id, KANBAN_REPLENISH_REASONS.notArmed);
          return false;
        }
        return true;
      });

      // CWE-639: both storage units must belong to this company and to the
      // kanban's own location — never trust the stored ids.
      const storageUnitIds = [
        ...new Set(
          candidates.flatMap((kanban) => [
            kanban.fromStorageUnitId!,
            kanban.storageUnitId!
          ])
        )
      ];
      const storageUnits =
        storageUnitIds.length > 0
          ? await trx
              .selectFrom("storageUnit")
              .select(["id", "name", "locationId"])
              .where("companyId", "=", companyId)
              .where("id", "in", storageUnitIds)
              .execute()
          : [];
      const storageUnitById = new Map(storageUnits.map((su) => [su.id, su]));

      candidates = candidates.filter((kanban) => {
        const from = storageUnitById.get(kanban.fromStorageUnitId!);
        const to = storageUnitById.get(kanban.storageUnitId!);
        if (
          !from ||
          !to ||
          from.locationId !== kanban.locationId ||
          to.locationId !== kanban.locationId
        ) {
          invalid(kanban.id, KANBAN_REPLENISH_REASONS.foreignStorageUnit);
          return false;
        }
        return true;
      });

      const projectedByKanban = new Map<string, number>();
      if (input.mode === "level" && candidates.length > 0) {
        const projected = await sql<{
          kanbanId: string;
          replenishmentLevel: number;
          projectedQuantity: number;
        }>`
            SELECT * FROM get_kanban_projected_quantities(
              ${companyId},
              ${candidates.map((kanban) => kanban.id)}::text[]
            )
          `.execute(trx);

        for (const row of projected.rows) {
          projectedByKanban.set(row.kanbanId, Number(row.projectedQuantity));
        }

        candidates = candidates.filter((kanban) => {
          const projectedQuantity = projectedByKanban.get(kanban.id) ?? 0;
          if (
            !isBelowReplenishmentLevel(
              projectedQuantity,
              Number(kanban.replenishmentLevel)
            )
          ) {
            outcomes.set(kanban.id, {
              kanbanId: kanban.id,
              outcome: "at-level",
              projectedQuantity
            });
            return false;
          }
          return true;
        });
      }

      const itemIds = [...new Set(candidates.map((kanban) => kanban.itemId))];
      const items =
        itemIds.length > 0
          ? await trx
              .selectFrom("item")
              .select([
                "id",
                "readableIdWithRevision",
                "itemTrackingType",
                "unitOfMeasureCode"
              ])
              .where("companyId", "=", companyId)
              .where("id", "in", itemIds)
              .execute()
          : [];
      const itemById = new Map(items.map((item) => [item.id, item]));

      candidates = candidates.filter((kanban) => {
        if (!itemById.has(kanban.itemId)) {
          invalid(kanban.id, KANBAN_REPLENISH_REASONS.missingItem);
          return false;
        }
        return true;
      });

      if (candidates.length === 0) {
        return {
          results: kanbans.map((kanban) => outcomes.get(kanban.id)!),
          created: [] as KanbanReplenishOutcome[]
        };
      }

      let scannerName = "unknown user";
      if (input.mode === "scan") {
        const user = await trx
          .selectFrom("user")
          .select("fullName")
          .where("id", "=", userId)
          .executeTakeFirst();
        // A user with no last name has a fullName ending in a space.
        scannerName = user?.fullName?.trim() || scannerName;
      }

      const headers: Insertable<KyselyDatabase["stockTransfer"]>[] = [];
      for (const kanban of candidates) {
        const item = itemById.get(kanban.itemId)!;
        const stockTransferId = await getNextSequence(
          trx,
          "stockTransfer",
          companyId
        );
        const note = kanbanReplenishmentNote({
          itemReadableId: item.readableIdWithRevision ?? kanban.itemId,
          fromStorageUnitName:
            storageUnitById.get(kanban.fromStorageUnitId!)?.name ?? "",
          toStorageUnitName:
            storageUnitById.get(kanban.storageUnitId!)?.name ?? "",
          quantity: kanban.quantity,
          unitOfMeasureCode: item.unitOfMeasureCode,
          signal:
            input.mode === "scan"
              ? { type: "scan", userName: scannerName }
              : {
                  type: "level",
                  replenishmentLevel: Number(kanban.replenishmentLevel),
                  projectedQuantity: projectedByKanban.get(kanban.id) ?? 0
                }
        });
        headers.push({
          stockTransferId,
          locationId: kanban.locationId,
          status: "Released" as const,
          companyId,
          kanbanId: kanban.id,
          notes: toJson(note),
          createdBy: userId
        });
      }

      const inserted = await trx
        .insertInto("stockTransfer")
        .values(headers)
        .returning(["id", "kanbanId", "stockTransferId"])
        .execute();
      const headerByKanban = new Map(
        inserted.map((header) => [header.kanbanId!, header])
      );

      const lines = candidates.flatMap((kanban) => {
        const item = itemById.get(kanban.itemId)!;
        const header = headerByKanban.get(kanban.id)!;
        const draft: StockTransferLineDraft = {
          itemId: kanban.itemId,
          fromStorageUnitId: kanban.fromStorageUnitId,
          toStorageUnitId: kanban.storageUnitId,
          quantity: kanban.quantity,
          requiresSerialTracking: item.itemTrackingType === "Serial",
          requiresBatchTracking: item.itemTrackingType === "Batch"
        };
        return expandSerialTrackedLines([draft]).map((line) => ({
          itemId: line.itemId,
          fromStorageUnitId: line.fromStorageUnitId ?? null,
          toStorageUnitId: line.toStorageUnitId ?? null,
          quantity: line.quantity ?? 0,
          requiresSerialTracking: line.requiresSerialTracking ?? false,
          requiresBatchTracking: line.requiresBatchTracking ?? false,
          stockTransferId: header.id,
          companyId,
          createdBy: userId
        }));
      });

      if (lines.length > 0) {
        await trx.insertInto("stockTransferLine").values(lines).execute();
      }

      const createdOutcomes: KanbanReplenishOutcome[] = [];
      for (const kanban of candidates) {
        const header = headerByKanban.get(kanban.id)!;
        const outcome: KanbanReplenishOutcome = {
          kanbanId: kanban.id,
          outcome: "created",
          id: header.id,
          stockTransferId: header.stockTransferId
        };
        outcomes.set(kanban.id, outcome);
        createdOutcomes.push(outcome);
      }

      return {
        results: kanbans.map((kanban) => outcomes.get(kanban.id)!),
        created: createdOutcomes
      };
    });

    for (const outcome of created) {
      if (outcome.outcome !== "created") continue;
      logger.info("Kanban replenishment created", {
        companyId,
        kanbanId: outcome.kanbanId,
        stockTransferId: outcome.stockTransferId,
        mode: input.mode
      });
    }

    return { results };
  }
});

export default kanbanReplenish;
