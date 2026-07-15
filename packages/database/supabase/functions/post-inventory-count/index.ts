import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";
import { planInventoryCountPost } from "./plan-post.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

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
// applied on top of it). Like `insertManualInventoryAdjustment`, this writes to the
// item ledger only (on-hand is derived from `itemLedger`); no GL journal lines.
// (Rectify re-snapshots `systemQuantity` to current live on-hand first, so for a
// correction the same formula resolves to "set to counted".)
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
          .select("id, itemTrackingType")
          .in("id", itemIds)
          .eq("companyId", companyId)
      : null;
    if (items?.error) throw new Error(items.error.message);

    const trackingTypeByItem = new Map<string, string | null>(
      (items?.data ?? []).map((item) => [item.id, item.itemTrackingType])
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

      // Post the reviewed variance for each line as an inventory adjustment.
      for (const { line, delta } of planned) {
        if (delta === 0) continue;

        const ledgerEntry: ItemLedgerInsert = {
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
        };

        const inserted = await trx
          .insertInto("itemLedger")
          .values(ledgerEntry)
          .returning(["id"])
          .executeTakeFirstOrThrow();

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
          .set({ postedItemLedgerId: inserted.id })
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
    console.error("Error in post-inventory-count:", err);
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
