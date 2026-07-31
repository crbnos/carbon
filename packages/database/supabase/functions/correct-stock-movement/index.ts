import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { requirePermissions } from "../lib/supabase.ts";
import { getAccountingPeriodForDate } from "../shared/get-accounting-period.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import { bookAdjustment } from "../shared/post-adjustment.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("correct-stock-movement");

// Corrects a posted stock movement by inserting ONE opposite (delta) movement
// linked to the original via itemLedger.correctionOfItemLedgerId. The caller
// supplies the SIGNED quantity the movement should have been; the delta is
// derived against the movement's current effective quantity (original + all
// prior corrections in its group), so repeated corrections converge.
//
// The correction carries the ORIGINAL movement's postingDate and posts its GL
// journal into the accounting period containing that date (fails when that
// period is Locked/Closed). entryNumber is a SERIAL and cannot be
// retro-inserted — "next to the original" is delivered by the postingDate and
// by the stock-movements UI, which nests corrections under their original.
const payloadValidator = z.object({
  itemLedgerId: z.string(),
  // SIGNED corrected quantity, matching the ledger's sign convention
  // (a shipment of -5 that should have been -3 → correctedQuantity: -3).
  correctedQuantity: z.number(),
  comment: z.string().optional().nullable(),
  companyId: z.string(),
  userId: z.string(),
});

class ValidationError extends Error {}

const MAX_CORRECTION_CHAIN_DEPTH = 100;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { itemLedgerId, correctedQuantity, comment, companyId, userId } =
      payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "inventory",
    });

    const ledgerColumns =
      "id, itemId, locationId, storageUnitId, trackedEntityId, quantity, postingDate, entryType, documentType, documentId, correctionOfItemLedgerId";

    const originalResult = await client
      .from("itemLedger")
      .select(ledgerColumns)
      .eq("id", itemLedgerId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (originalResult.error) throw new Error("Failed to fetch stock movement");
    if (!originalResult.data) {
      throw new ValidationError("Stock movement not found");
    }

    // Walk up to the topmost ancestor: corrections always link to the ROOT so
    // the group stays flat and its effective quantity is a simple sum.
    let root = originalResult.data;
    for (
      let depth = 0;
      root.correctionOfItemLedgerId && depth < MAX_CORRECTION_CHAIN_DEPTH;
      depth++
    ) {
      const parent = await client
        .from("itemLedger")
        .select(ledgerColumns)
        .eq("id", root.correctionOfItemLedgerId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (parent.error) throw new Error("Failed to fetch stock movement");
      // Broken link (no FK on correctionOfItemLedgerId): treat the current row
      // as the root rather than failing the correction.
      if (!parent.data) break;
      root = parent.data;
    }

    // Collect the whole correction group (historical count corrections chained
    // fix→fix, so descendants can be more than one level deep).
    let effectiveQuantity = Number(root.quantity);
    let frontier = [root.id];
    const seen = new Set<string>([root.id]);
    while (frontier.length > 0) {
      const children = await client
        .from("itemLedger")
        .select("id, quantity")
        .in("correctionOfItemLedgerId", frontier)
        .eq("companyId", companyId);
      if (children.error) throw new Error("Failed to fetch corrections");
      frontier = [];
      for (const child of children.data ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        effectiveQuantity += Number(child.quantity);
        frontier.push(child.id);
      }
    }

    const delta = correctedQuantity - effectiveQuantity;
    if (delta === 0) {
      throw new ValidationError(
        "Corrected quantity matches the current effective quantity — nothing to correct"
      );
    }

    // A correction row shows only its delta (+4), which doesn't tell the reader
    // the from→to intent — so when the user gives no reason, self-document it.
    const resolvedComment =
      comment?.trim() ||
      `Corrected from ${effectiveQuantity} to ${correctedQuantity}`;

    const [itemResult, itemCostResult, accountingSettings, trackingQuantities] =
      await Promise.all([
        client
          .from("item")
          .select("id, itemTrackingType, replenishmentSystem")
          .eq("id", root.itemId)
          .eq("companyId", companyId)
          .single(),
        client
          .from("itemCost")
          .select("costingMethod, unitCost, standardCost, itemPostingGroupId")
          .eq("itemId", root.itemId)
          .eq("companyId", companyId)
          .single(),
        client
          .from("companySettings")
          .select("accountingEnabled")
          .eq("id", companyId)
          .single(),
        root.locationId
          ? client.rpc("get_item_quantities_by_tracking_id", {
              item_id: root.itemId,
              company_id: companyId,
              location_id: root.locationId,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);

    if (itemResult.error) throw new Error("Failed to fetch item");
    if (itemCostResult.error) throw new Error("Failed to fetch item cost");
    if (accountingSettings.error) {
      throw new Error("Failed to fetch company settings");
    }
    // Fail closed: a failed quantity read must abort, not read as "no stock".
    if (trackingQuantities.error) {
      throw new Error("Failed to fetch current quantities");
    }

    const item = {
      itemTrackingType: itemResult.data.itemTrackingType,
      replenishmentSystem: itemResult.data.replenishmentSystem,
      itemPostingGroupId: itemCostResult.data.itemPostingGroupId,
    };

    const isSerial = item.itemTrackingType === "Serial";
    if (isSerial) {
      if (!Number.isInteger(delta)) {
        throw new ValidationError(
          "Corrections on serial-tracked items must be whole numbers"
        );
      }
      // A serial number is a single unique unit — the corrected movement can
      // never carry more than one of it (matches inventoryAdjustmentValidator).
      if (Math.abs(correctedQuantity) > 1) {
        throw new ValidationError("Serial items can only have a quantity of 1");
      }
    }

    // A negative delta removes stock now — it must not drive the stock target
    // (tracked entity, or untracked stock in the original's bin) below zero.
    if (delta < 0 && root.locationId) {
      type TrackingQuantityRow = {
        trackedEntityId: string | null;
        storageUnitId: string | null;
        quantity: number | null;
      };
      const trackingRows = (trackingQuantities.data ??
        []) as TrackingQuantityRow[];
      // null == undefined — loose equality is deliberate (matches
      // post-inventory-adjustment's storage-unit lookup).
      const stockTarget = root.trackedEntityId
        ? trackingRows.find((q) => q.trackedEntityId == root.trackedEntityId)
        : trackingRows.find(
            (q) =>
              q.trackedEntityId == null && q.storageUnitId == root.storageUnitId
          );
      if ((stockTarget?.quantity ?? 0) < Math.abs(delta)) {
        throw new ValidationError(
          "Insufficient quantity for negative adjustment"
        );
      }
    }

    let trackedEntityStatus: string | null = null;
    if (root.trackedEntityId) {
      const entity = await client
        .from("trackedEntity")
        .select("status, quantity")
        .eq("id", root.trackedEntityId)
        .eq("companyId", companyId)
        .maybeSingle();
      if (entity.error || !entity.data) {
        throw new Error("Failed to fetch tracked entity");
      }
      trackedEntityStatus = entity.data.status;
      if (trackedEntityStatus === "Consumed") {
        throw new ValidationError(
          "Cannot correct a movement of a consumed tracked entity"
        );
      }
      if (Number(entity.data.quantity) + delta < 0) {
        throw new ValidationError(
          "Correction would make the tracked entity quantity negative"
        );
      }
      if (isSerial && Number(entity.data.quantity) + delta > 1) {
        throw new ValidationError("Serial items can only have a quantity of 1");
      }
    }

    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(client, companyId)
      : null;
    if (accountingEnabled && (accountDefaults?.error || !accountDefaults?.data)) {
      throw new Error("Error getting account defaults");
    }

    const dimensionMap: Record<string, string> = {};
    if (accountingEnabled) {
      const companyRecord = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      if (companyRecord.error) throw new Error("Failed to fetch company");
      const dimensions = await client
        .from("dimension")
        .select("id, entityType")
        .eq("companyGroupId", companyRecord.data.companyGroupId)
        .eq("active", true)
        .in("entityType", ["Item", "ItemPostingGroup", "Location"]);
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    // Resolve the accounting period BEFORE opening the Kysely transaction —
    // the REST client mid-transaction parks the (size 1) pool. The period is
    // the one containing the ORIGINAL movement's postingDate; Locked/Closed
    // periods throw here with a user-facing message.
    const accountingPeriodId = accountingEnabled
      ? await getAccountingPeriodForDate(
          client,
          companyId,
          db,
          root.postingDate
        )
      : null;
    const accounting =
      accountingEnabled && accountDefaults?.data && accountingPeriodId
        ? {
            accountingPeriodId,
            accountDefaults: {
              rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
              finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
              inventoryAdjustmentVarianceAccount:
                accountDefaults.data.inventoryAdjustmentVarianceAccount,
            },
            description: `Stock Movement Correction — ${resolvedComment}`,
            userId,
            dimensions: dimensionMap,
          }
        : null;

    let resultLedgerId: string | null = null;

    await db.transaction().execute(async (trx) => {
      if (root.trackedEntityId) {
        const updated = await trx
          .updateTable("trackedEntity")
          .set((eb) => ({ quantity: eb("quantity", "+", delta) }))
          .where("id", "=", root.trackedEntityId!)
          .where("companyId", "=", companyId)
          .where("status", "!=", "Consumed")
          .where((eb) => eb("quantity", ">=", -delta))
          // Serial ceiling re-checked atomically: resulting quantity ≤ 1.
          .$if(isSerial, (qb) => qb.where((eb) => eb("quantity", "<=", 1 - delta)))
          .returning(["id"])
          .executeTakeFirst();
        if (!updated) {
          throw new ValidationError(
            "Tracked entity changed while correcting — try again"
          );
        }
      }

      const booked = await bookAdjustment(trx, {
        ledger: {
          postingDate: root.postingDate,
          itemId: root.itemId,
          quantity: delta,
          locationId: root.locationId,
          storageUnitId: root.storageUnitId,
          trackedEntityId: root.trackedEntityId,
          entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
          documentType: root.documentType,
          documentId: root.documentId,
          correctionOfItemLedgerId: root.id,
          comment: resolvedComment,
          companyId,
          createdBy: userId,
        },
        item,
        itemCost: itemCostResult.data,
        accounting,
      });
      resultLedgerId = booked.itemLedgerId;
    });

    return new Response(
      JSON.stringify({
        success: true,
        itemLedger: resultLedgerId ? { id: resultLedgerId } : null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    logger.error("correct-stock-movement failed", {
      error: String((err as Error).stack ?? err),
    });
    const isValidationError = err instanceof ValidationError;
    return new Response(JSON.stringify({ message: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: isValidationError ? 400 : 500,
    });
  }
});
