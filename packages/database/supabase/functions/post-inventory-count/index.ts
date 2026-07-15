import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { getFunctionLogger } from "../lib/logging.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { getCurrentAccountingPeriod } from "../shared/get-accounting-period.ts";
import { getDefaultPostingGroup } from "../shared/get-posting-group.ts";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "../shared/post-adjustment.ts";
import { planInventoryCountPost } from "./plan-post.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);
const logger = getFunctionLogger("post-inventory-count");

// Base for post-blocking validation errors. Carries the offending line ids so
// the response can hand them to the UI to highlight the rows.
class InvalidLinesError extends Error {
  lineIds: string[];
  constructor(message: string, lineIds: string[]) {
    super(message);
    this.name = "InvalidLinesError";
    this.lineIds = lineIds;
  }
}

// Thrown when a serial-tracked line is counted as anything other than 0 or 1
// (a serial entity is a single unique unit).
class SerialQuantityError extends InvalidLinesError {
  constructor(lineIds: string[]) {
    super(
      `${lineIds.length} serial line(s) must be counted as 0 or 1 — a serial number is a single unit.`,
      lineIds
    );
    this.name = "SerialQuantityError";
  }
}

// Inventory Count posting uses snapshot-delta reconciliation: for each counted
// line we post a single Positive/Negative adjustment for the variance the counter
// reviewed — `counted - systemQuantity` (the FROZEN snapshot on the line), NOT
// `counted - live on-hand`. This preserves any stock movements that posted between
// the snapshot and the post (a receipt/shipment isn't clobbered; the correction is
// applied on top of it). Each variance books through the shared posting core:
// item ledger + cost layers + (when companySettings.accountingEnabled) a GL
// journal against the inventory adjustment variance account.
// (Rectify re-snapshots `systemQuantity` to current live on-hand first, so for a
// correction the same formula resolves to "set to counted". A correction is a
// NEW movement valued at posting-time cost — the original journal is immutable.)
const payloadValidator = z.object({
  type: z.literal("post"),
  inventoryCountId: z.string(),
  userId: z.string(),
  companyId: z.string()
});

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();

  try {
    const { inventoryCountId, userId, companyId } =
      payloadValidator.parse(payload);

    const client = await requirePermissions(req, companyId, userId, {
      update: "inventory"
    });

    const today = format(new Date(), "yyyy-MM-dd");
    const nowIso = new Date().toISOString();

    const inventoryCount = await client
      .from("inventoryCount")
      .select("*")
      .eq("id", inventoryCountId)
      .eq("companyId", companyId)
      .single();

    if (inventoryCount.error) throw new Error("Inventory count not found");

    const lines = await client
      .from("inventoryCountLine")
      .select("*")
      .eq("inventoryCountId", inventoryCountId)
      .eq("companyId", companyId)
      .not("countedQuantity", "is", null);

    if (lines.error) throw new Error(lines.error.message);

    const comment = `Inventory Count ${inventoryCount.data.inventoryCountId}`;
    const countedLines = (lines.data ?? []).filter(
      (line) => line.countedQuantity !== null
    );

    // Serial validation: a serial-tracked item is a single unique unit, so each
    // serial line can only be counted 0 or 1. Block the post (before any write)
    // and return the offending line ids so the UI can highlight them.
    const itemIds = [...new Set(countedLines.map((line) => line.itemId))];
    const items = itemIds.length
      ? await client
          .from("item")
          .select("id, itemTrackingType, replenishmentSystem")
          .in("id", itemIds)
          .eq("companyId", companyId)
      : null;
    if (items?.error) throw new Error(items.error.message);

    const trackingTypeByItem = new Map<string, string | null>(
      (items?.data ?? []).map((item) => [item.id, item.itemTrackingType])
    );
    // Explicit row types: supabase-js generic inference fails under deno
    // check for these selects (same pre-existing limitation as the maps above).
    type CountItemRow = {
      id: string;
      replenishmentSystem:
        | Database["public"]["Enums"]["itemReplenishmentSystem"]
        | null;
    };
    type CountItemCostRow = {
      itemId: string;
      costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
      unitCost: number | null;
      standardCost: number | null;
      itemPostingGroupId: string | null;
    };
    const replenishmentByItem = new Map(
      ((items?.data ?? []) as CountItemRow[]).map((item) => [
        item.id,
        item.replenishmentSystem
      ])
    );

    const itemCosts = itemIds.length
      ? await client
          .from("itemCost")
          .select(
            "itemId, costingMethod, unitCost, standardCost, itemPostingGroupId"
          )
          .in("itemId", itemIds)
          .eq("companyId", companyId)
      : null;
    if (itemCosts?.error) throw new Error(itemCosts.error.message);
    const itemCostByItem = new Map(
      ((itemCosts?.data ?? []) as CountItemCostRow[]).map((cost) => [
        cost.itemId,
        cost
      ])
    );
    const serialInvalidLineIds = countedLines
      .filter((line) => {
        if (trackingTypeByItem.get(line.itemId) !== "Serial") return false;
        const counted = Number(line.countedQuantity);
        return counted !== 0 && counted !== 1;
      })
      .map((line) => line.id);
    if (serialInvalidLineIds.length > 0) {
      throw new SerialQuantityError(serialInvalidLineIds);
    }

    // Reconcile against the frozen snapshot — no live on-hand read needed.
    const { planned } = planInventoryCountPost(countedLines);

    // The accountingEnabled flag gates ALL journal writes; cost layers are
    // maintained either way. Resolve settings + period BEFORE the transaction
    // (REST hops mid-transaction park the size-1 pool in idle-in-transaction).
    const accountingSettings = await client
      .from("companySettings")
      .select("accountingEnabled")
      .eq("id", companyId)
      .single();
    // Fail closed: a failed settings read must not silently post without GL.
    if (accountingSettings.error) {
      throw new Error("Failed to fetch company settings");
    }
    const accountingEnabled =
      accountingSettings.data?.accountingEnabled ?? false;
    const accountDefaults = accountingEnabled
      ? await getDefaultPostingGroup(client, companyId)
      : null;
    if (
      accountingEnabled &&
      (accountDefaults?.error || !accountDefaults?.data)
    ) {
      throw new Error("Error getting account defaults");
    }
    const accountingPeriodId = accountingEnabled
      ? await getCurrentAccountingPeriod(client, companyId, db)
      : null;

    // Active dimensions for the company group (post-shipment precedent) —
    // journal lines get Item / ItemPostingGroup / Location tags.
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
      // Fail closed: journal lines must not silently lose dimension tags.
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    const accounting =
      accountingEnabled && accountDefaults?.data && accountingPeriodId
        ? {
            accountingPeriodId,
            accountDefaults: {
              rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
              finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
              inventoryAdjustmentVarianceAccount:
                accountDefaults.data.inventoryAdjustmentVarianceAccount
            },
            description: comment,
            userId,
            dimensions: dimensionMap
          }
        : null;

    await db.transaction().execute(async (trx) => {
      // Concurrency guard: lock the header and re-assert it is still Pending so
      // two concurrent posts can't both apply the delta (double-post). Mirrors
      // the FOR UPDATE guard in post-payment / post-memo; the end-of-transaction
      // guarded UPDATE below is the backstop.
      const locked = await trx
        .selectFrom("inventoryCount")
        .select(["id", "status"])
        .where("id", "=", inventoryCountId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) throw new Error("Inventory count not found");
      if (locked.status !== "Pending") {
        throw new Error("Inventory count is no longer pending");
      }

      // ONE journal per count post: created lazily on the first variance that
      // carries value, then shared by every line's journal-line pair.
      let sharedJournalId: string | null = null;
      const accountingForLines = accounting
        ? {
            ...accounting,
            getJournalId: async () => {
              if (!sharedJournalId) {
                sharedJournalId = await createAdjustmentJournal(trx, {
                  companyId,
                  accountingPeriodId: accounting.accountingPeriodId,
                  description: accounting.description,
                  postingDate: today,
                  userId
                });
              }
              return sharedJournalId;
            }
          }
        : null;

      // Post the reviewed variance for each line as an inventory adjustment,
      // booked through the shared core (ledger + cost layers + journal).
      for (const { line, delta } of planned) {
        if (delta === 0) continue;

        const itemCost = itemCostByItem.get(line.itemId);
        if (!itemCost) {
          throw new Error(`Missing item cost for item ${line.itemId}`);
        }

        const booked = await bookAdjustment(trx, {
          ledger: {
            postingDate: today,
            itemId: line.itemId,
            quantity: delta,
            locationId: line.locationId,
            storageUnitId: line.storageUnitId,
            trackedEntityId: line.trackedEntityId,
            entryType: delta > 0 ? "Positive Adjmt." : "Negative Adjmt.",
            documentType: "Inventory Count",
            documentId: inventoryCountId,
            // In-place rectify: if this line already posted a movement (the count
            // was rectified), link the new fix movement back to that prior one so
            // both stay visible and linked in the movements screens. Null on the
            // first post.
            correctionOfItemLedgerId: line.postedItemLedgerId ?? null,
            comment,
            companyId,
            createdBy: userId
          },
          item: {
            itemTrackingType: trackingTypeByItem.get(line.itemId) ?? null,
            replenishmentSystem: replenishmentByItem.get(line.itemId) ?? null,
            itemPostingGroupId: itemCost.itemPostingGroupId
          },
          itemCost,
          accounting: accountingForLines
        });

        // Tracked lines: apply the same delta to the entity's quantity (not a
        // set-to-counted) so movements since the snapshot aren't overwritten.
        if (line.trackedEntityId) {
          await trx
            .updateTable("trackedEntity")
            .set((eb) => ({ quantity: eb("quantity", "+", delta) }))
            .where("id", "=", line.trackedEntityId)
            .where("companyId", "=", companyId)
            .execute();
        }

        await trx
          .updateTable("inventoryCountLine")
          .set({ postedItemLedgerId: booked.itemLedgerId })
          .where("id", "=", line.id)
          .where("companyId", "=", companyId)
          .execute();
      }

      // Guard the transition inside the transaction: only a still-Pending count
      // can be posted. If a concurrent post already moved it to Posted, this
      // matches 0 rows and we throw to roll back this transaction's ledger
      // writes — preventing a double-post.
      const posted = await trx
        .updateTable("inventoryCount")
        .set({
          status: "Posted",
          postedBy: userId,
          postedAt: nowIso,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", inventoryCountId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Pending")
        .returning(["id"])
        .executeTakeFirst();

      if (!posted) {
        throw new Error("Inventory count is no longer pending");
      }
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    logger.error("post-inventory-count failed", {
      error: String((err as Error).stack ?? err)
    });
    // The post is a single atomic transaction, so a failure has already rolled
    // back any ledger writes and the status change — the count is left exactly
    // as it was (Pending). We do NOT touch the status here: reverting a failed
    // post to Draft would silently discard the user's confirmation. Pending is
    // the correct retryable state.
    // Body key is `message` so the route's `getEdgeFunctionErrorMessage` can pull
    // the real reason (e.g. the snapshot-drift or serial text) out of the response
    // body — supabase-js otherwise only exposes a generic FunctionsHttpError.message.
    // For line-level validation errors we also return `invalidLineIds` so the UI
    // can highlight the offending rows.
    // Only line-level validation failures are client errors (400). Everything
    // else — "not found", "no longer pending", DB/runtime failures — is a 500 so
    // real outages surface in monitoring instead of hiding as a 400.
    const isValidationError = err instanceof InvalidLinesError;
    const invalidLineIds = isValidationError ? err.lineIds : undefined;
    return new Response(
      JSON.stringify({
        message: (err as Error).message,
        ...(invalidLineIds ? { invalidLineIds } : {})
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: isValidationError ? 400 : 500
      }
    );
  }
});
