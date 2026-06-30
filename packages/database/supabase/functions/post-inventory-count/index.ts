import { serve } from "https://deno.land/std@0.175.0/http/server.ts";
import { format } from "https://deno.land/std@0.205.0/datetime/mod.ts";
import { z } from "https://deno.land/x/zod@v3.21.4/mod.ts";
import { DB, getConnectionPool, getDatabaseClient } from "../lib/database.ts";
import { corsHeaders } from "../lib/headers.ts";
import { requirePermissions } from "../lib/supabase.ts";
import type { Database } from "../lib/types.ts";

const pool = getConnectionPool(1);
const db = getDatabaseClient<DB>(pool);

type ItemLedgerInsert = Database["public"]["Tables"]["itemLedger"]["Insert"];

// Inventory Count posting reconciles on-hand to the counted value
// (Set-Quantity-to-counted semantics): for each counted line we post a single
// Positive/Negative inventory adjustment for the delta between the counted
// quantity and the *live* on-hand at post time. Because the counted quantity is
// always >= 0, on-hand can never go negative. Like the manual inventory
// adjustment path (`insertManualInventoryAdjustment`), this writes to the item
// ledger only (on-hand is derived from `itemLedger`); it does not post GL
// journal lines. Void reverses every produced ledger entry atomically.
const payloadValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("post"),
    inventoryCountId: z.string(),
    userId: z.string(),
    companyId: z.string()
  }),
  z.object({
    type: z.literal("void"),
    inventoryCountId: z.string(),
    userId: z.string(),
    companyId: z.string()
  })
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const payload = await req.json();

  try {
    const { type, inventoryCountId, userId, companyId } =
      payloadValidator.parse(payload);

    // Match the route gates for defense-in-depth: voiding (roll back) requires
    // delete; posting requires update.
    const client = await requirePermissions(
      req,
      companyId,
      userId,
      type === "void" ? { delete: "inventory" } : { update: "inventory" }
    );

    const today = format(new Date(), "yyyy-MM-dd");
    const nowIso = new Date().toISOString();

    const inventoryCount = await client
      .from("inventoryCount")
      .select("*")
      .eq("id", inventoryCountId)
      .eq("companyId", companyId)
      .single();

    if (inventoryCount.error) throw new Error("Inventory count not found");

    if (type === "void") {
      if (inventoryCount.data.status !== "Posted") {
        throw new Error("Can only roll back a posted inventory count");
      }

      const lines = await client
        .from("inventoryCountLine")
        .select("*")
        .eq("inventoryCountId", inventoryCountId)
        .eq("companyId", companyId)
        .not("postedItemLedgerId", "is", null);

      if (lines.error) throw new Error(lines.error.message);

      await db.transaction().execute(async (trx) => {
        for (const line of lines.data ?? []) {
          if (!line.postedItemLedgerId) continue;

          const original = await trx
            .selectFrom("itemLedger")
            .selectAll()
            .where("id", "=", line.postedItemLedgerId)
            .where("companyId", "=", companyId)
            .executeTakeFirst();

          if (!original) continue;

          // Reverse the ledger movement (swap the adjustment sign).
          await trx
            .insertInto("itemLedger")
            .values({
              postingDate: today,
              itemId: original.itemId,
              quantity: -original.quantity,
              locationId: original.locationId,
              storageUnitId: original.storageUnitId,
              trackedEntityId: original.trackedEntityId,
              entryType:
                original.entryType === "Positive Adjmt."
                  ? "Negative Adjmt."
                  : "Positive Adjmt.",
              documentType: "Inventory Count",
              documentId: inventoryCountId,
              comment: "VOID: Inventory Count",
              companyId,
              createdBy: userId
            })
            .execute();

          // Restore the tracked entity to its pre-count quantity. The post set
          // it to the counted value, so the original entry's quantity is the
          // delta we added; subtracting it returns the prior on-hand.
          if (line.trackedEntityId && line.countedQuantity !== null) {
            await trx
              .updateTable("trackedEntity")
              .set({ quantity: line.countedQuantity - original.quantity })
              .where("id", "=", line.trackedEntityId)
              .where("companyId", "=", companyId)
              .execute();
          }

          await trx
            .updateTable("inventoryCountLine")
            .set({ postedItemLedgerId: null })
            .where("id", "=", line.id)
            .where("companyId", "=", companyId)
            .execute();
        }

        // Guard the transition: only a still-Posted count can be voided. A
        // concurrent void matches 0 rows here and we roll back the reversal.
        const voided = await trx
          .updateTable("inventoryCount")
          .set({ status: "Voided", updatedBy: userId, updatedAt: nowIso })
          .where("id", "=", inventoryCountId)
          .where("companyId", "=", companyId)
          .where("status", "=", "Posted")
          .returning(["id"])
          .executeTakeFirst();

        if (!voided) {
          throw new Error("Inventory count is no longer posted");
        }
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // type === "post"
    const lines = await client
      .from("inventoryCountLine")
      .select("*")
      .eq("inventoryCountId", inventoryCountId)
      .eq("companyId", companyId)
      .not("countedQuantity", "is", null);

    if (lines.error) throw new Error(lines.error.message);

    const comment = `Inventory Count ${inventoryCount.data.inventoryCountId}`;

    await db.transaction().execute(async (trx) => {
      for (const line of lines.data ?? []) {
        if (line.countedQuantity === null) continue;

        // Live on-hand for this exact bucket (item / location / storage unit /
        // tracked entity). Mirror the snapshot's status-aware definition (and
        // `get_inventory_quantities`): exclude Rejected stock so the delta is
        // measured against the same on-hand the count was built from.
        let onHandQuery = trx
          .selectFrom("itemLedger")
          .select((eb) => eb.fn.sum<number>("quantity").as("quantity"))
          .where("companyId", "=", companyId)
          .where("itemId", "=", line.itemId)
          .where((eb) =>
            eb.or([
              eb("trackedEntityStatus", "is", null),
              eb("trackedEntityStatus", "!=", "Rejected")
            ])
          );

        onHandQuery = line.locationId
          ? onHandQuery.where("locationId", "=", line.locationId)
          : onHandQuery.where("locationId", "is", null);
        onHandQuery = line.storageUnitId
          ? onHandQuery.where("storageUnitId", "=", line.storageUnitId)
          : onHandQuery.where("storageUnitId", "is", null);
        onHandQuery = line.trackedEntityId
          ? onHandQuery.where("trackedEntityId", "=", line.trackedEntityId)
          : onHandQuery.where("trackedEntityId", "is", null);

        const onHandRow = await onHandQuery.executeTakeFirst();
        const currentOnHand = Number(onHandRow?.quantity ?? 0);

        const delta = line.countedQuantity - currentOnHand;
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
          comment,
          companyId,
          createdBy: userId
        };

        const inserted = await trx
          .insertInto("itemLedger")
          .values(ledgerEntry)
          .returning(["id"])
          .executeTakeFirstOrThrow();

        // Tracked lines: set that entity's quantity to the counted value.
        if (line.trackedEntityId) {
          await trx
            .updateTable("trackedEntity")
            .set({ quantity: line.countedQuantity })
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
    // The post/void work is a single atomic transaction, so a failure has
    // already rolled back any ledger writes and the status change — the document
    // is left exactly as it was (Pending for a post, Posted for a void). We do
    // NOT touch the status here: reverting a failed post to Draft would silently
    // discard the user's confirmation. Pending is the correct retryable state.
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});
