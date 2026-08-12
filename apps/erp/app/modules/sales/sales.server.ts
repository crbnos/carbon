import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";

type BreakRow = { quantity: number; overridePrice: number; active: boolean };

export async function duplicatePriceOverrides(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string,
  source: { customerId?: string; customerTypeId?: string },
  target: { customerId?: string; customerTypeId?: string },
  options?: {
    overrideIds?: string[];
    conflictStrategy?: "skip" | "overwrite";
  }
): Promise<{
  duplicated: number;
  skipped: number;
  overwritten: number;
  error: unknown;
}> {
  let query = client
    .from("customerItemPriceOverride")
    .select(
      "id, itemId, notes, validFrom, validTo, active, applyRulesOnTop, breaks:customerItemPriceOverrideBreak(quantity, overridePrice, active)"
    )
    .eq("companyId", companyId);

  if (source.customerId) {
    query = query.eq("customerId", source.customerId);
  } else if (source.customerTypeId) {
    query = query.eq("customerTypeId", source.customerTypeId);
  } else {
    query = query.is("customerId", null).is("customerTypeId", null);
  }

  if (options?.overrideIds?.length) {
    query = query.in("id", options.overrideIds);
  }

  const { data: sourceOverrides, error: fetchError } = await query;
  if (fetchError || !sourceOverrides) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: fetchError };
  }

  if (sourceOverrides.length === 0) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: null };
  }

  const strategy = options?.conflictStrategy ?? "skip";

  let existingLookup = client
    .from("customerItemPriceOverride")
    .select("id, itemId")
    .eq("companyId", companyId)
    .in(
      "itemId",
      sourceOverrides.map((s) => s.itemId)
    );

  existingLookup = target.customerId
    ? existingLookup.eq("customerId", target.customerId)
    : target.customerTypeId
      ? existingLookup.eq("customerTypeId", target.customerTypeId)
      : existingLookup.is("customerId", null).is("customerTypeId", null);

  const { data: existingOverrides } = await existingLookup;
  const existingByItemId = new Map(
    (existingOverrides ?? []).map((e) => [e.itemId, e.id])
  );

  const db = getDatabaseClient();

  try {
    const result = await db.transaction().execute(async (trx) => {
      let duplicated = 0;
      let skipped = 0;
      let overwritten = 0;

      for (const src of sourceOverrides) {
        const breaks = ((src.breaks as BreakRow[] | null) ?? []).map((b) => ({
          quantity: b.quantity,
          overridePrice: b.overridePrice,
          active: b.active
        }));

        if (breaks.length === 0) {
          skipped++;
          continue;
        }

        const existingId = existingByItemId.get(src.itemId);

        if (existingId && strategy === "skip") {
          skipped++;
          continue;
        }

        let parentId: string;

        if (existingId) {
          await trx
            .updateTable("customerItemPriceOverride")
            .set({
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              itemId: src.itemId,
              updatedBy: userId,
              updatedAt: new Date().toISOString()
            })
            .where("id", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          await trx
            .deleteFrom("customerItemPriceOverrideBreak")
            .where("customerItemPriceOverrideId", "=", existingId)
            .where("companyId", "=", companyId)
            .execute();

          parentId = existingId;
          overwritten++;
        } else {
          const [row] = await trx
            .insertInto("customerItemPriceOverride")
            .values({
              companyId,
              createdBy: userId,
              itemId: src.itemId,
              customerId: target.customerId ?? null,
              customerTypeId: target.customerTypeId ?? null,
              active: src.active,
              applyRulesOnTop: src.applyRulesOnTop ?? true,
              notes: src.notes ?? null,
              validFrom: src.validFrom ?? null,
              validTo: src.validTo ?? null
            })
            .returning("id")
            .execute();

          parentId = row.id;
          duplicated++;
        }

        await trx
          .insertInto("customerItemPriceOverrideBreak")
          .values(
            breaks.map((b) => ({
              customerItemPriceOverrideId: parentId,
              companyId,
              createdBy: userId,
              quantity: b.quantity,
              overridePrice: b.overridePrice,
              active: b.active
            }))
          )
          .execute();
      }

      return { duplicated, skipped, overwritten };
    });

    return { ...result, error: null };
  } catch (e) {
    return { duplicated: 0, skipped: 0, overwritten: 0, error: e };
  }
}

/**
 * Save a quote line and reconcile its quantity-break prices atomically.
 *
 * These three writes have to land together. Previously the line update
 * committed first, then the prune, then the seed — so a resolver failure left
 * the line saved with its new breaks unpriced, and a failure after the prune
 * left it short rows it used to have. The user saw a flashed error but the data
 * was already half-applied.
 *
 * Price ROWS are computed by the caller beforehand (the resolvers only read),
 * so a pricing failure aborts before anything is written at all. Those reads
 * are outside the transaction, which is fine: none of them touch the rows being
 * written here.
 */
export async function saveQuoteLineWithPrices(args: {
  lineId: string;
  line: Record<string, unknown>;
  removedQuantities: number[];
  priceRows: Record<string, unknown>[];
}): Promise<void> {
  const { lineId, line, removedQuantities, priceRows } = args;
  const db = getDatabaseClient();

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("quoteLine")
      .set(line as never)
      .where("id", "=", lineId)
      .execute();

    if (removedQuantities.length > 0) {
      await trx
        .deleteFrom("quoteLinePrice")
        .where("quoteLineId", "=", lineId)
        .where("quantity", "in", removedQuantities)
        .execute();
    }

    if (priceRows.length > 0) {
      await trx
        .insertInto("quoteLinePrice")
        .values(priceRows as never)
        .execute();
    }
  });
}
