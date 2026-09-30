import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";

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
