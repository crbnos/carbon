// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type {
  ItemEdit,
  ItemFieldSnapshot,
  OwnedFieldChange,
  StandardFieldWriter
} from "@carbon/ee";
import { mergeExistingItemEdits, standardField } from "@carbon/ee";
import { selectInBatches } from "@carbon/ee/onshape";
import { ONSHAPE_V2_INTEGRATION_ID } from "@carbon/ee/onshape/integration-id";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canEditChangeNoticeEngineering,
  cascadeItemTrackingType,
  updateItemMethodAndSourcing
} from "~/modules/items";

const logger = getLogger("erp", "onshape", "push");

type MethodMaterialInsert =
  Database["public"]["Tables"]["methodMaterial"]["Insert"];

export type OwnedMethodLine = {
  row: Omit<MethodMaterialInsert, "companyId" | "createdBy">;
  /** Ownership row metadata; `makeMethodId` names the line's method. */
  metadata: Record<string, unknown>;
};

/**
 * Replace an item's Onshape link in one transaction: delete any row for this
 * item or this externalId, then insert. Both unique indexes need the deletes first.
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
 * Insert BOM lines and their ownership rows in one transaction. A line without
 * its ownership row reads as manual, so the next push keeps it and adds a copy.
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
      // Mappings pair with lines by index (RETURNING follows VALUES order).
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
 * Take over a manual line in one transaction: set the Onshape-owned columns and
 * write its ownership row. Operation, scrap, tags and kit are kept.
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

export type OpenReleaseNotice = {
  id: string;
  changeNoticeId: string;
  affectedCount: number;
};

/**
 * The notice an earlier push of this release made, while it still takes items:
 * a release spanning two documents is pushed once per document into one notice.
 * Fails closed: a read that fails is an error, never "no open notice", which
 * would open a second notice for the release.
 */
export async function findOpenReleaseNotice(
  client: SupabaseClient<Database>,
  companyId: string,
  releaseId: string
): Promise<
  | { data: OpenReleaseNotice | null; error: null }
  | { data: null; error: string }
> {
  const failed = (what: string, error: unknown) => {
    logger.error("Could not read a release's earlier push", {
      companyId,
      releaseId,
      read: what,
      error
    });
    return {
      data: null,
      error: `Carbon couldn't read this release's earlier ${what}`
    };
  };

  // Matched on the release id the link's metadata carries, not a LIKE on the
  // key: a synthetic release id holds a part number, which may contain % or _.
  const links = await client
    .from("externalIntegrationMapping")
    .select("entityId")
    .eq("companyId", companyId)
    .eq("integration", ONSHAPE_V2_INTEGRATION_ID)
    .eq("entityType", "item")
    .like("externalId", "release:%")
    .eq("metadata->>releaseId", releaseId);
  if (links.error) return failed("links", links.error);
  if (!links.data?.length) return { data: null, error: null };

  const items = await selectInBatches(
    links.data.map((link) => link.entityId),
    (batch) =>
      client
        .from("item")
        .select("changeOrderId")
        .eq("companyId", companyId)
        .in("id", batch)
        .not("changeOrderId", "is", null)
  );
  if (items.error) return failed("items", items.error);
  const noticeIds = [
    ...new Set(
      items.data
        .map((item) => item.changeOrderId)
        .filter((id): id is string => !!id)
    )
  ];
  if (noticeIds.length === 0) return { data: null, error: null };

  const notices = await selectInBatches(noticeIds, (batch) =>
    client
      .from("changeOrder")
      .select(
        "id, changeOrderId, status, createdAt, changeOrderAffectedItem(id)"
      )
      .eq("companyId", companyId)
      .in("id", batch)
  );
  if (notices.error) return failed("change notices", notices.error);
  // Batches arrive in batch order: the oldest open notice wins.
  const editable = notices.data
    .filter((notice) => canEditChangeNoticeEngineering(notice.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // A pending approval freezes the notice's engineering content; one can be
  // pending only at Engineering Complete. approvalRequest is service-role only.
  const awaitingIds = editable
    .filter((notice) => notice.status === "Engineering Complete")
    .map((notice) => notice.id);
  const awaiting = new Set<string>();
  if (awaitingIds.length > 0) {
    const pending = await selectInBatches(awaitingIds, (batch) =>
      getCarbonServiceRole()
        .from("approvalRequest")
        .select("documentId")
        .eq("companyId", companyId)
        .eq("documentType", "changeOrder")
        .eq("status", "Pending")
        .in("documentId", batch)
    );
    if (pending.error) return failed("change notice approvals", pending.error);
    for (const row of pending.data) awaiting.add(row.documentId);
  }
  const open = editable.find((notice) => !awaiting.has(notice.id));
  return {
    data: open
      ? {
          id: open.id,
          changeNoticeId: open.changeOrderId,
          affectedCount: open.changeOrderAffectedItem?.length ?? 0
        }
      : null,
    error: null
  };
}

/**
 * Stage a created item under a change notice as `createChangeNoticeDraftMethod`
 * does: item inactive, item and Draft method stamped, one affected-item row.
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

/** Item field values a push writes; an absent key is not written. */
export type ItemFieldWrite = {
  replenishmentSystem?: ItemEnums["itemReplenishmentSystem"];
  defaultMethodType?: ItemEnums["methodType"];
  sourcingType?: ItemEnums["sourcingType"];
  itemTrackingType?: ItemEnums["itemTrackingType"];
  unitOfMeasureCode?: string;
  mpn?: string | null;
};

type WriterContext = {
  client: SupabaseClient<Database>;
  db: Kysely<KyselyDatabase>;
  itemId: string;
  companyId: string;
  userId: string;
};

export async function updateItemColumns(
  client: SupabaseClient<Database>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    values: Pick<ItemFieldWrite, "mpn" | "unitOfMeasureCode">;
  }
) {
  return client
    .from("item")
    .update({
      ...(args.values.mpn !== undefined ? { mpn: args.values.mpn } : {}),
      ...(args.values.unitOfMeasureCode !== undefined
        ? { unitOfMeasureCode: args.values.unitOfMeasureCode }
        : {}),
      updatedBy: args.userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", args.itemId)
    .eq("companyId", args.companyId);
}

/**
 * One writer per `StandardFieldWriter` key. Each writes as the item page does,
 * so the cascades onto Draft method lines and open documents follow.
 */
const STANDARD_FIELD_WRITERS: Record<
  StandardFieldWriter,
  (ctx: WriterContext, write: ItemFieldWrite) => Promise<string | null>
> = {
  itemMethod: async (ctx, write) => {
    const { replenishmentSystem, defaultMethodType, sourcingType } = write;
    await updateItemMethodAndSourcing(ctx.db, {
      itemIds: [ctx.itemId],
      companyId: ctx.companyId,
      userId: ctx.userId,
      itemUpdate: { replenishmentSystem, defaultMethodType, sourcingType },
      cascade: {
        ...(defaultMethodType !== undefined
          ? { methodType: defaultMethodType }
          : {}),
        ...(sourcingType !== undefined ? { sourcingType } : {})
      }
    });
    return null;
  },
  itemTracking: async (ctx, write) => {
    if (write.itemTrackingType === undefined) return null;
    const updated = await ctx.client
      .from("item")
      .update({
        itemTrackingType: write.itemTrackingType,
        updatedBy: ctx.userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", ctx.itemId)
      .eq("companyId", ctx.companyId);
    if (updated.error) return updated.error.message;
    await cascadeItemTrackingType(ctx.db, {
      itemIds: [ctx.itemId],
      companyId: ctx.companyId,
      newType: write.itemTrackingType,
      userId: ctx.userId
    });
    return null;
  },
  itemColumn: async (ctx, write) => {
    const updated = await updateItemColumns(ctx.client, {
      itemId: ctx.itemId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      values: write
    });
    return updated.error ? updated.error.message : null;
  }
};

const WRITER_ORDER: StandardFieldWriter[] = [
  "itemMethod",
  "itemTracking",
  "itemColumn"
];

/** Values must be final: this applies no interlock. Returns an error message, or null. */
export async function applyItemFieldWrites(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    changed: ItemFieldWrite;
  }
): Promise<string | null> {
  const { itemId, companyId, userId } = args;
  const ctx: WriterContext = { client, db, itemId, companyId, userId };
  try {
    for (const writer of WRITER_ORDER) {
      const write: ItemFieldWrite = {};
      for (const [field, value] of Object.entries(args.changed)) {
        if (value === undefined) continue;
        if (standardField(field)?.writer !== writer) continue;
        (write as Record<string, unknown>)[field] = value;
      }
      if (Object.keys(write).length === 0) continue;
      const error = await STANDARD_FIELD_WRITERS[writer](ctx, write);
      if (error) return error;
    }
    return null;
  } catch (error) {
    logger.error("Failed to write item fields from Onshape", {
      companyId,
      itemId,
      error
    });
    return error instanceof Error ? error.message : "Failed to update the item";
  }
}

/**
 * Write to an item the push did not create: the "everyPush" descriptions, then
 * the plan's target with the reviewer's edits on top. Returns the fields after
 * the write, which a BOM line written later copies its method and unit from.
 */
export async function applyExistingItemFields(
  client: SupabaseClient<Database>,
  db: Kysely<KyselyDatabase>,
  args: {
    itemId: string;
    companyId: string;
    userId: string;
    current: ItemFieldSnapshot | null | undefined;
    target?: ItemFieldSnapshot;
    edit?: ItemEdit;
    descriptions?: OwnedFieldChange[];
  }
): Promise<{ values: ItemFieldSnapshot | null; error: string | null }> {
  const { itemId, companyId, userId } = args;
  const merged = args.current
    ? mergeExistingItemEdits(args.current, args.edit, args.target)
    : null;
  if (merged && !merged.ok) {
    return { values: null, error: merged.errors.join("; ") };
  }

  const text: { name?: string; description?: string } = {};
  for (const change of args.descriptions ?? []) {
    if (change.to !== null) text[change.field] = change.to;
  }
  if (Object.keys(text).length > 0) {
    const updated = await client
      .from("item")
      .update({ ...text, updatedBy: userId, updatedAt: datetime.timestamp() })
      .eq("id", itemId)
      .eq("companyId", companyId);
    if (updated.error) {
      return { values: null, error: updated.error.message };
    }
  }

  if (merged?.ok && Object.keys(merged.changed).length > 0) {
    const error = await applyItemFieldWrites(client, db, {
      itemId,
      companyId,
      userId,
      changed: merged.changed
    });
    if (error) return { values: null, error };
  }
  return { values: merged?.ok ? merged.values : null, error: null };
}
