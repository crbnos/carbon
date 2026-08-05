import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "npm:zod@^3.24.1";

import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsPreflight, errorResponse, jsonResponse } from "../lib/response.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { CutDemand, StockUnit } from "../lib/cutting/ffd.ts";
import { optimizeCuts1D } from "../lib/cutting/ffd.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

const payloadValidator = z.object({
  cutListId: z.string(),
  companyId: z.string(),
  userId: z.string()
});

serve(async (req: Request) => {
  const preflight = corsPreflight(req);
  if (preflight) return preflight;

  try {
    const payload = await req.json();
    const { cutListId, companyId, userId } = payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "production"
    });

    const result = await db.transaction().execute(async (trx) => {
      const cutList = await trx
        .selectFrom("cutList")
        .where("id", "=", cutListId)
        .where("companyId", "=", companyId)
        .selectAll()
        .executeTakeFirst();

      if (!cutList) {
        throw new Error("Cut list not found");
      }

      // Re-planning a released run would invalidate patterns the operator is
      // already cutting from. Draft only.
      if (cutList.status !== "Draft") {
        throw new Error(
          `Only a draft cut list can be optimized (this one is ${cutList.status})`
        );
      }

      const lines = await trx
        .selectFrom("cutListLine")
        .where("cutListId", "=", cutListId)
        .where("companyId", "=", companyId)
        .selectAll()
        .execute();

      if (lines.length === 0) {
        throw new Error("Cut list has no pieces to plan");
      }

      const itemIds = [...new Set(lines.map((line) => line.itemId))];

      // How long is one unit of each stock item? Without this we cannot know
      // whether a piece fits, so such items contribute no stock at all.
      const stockDimensions = await trx
        .selectFrom("itemStockDimension")
        .where("itemId", "in", itemIds)
        .where("companyId", "=", companyId)
        .select(["itemId", "stockLength"])
        .execute();

      const lengthByItem = new Map(
        stockDimensions
          .filter((d) => d.stockLength !== null)
          .map((d) => [d.itemId, Number(d.stockLength)])
      );

      const entities = await trx
        .selectFrom("trackedEntity")
        .where("itemId", "in", itemIds)
        .where("companyId", "=", companyId)
        .where("status", "=", "Available")
        .select(["id", "itemId", "quantity", "attributes"])
        .execute();

      // Expand lots into individual physical stock units: a lot of three bars
      // is three separate things you can cut from, not 3 "units" of length.
      const stock: StockUnit[] = [];
      const itemsMissingDimensions = new Set<string>();

      for (const entity of entities) {
        if (!entity.itemId) continue;
        const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
        const isRemnant = attributes.Remnant === true;

        if (isRemnant) {
          const length = Number(attributes.Length ?? 0);
          if (length > 0) {
            stock.push({
              stockId: entity.itemId,
              trackedEntityId: entity.id,
              length,
              isRemnant: true
            });
          }
          continue;
        }

        const stockLength = lengthByItem.get(entity.itemId);
        if (!stockLength) {
          itemsMissingDimensions.add(entity.itemId);
          continue;
        }

        const count = Math.floor(Number(entity.quantity ?? 0));
        for (let i = 0; i < count; i++) {
          stock.push({
            stockId: entity.itemId,
            trackedEntityId: entity.id,
            length: stockLength,
            isRemnant: false
          });
        }
      }

      const demands: CutDemand[] = lines.map((line) => ({
        lineId: line.id,
        length: Number(line.pieceLength),
        quantity: Number(line.quantity) - Number(line.quantityCut ?? 0)
      })).filter((demand) => demand.quantity > 0);

      const plan = optimizeCuts1D(demands, stock, {
        kerf: Number(cutList.kerf ?? 0),
        endTrim: Number(cutList.endTrim ?? 0),
        gripMargin: Number(cutList.gripMargin ?? 0),
        minRemnantLength: Number(cutList.minRemnantLength ?? 0)
      });

      // The optimizer owns this cut list's patterns wholesale — a partial
      // rewrite would leave stale sequences interleaved with fresh ones.
      await trx
        .deleteFrom("cutPattern")
        .where("cutListId", "=", cutListId)
        .where("companyId", "=", companyId)
        .execute();

      if (plan.patterns.length > 0) {
        await trx
          .insertInto("cutPattern")
          .values(
            plan.patterns.map((pattern) => ({
              companyId,
              cutListId,
              stockItemId: pattern.stockId,
              trackedEntityId: pattern.trackedEntityId ?? null,
              sequence: pattern.sequence,
              pattern: JSON.stringify(
                pattern.cuts.map((cut) => ({
                  cutListLineId: cut.lineId,
                  pieceLength: cut.length
                }))
              ),
              stockLength: pattern.stockLength,
              piecesLength: pattern.piecesLength,
              expectedRemnant: pattern.expectedRemnant,
              createdBy: userId
            }))
          )
          .execute();
      }

      await trx
        .updateTable("cutList")
        .set({
          plannedYieldPct: plan.yieldPct,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
        .where("id", "=", cutListId)
        .where("companyId", "=", companyId)
        .execute();

      return {
        patternCount: plan.patterns.length,
        yieldPct: plan.yieldPct,
        unplaced: plan.unplaced,
        stockUnitsConsidered: stock.length,
        itemsMissingStockDimensions: [...itemsMissingDimensions]
      };
    });

    console.info(
      `Cut list ${cutListId}: ${result.patternCount} pattern(s), ${result.yieldPct.toFixed(1)}% yield, ${result.unplaced.length} unplaced line(s)`
    );

    return jsonResponse(result);
  } catch (error) {
    console.error(
      `Cut optimization failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return errorResponse(error, 500);
  }
});
