// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cascadeItemTrackingType,
  updateItemMethodAndSourcing
} from "~/modules/items";

/**
 * The panel pushes' multi-row writes that must land together, as Kysely
 * transactions: the Supabase client has none, and a half-written pair here
 * leaves Carbon in a state the next push reads wrongly — an item with no link,
 * or lines with no ownership rows (which the next push duplicates).
 */

const logger = getLogger("erp", "onshape", "push");

type MethodMaterialInsert =
  Database["public"]["Tables"]["methodMaterial"]["Insert"];

export type OwnedMethodLine = {
  row: Omit<MethodMaterialInsert, "companyId" | "createdBy">;
  /** The line's ownership row metadata; `makeMethodId` names its method. */
  metadata: Record<string, unknown>;
};

/**
 * Replace an item's Onshape link: clear any row for this item and any row for
 * this external id, then insert the one canonical row. Both uniqueness
 * constraints depend on the deletes landing first, and all three either land
 * or none do. Returns the new mapping id.
 */
export async function swapItemMapping(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    itemId: string;
    externalId: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  const { companyId, userId, itemId, externalId } = args;
  const now = datetime.timestamp();
  try {
    const inserted = await db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom("externalIntegrationMapping")
        .where("companyId", "=", companyId)
        .where("integration", "=", ONSHAPE_V2_INTEGRATION_ID)
        .where("entityType", "=", "item")
        .where((eb) =>
          eb.or([
            eb("entityId", "=", itemId),
            eb("externalId", "=", externalId)
          ])
        )
        .execute();
      return trx
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "item",
          entityId: itemId,
          integration: ONSHAPE_V2_INTEGRATION_ID,
          externalId,
          metadata: args.metadata as Json,
          lastSyncedAt: now,
          companyId,
          createdBy: userId,
          updatedBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    });
    return { id: inserted.id, error: null };
  } catch (error) {
    logger.error("Failed to link an item to Onshape", {
      companyId,
      itemId,
      error
    });
    return {
      id: null,
      error: error instanceof Error ? error.message : "link failed"
    };
  }
}

/**
 * Insert BOM lines and the ownership row for each, together. A line without
 * its ownership row reads as one a person added, so the next push keeps it and
 * inserts a second copy beside it; a short insert therefore rolls back rather
 * than pair mapping rows with the wrong lines. Returns the new mapping ids, in
 * the order the lines were given.
 */
export async function insertOwnedMethodLines(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    lines: OwnedMethodLine[];
  }
): Promise<
  { mappingIds: string[]; error: null } | { mappingIds: null; error: string }
> {
  const { companyId, userId, lines } = args;
  if (lines.length === 0) return { mappingIds: [], error: null };
  const now = datetime.timestamp();
  try {
    const mappingIds = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto("methodMaterial")
        .values(
          lines.map((line) => ({
            ...line.row,
            companyId,
            createdBy: userId,
            updatedBy: userId
          }))
        )
        .returning("id")
        .execute();
      // Ids come back in insertion order, which is what pairs each line with
      // its mapping; that only holds while the counts match.
      if (inserted.length !== lines.length) {
        throw new Error(
          `wrote ${inserted.length} of ${lines.length} lines; nothing was kept`
        );
      }
      const mappings = await trx
        .insertInto("externalIntegrationMapping")
        .values(
          lines.map((line, index) => ({
            entityType: "methodMaterial",
            entityId: inserted[index]!.id,
            integration: ONSHAPE_V2_INTEGRATION_ID,
            metadata: line.metadata as Json,
            lastSyncedAt: now,
            companyId,
            createdBy: userId,
            updatedBy: userId
          }))
        )
        .returning("id")
        .execute();
      return mappings.map((mapping) => mapping.id);
    });
    return { mappingIds, error: null };
  } catch (error) {
    logger.error("Failed to write Onshape BOM lines", {
      companyId,
      count: lines.length,
      error
    });
    return {
      mappingIds: null,
      error: error instanceof Error ? error.message : "line insert failed"
    };
  }
}

/**
 * Take over a line someone added by hand: set the columns Onshape owns and
 * write its ownership row, together. Only `quantity`, `order`, the child
 * method pointer and the item change; the line's operation, scrap, tags and
 * kit stay Carbon's. Returns the new mapping id.
 */
export async function claimManualMethodLine(
  db: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    userId: string;
    lineId: string;
    update: {
      itemId: string;
      quantity: number;
      order: number;
      materialMakeMethodId: string | null;
    };
    metadata: Record<string, unknown>;
  }
): Promise<
  { mappingId: string; error: null } | { mappingId: null; error: string }
> {
  const { companyId, userId, lineId } = args;
  const now = datetime.timestamp();
  try {
    const mappingId = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable("methodMaterial")
        .set({ ...args.update, updatedBy: userId, updatedAt: now })
        .where("id", "=", lineId)
        .where("companyId", "=", companyId)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw new Error("the line no longer exists");
      const mapping = await trx
        .insertInto("externalIntegrationMapping")
        .values({
          entityType: "methodMaterial",
          entityId: lineId,
          integration: ONSHAPE_V2_INTEGRATION_ID,
          metadata: args.metadata as Json,
          lastSyncedAt: now,
          companyId,
          createdBy: userId,
          updatedBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return mapping.id;
    });
    return { mappingId, error: null };
  } catch (error) {
    logger.error("Failed to take over a BOM line for Onshape", {
      companyId,
      lineId,
      error
    });
    return {
      mappingId: null,
      error: error instanceof Error ? error.message : "line takeover failed"
    };
  }
}

/**
 * Put an item a push created under a change notice, the way
 * `createChangeNoticeDraftMethod` stages a Revision or a New Part: the item is
 * inactive, it and its Draft make method carry the notice's id, and an
 * affected-item row points at both. Releasing the notice then activates the
 * Draft, reveals the item and, for a Revision, writes the old-to-new
 * supersession. The stamps and the row land together or not at all.
 */
export async function stageChangeNoticeItem(
  db: Kysely<KyselyDatabase>,
  args: {
    /** `changeOrder.id`, not its readable id. */
    changeOrderId: string;
    companyId: string;
    userId: string;
    itemId: string;
    /** The revision this one replaces; null for a New Part. */
    baseItemId: string | null;
    sortOrder: number;
  }
): Promise<{ error: string | null }> {
  const { changeOrderId, companyId, userId, itemId, baseItemId } = args;
  const now = datetime.timestamp();
  try {
    await db.transaction().execute(async (trx) => {
      const draft = await trx
        .selectFrom("makeMethod")
        .select("id")
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .where("status", "=", "Draft")
        .orderBy("version", "desc")
        .executeTakeFirst();
      // Release refuses an affected item with no Draft to activate.
      if (!draft) throw new Error("the item has no Draft make method");
      const base = baseItemId
        ? await trx
            .selectFrom("activeMakeMethods")
            .select("id")
            .where("itemId", "=", baseItemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;

      await trx
        .updateTable("item")
        .set({
          active: false,
          changeOrderId,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", itemId)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .updateTable("makeMethod")
        .set({ changeOrderId, updatedBy: userId, updatedAt: now })
        .where("id", "=", draft.id)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .insertInto("changeOrderAffectedItem")
        .values({
          changeOrderId,
          itemId: baseItemId ?? itemId,
          changeType: baseItemId ? "Revision" : "New Part",
          sortOrder: args.sortOrder,
          draftMakeMethodId: draft.id,
          baseMakeMethodId: base?.id ?? null,
          newItemId: itemId,
          companyId,
          createdBy: userId
        })
        .execute();
    });
    return { error: null };
  } catch (error) {
    logger.error("Failed to stage an item under a change notice", {
      companyId,
      changeOrderId,
      itemId,
      error
    });
    return {
      error: error instanceof Error ? error.message : "staging failed"
    };
  }
}

type ItemEnums = Database["public"]["Enums"];

/**
 * Write a reviewer's manufacturing-field edits to an existing item the way the
 * items update route does, so what depends on those fields follows:
 * replenishment and method type through `updateItemMethodAndSourcing`, which
 * mirrors the method type onto Draft method materials, and tracking type
 * through `cascadeItemTrackingType`. Returns an error message, or null.
 */
export async function applyItemManufacturingEdits(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    changed: {
      replenishmentSystem?: ItemEnums["itemReplenishmentSystem"];
      defaultMethodType?: ItemEnums["methodType"];
      itemTrackingType?: ItemEnums["itemTrackingType"];
    };
  }
): Promise<string | null> {
  const { itemId, companyId, userId } = args;
  const { replenishmentSystem, defaultMethodType, itemTrackingType } =
    args.changed;
  try {
    if (replenishmentSystem !== undefined || defaultMethodType !== undefined) {
      await updateItemMethodAndSourcing(db, {
        itemIds: [itemId],
        companyId,
        userId,
        itemUpdate: { replenishmentSystem, defaultMethodType },
        cascade:
          defaultMethodType !== undefined
            ? { methodType: defaultMethodType }
            : {}
      });
    }
    if (itemTrackingType !== undefined) {
      const updated = await client
        .from("item")
        .update({
          itemTrackingType,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (updated.error) return updated.error.message;
      await cascadeItemTrackingType(db, {
        itemIds: [itemId],
        companyId,
        newType: itemTrackingType,
        userId
      });
    }
    return null;
  } catch (error) {
    logger.error("Failed to write manufacturing edits from Onshape", {
      companyId,
      itemId,
      error
    });
    return error instanceof Error ? error.message : "Failed to update the item";
  }
}
