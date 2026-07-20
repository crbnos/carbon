import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDatabaseClient } from "~/services/database.server";
import { isIssueLocked } from "./quality.models";
import { errResult, type Result } from "./quality.server";

type TrackedEntityRow = Database["public"]["Tables"]["trackedEntity"]["Row"];

// -------------------------------------------------------------
// assignEntitiesToIssueItem
// -------------------------------------------------------------
// Writes:
//   - nonConformanceItemTrackedEntity (delete moved links, re-insert against target)
//   - nonConformanceItem (decrement source qty, increment target qty)

export async function assignEntitiesToIssueItem(args: {
  nonConformanceItemId: string;
  targetItemId: string;
  assignments: { trackedEntityId: string; quantity: number }[];
  companyId: string;
  userId: string;
}): Promise<Result<{ moved: number }>> {
  const { nonConformanceItemId, targetItemId, assignments, companyId, userId } =
    args;

  if (assignments.length === 0) {
    return errResult("No assignments provided");
  }

  // Same source and target would decrement then re-inflate the same row off a
  // stale read, corrupting its quantity.
  if (nonConformanceItemId === targetItemId) {
    return errResult("Cannot move entities onto the same row");
  }

  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();
  const entityIds = assignments.map((a) => a.trackedEntityId);

  try {
    const result = await db.transaction().execute(async (trx) => {
      const source = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!source) throw new Error("Source item association not found");

      const target = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "quantity"])
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!target) throw new Error("Target item association not found");

      if (source.nonConformanceId !== target.nonConformanceId) {
        throw new Error("Cannot move entities between different NCRs");
      }

      // Re-check the lock inside the transaction: the route check is a separate
      // read and could race with a concurrent close.
      const parent = await trx
        .selectFrom("nonConformance")
        .select(["status"])
        .where("id", "=", source.nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (isIssueLocked(parent?.status)) {
        throw new Error("Cannot modify a closed issue. Reopen it first.");
      }

      const existingLinks = await trx
        .selectFrom("nonConformanceItemTrackedEntity")
        .select(["quantity"])
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      const existingQty = existingLinks.reduce(
        (acc, l) => acc + Number(l.quantity ?? 0),
        0
      );
      const movingQty = assignments.reduce(
        (acc, a) => acc + Number(a.quantity),
        0
      );

      await trx
        .deleteFrom("nonConformanceItemTrackedEntity")
        .where("nonConformanceItemId", "=", nonConformanceItemId)
        .where("trackedEntityId", "in", entityIds)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .insertInto("nonConformanceItemTrackedEntity")
        .values(
          assignments.map((a) => ({
            nonConformanceItemId: targetItemId,
            nonConformanceId: target.nonConformanceId,
            trackedEntityId: a.trackedEntityId,
            quantity: Number(a.quantity),
            companyId,
            createdBy: userId
          }))
        )
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: Math.max(0, Number(source.quantity ?? 0) - existingQty),
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceItemId)
        .where("companyId", "=", companyId)
        .execute();

      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: Number(target.quantity ?? 0) + movingQty,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", targetItemId)
        .where("companyId", "=", companyId)
        .execute();

      return { moved: assignments.length };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to move entities"
    );
  }
}

// -------------------------------------------------------------
// splitIssueItem
// -------------------------------------------------------------
// Splits a disposition row into a new row so portions can get different
// dispositions. Whole linked lots are re-pointed to the new row; a quantity
// split that lands mid-lot subdivides the batch entity via subdivideBatchEntity.

// Physically subdivides a batch tracked entity, mirroring the MES issue split:
// creates a new lot for `moveQty` linked to `newRowId`, decrements the original
// lot to `keepQty` (kept on its existing row), and writes split genealogy
// (trackedActivity "Split" + inputs/outputs + net-zero "Batch Split" itemLedger,
// which leaves on-hand unchanged).
//
// NOTE: the same lot-subdivision + genealogy also lives in the MES issue edge
// function (packages/database/supabase/functions/issue/index.ts, case
// "trackedEntitiesToOperation"). They can't share code across the app/Deno
// boundary today — keep the two in sync if the genealogy shape changes.

// The storage unit a tracked entity currently holds stock in, derived from its
// item-ledger rows by net on-hand per bin. Batch-split ledger entries MUST be
// booked against this bin (not NULL), or per-storage-unit on-hand views (picking,
// available-tracked-entities) won't net to zero. Mirrors the MES helper
// packages/database/supabase/functions/issue/resolve-tracked-entity-bin.ts —
// keep the two in sync. Returns the bin with the highest positive net; falls
// back to any bin the entity appears in when nothing nets positive.
function resolveHoldingStorageUnit(
  rows: { storageUnitId: string | null; quantity: number | string | null }[]
): string | null {
  const netByBin = new Map<string, number>();
  for (const row of rows) {
    if (!row.storageUnitId) continue;
    netByBin.set(
      row.storageUnitId,
      (netByBin.get(row.storageUnitId) ?? 0) + Number(row.quantity ?? 0)
    );
  }
  let bestBin: string | null = null;
  let bestQty = 0;
  for (const [bin, qty] of netByBin) {
    if (qty > bestQty) {
      bestQty = qty;
      bestBin = bin;
    }
  }
  if (bestBin) return bestBin;
  return rows.find((row) => row.storageUnitId)?.storageUnitId ?? null;
}

async function subdivideBatchEntity(
  trx: KyselyTx,
  args: {
    source: Pick<
      TrackedEntityRow,
      | "id"
      | "readableId"
      | "sourceDocumentId"
      | "sourceDocumentReadableId"
      | "status"
      | "attributes"
      | "itemId"
      | "expirationDate"
    >;
    linkId: string;
    newRowId: string;
    nonConformanceId: string;
    itemId: string;
    readableNc: string;
    locationId: string | null;
    entityQty: number;
    moveQty: number;
    keepQty: number;
    companyId: string;
    userId: string;
    nowIso: string;
  }
): Promise<void> {
  const {
    source,
    linkId,
    newRowId,
    nonConformanceId,
    itemId,
    readableNc,
    locationId,
    entityQty,
    moveQty,
    keepQty,
    companyId,
    userId,
    nowIso
  } = args;

  const newEntity = await trx
    .insertInto("trackedEntity")
    .values({
      readableId: source.readableId,
      sourceDocumentId: source.sourceDocumentId,
      sourceDocument: "Item",
      sourceDocumentReadableId: source.sourceDocumentReadableId,
      quantity: moveQty,
      status: source.status ?? "Available",
      attributes: source.attributes,
      itemId: source.itemId ?? source.sourceDocumentId,
      expirationDate: source.expirationDate ?? null,
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .updateTable("trackedEntity")
    .set({
      quantity: keepQty,
      attributes: {
        ...((source.attributes as Record<string, unknown>) ?? {}),
        "Split Entity ID": newEntity.id
      }
    })
    .where("id", "=", source.id)
    .where("companyId", "=", companyId)
    .execute();

  await trx
    .updateTable("nonConformanceItemTrackedEntity")
    .set({ quantity: keepQty, updatedBy: userId, updatedAt: nowIso })
    .where("id", "=", linkId)
    .where("companyId", "=", companyId)
    .execute();

  await trx
    .insertInto("nonConformanceItemTrackedEntity")
    .values({
      nonConformanceItemId: newRowId,
      nonConformanceId,
      trackedEntityId: newEntity.id,
      quantity: moveQty,
      companyId,
      createdBy: userId
    })
    .execute();

  const activity = await trx
    .insertInto("trackedActivity")
    .values({
      type: "Split",
      sourceDocument: "Non-Conformance",
      sourceDocumentId: nonConformanceId,
      sourceDocumentReadableId: readableNc,
      attributes: {
        "Non-Conformance": nonConformanceId,
        "Original Quantity": entityQty,
        "Split Quantity": moveQty,
        "Remaining Quantity": keepQty,
        "Split Entity ID": newEntity.id,
        Employee: userId
      },
      companyId,
      createdBy: userId
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("trackedActivityInput")
    .values({
      trackedActivityId: activity.id,
      trackedEntityId: source.id,
      quantity: entityQty,
      companyId,
      createdBy: userId
    })
    .execute();

  await trx
    .insertInto("trackedActivityOutput")
    .values([
      {
        trackedActivityId: activity.id,
        trackedEntityId: source.id,
        quantity: keepQty,
        companyId,
        createdBy: userId
      },
      {
        trackedActivityId: activity.id,
        trackedEntityId: newEntity.id,
        quantity: moveQty,
        companyId,
        createdBy: userId
      }
    ])
    .execute();

  // The bin the source lot actually holds stock in — split ledger entries book
  // against it so per-storage-unit on-hand stays consistent (see helper note).
  const sourceLedgerRows = await trx
    .selectFrom("itemLedger")
    .select(["storageUnitId", "quantity"])
    .where("trackedEntityId", "=", source.id)
    .where("companyId", "=", companyId)
    .execute();
  const storageUnitId = resolveHoldingStorageUnit(sourceLedgerRows);

  await trx
    .insertInto("itemLedger")
    .values([
      {
        itemId,
        locationId,
        storageUnitId,
        entryType: "Negative Adjmt." as const,
        documentType: "Batch Split" as const,
        documentId: activity.id,
        quantity: -entityQty,
        trackedEntityId: source.id,
        companyId,
        createdBy: userId,
        comment: `NC ${readableNc} batch split`
      },
      {
        itemId,
        locationId,
        storageUnitId,
        entryType: "Positive Adjmt." as const,
        documentType: "Batch Split" as const,
        documentId: activity.id,
        quantity: keepQty,
        trackedEntityId: source.id,
        companyId,
        createdBy: userId,
        comment: `NC ${readableNc} batch split`
      },
      {
        itemId,
        locationId,
        storageUnitId,
        entryType: "Positive Adjmt." as const,
        documentType: "Batch Split" as const,
        documentId: activity.id,
        quantity: moveQty,
        trackedEntityId: newEntity.id,
        companyId,
        createdBy: userId,
        comment: `NC ${readableNc} batch split`
      }
    ])
    .execute();
}

export async function splitIssueItem(args: {
  id: string;
  companyId: string;
  userId: string;
  splitQuantity?: number;
  entityAssignments?: { trackedEntityId: string; quantity: number }[];
}): Promise<Result<{ id: string }>> {
  const { id, companyId, userId, splitQuantity, entityAssignments } = args;
  const db = getDatabaseClient();
  const nowIso = new Date().toISOString();

  try {
    const result = await db.transaction().execute(async (trx) => {
      const item = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "nonConformanceId", "itemId", "quantity"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!item) throw new Error("Item association not found");

      const issue = await trx
        .selectFrom("nonConformance")
        .select(["nonConformanceId", "status", "locationId"])
        .where("id", "=", item.nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      // Re-check inside the transaction: the route lock check is a separate read
      // and could race with a concurrent close.
      if (isIssueLocked(issue?.status)) {
        throw new Error("Cannot modify a closed issue. Reopen it first.");
      }
      const readableNc = issue?.nonConformanceId ?? item.nonConformanceId;
      const locationId = issue?.locationId ?? null;

      // Each NCR link owns a full lot, so a link's quantity always equals its
      // tracked entity's quantity — the greedy fill below relies on that.
      const links = await trx
        .selectFrom("nonConformanceItemTrackedEntity as link")
        .innerJoin("trackedEntity as te", "te.id", "link.trackedEntityId")
        .select([
          "link.id as linkId",
          "link.quantity as linkQuantity",
          "te.id as entityId",
          "te.quantity as entityQuantity",
          "te.status as entityStatus",
          "te.attributes as entityAttributes",
          "te.readableId as entityReadableId",
          "te.sourceDocumentId as entitySourceDocumentId",
          "te.sourceDocumentReadableId as entitySourceDocumentReadableId",
          "te.itemId as entityItemId",
          "te.expirationDate as entityExpirationDate"
        ])
        .where("link.nonConformanceItemId", "=", id)
        .where("link.companyId", "=", companyId)
        .where("te.companyId", "=", companyId)
        .orderBy("te.quantity", "asc")
        .execute();

      if (links.length === 0) throw new Error("No linked entities to split");

      // entityAssignments are whole-lot picks from the multi-entity checkbox UI;
      // splitQuantity fills greedily from the smallest lots, subdividing the
      // last one if it overshoots.
      type Move = { link: (typeof links)[number]; moveQty: number };
      const moves: Move[] = [];

      if (entityAssignments && entityAssignments.length > 0) {
        // Whole-lot picks: trust only the server-side link, not the client's
        // quantity, and reject unknown or duplicated entities.
        const seen = new Set<string>();
        for (const a of entityAssignments) {
          if (seen.has(a.trackedEntityId)) {
            throw new Error("Duplicate entity in split selection");
          }
          seen.add(a.trackedEntityId);
          const link = links.find((l) => l.entityId === a.trackedEntityId);
          if (!link) {
            throw new Error("Selected entity is not linked to this row");
          }
          moves.push({ link, moveQty: Number(link.linkQuantity ?? 0) });
        }
      } else if (typeof splitQuantity === "number" && splitQuantity > 0) {
        let remaining = splitQuantity;
        for (const link of links) {
          if (remaining <= 1e-6) break;
          const q = Number(link.linkQuantity ?? 0);
          if (q <= remaining + 1e-6) {
            moves.push({ link, moveQty: q });
            remaining -= q;
          } else {
            moves.push({ link, moveQty: remaining });
            remaining = 0;
            break;
          }
        }
        if (remaining > 1e-6) {
          throw new Error("Split quantity exceeds the linked entity quantity");
        }
      } else {
        throw new Error("Missing split parameters");
      }

      const effectiveSplitQty = moves.reduce((acc, m) => acc + m.moveQty, 0);
      const current = Number(item.quantity ?? 0);
      if (effectiveSplitQty >= current) {
        throw new Error(
          `Split quantity (${effectiveSplitQty}) must be less than the current quantity (${current})`
        );
      }

      // New disposition row that receives the split-off portion.
      const newRow = await trx
        .insertInto("nonConformanceItem")
        .values({
          nonConformanceId: item.nonConformanceId,
          itemId: item.itemId,
          quantity: effectiveSplitQty,
          disposition: "Pending",
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      for (const { link, moveQty } of moves) {
        const entityQty = Number(link.entityQuantity ?? 0);

        if (moveQty >= entityQty - 1e-6) {
          // Whole lot moving — re-point the link, no physical change.
          await trx
            .updateTable("nonConformanceItemTrackedEntity")
            .set({
              nonConformanceItemId: newRow.id,
              updatedBy: userId,
              updatedAt: nowIso
            })
            .where("id", "=", link.linkId)
            .where("companyId", "=", companyId)
            .execute();
          continue;
        }

        await subdivideBatchEntity(trx, {
          source: {
            id: link.entityId,
            readableId: link.entityReadableId,
            sourceDocumentId: link.entitySourceDocumentId,
            sourceDocumentReadableId: link.entitySourceDocumentReadableId,
            status: link.entityStatus,
            attributes: link.entityAttributes,
            itemId: link.entityItemId,
            expirationDate: link.entityExpirationDate
          },
          linkId: link.linkId,
          newRowId: newRow.id,
          nonConformanceId: item.nonConformanceId,
          itemId: item.itemId,
          readableNc,
          locationId,
          entityQty,
          moveQty,
          keepQty: entityQty - moveQty,
          companyId,
          userId,
          nowIso
        });
      }

      // Shrink the original row by whatever moved out.
      await trx
        .updateTable("nonConformanceItem")
        .set({
          quantity: current - effectiveSplitQty,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      return { id: newRow.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to split line"
    );
  }
}

// -------------------------------------------------------------
// closeIssue
// -------------------------------------------------------------
// Validates disposition plan (qty sums, no Pending rows, no Consumed entities),
// then for each row with linked entities:
//   - insert trackedActivity + trackedActivityInput
//   - flip trackedEntity status (Use As Is / Rework → Available;
//     Scrap / Return to Supplier → Rejected and write a Negative Adjmt. ledger)
// Finally sets nonConformance.status = Closed.

type DispositionLink = {
  id: string;
  trackedEntityId: string;
  quantity: number;
  trackedEntityStatus: string | null;
};

type DispositionRow = {
  id: string;
  itemId: string;
  disposition: string | null;
  quantity: number;
  links: DispositionLink[];
};

type IssueClosureBlocker = { nonConformanceItemId: string; reason: string };

export async function closeIssue(
  client: SupabaseClient<Database>,
  args: { nonConformanceId: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  const { nonConformanceId, companyId, userId } = args;
  const db = getDatabaseClient();

  // Preflight reads via Supabase (uses nested selects / RLS-aware service role)
  const planResult = await (client as any)
    .from("nonConformanceItem")
    .select(
      `
        id,
        itemId,
        disposition,
        quantity,
        links:nonConformanceItemTrackedEntity(
          id,
          quantity,
          trackedEntityId,
          trackedEntity(
            id,
            status
          )
        )
      `
    )
    .eq("nonConformanceId", nonConformanceId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });

  if (planResult.error || !planResult.data) {
    return errResult("Failed to load disposition plan");
  }

  const plan: DispositionRow[] = (planResult.data as any[]).map((row) => ({
    id: row.id,
    itemId: row.itemId,
    disposition: row.disposition,
    quantity: Number(row.quantity ?? 0),
    links: (row.links ?? []).map((link: any) => ({
      id: link.id,
      trackedEntityId: link.trackedEntityId,
      quantity: Number(link.quantity ?? 0),
      trackedEntityStatus: link.trackedEntity?.status ?? null
    }))
  }));

  const blockers: IssueClosureBlocker[] = [];
  for (const row of plan) {
    if (row.links.length === 0) continue;
    if (!row.disposition || row.disposition === "Pending") {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: "Disposition is still Pending"
      });
      continue;
    }
    const sum = row.links.reduce((acc, l) => acc + l.quantity, 0);
    if (Math.abs(sum - row.quantity) > 1e-6) {
      blockers.push({
        nonConformanceItemId: row.id,
        reason: `Linked entity quantity (${sum}) does not match row quantity (${row.quantity})`
      });
    }
    for (const link of row.links) {
      if (!link.trackedEntityStatus) {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: "Linked tracked entity is missing"
        });
      } else if (link.trackedEntityStatus === "Consumed") {
        blockers.push({
          nonConformanceItemId: row.id,
          reason: `Tracked entity ${link.trackedEntityId} is already Consumed`
        });
      }
    }
  }

  if (blockers.length > 0) {
    return errResult(
      `Cannot close: ${blockers.map((b) => b.reason).join("; ")}`,
      blockers
    );
  }

  try {
    const result = await db.transaction().execute(async (trx) => {
      const issue = await trx
        .selectFrom("nonConformance")
        .select(["id", "nonConformanceId", "status", "locationId"])
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!issue) throw new Error("Issue not found");
      if (issue.status === "Closed") return { id: issue.id };

      const nowIso = new Date().toISOString();
      const today = nowIso.slice(0, 10);
      const readableNc = issue.nonConformanceId ?? nonConformanceId;
      const locationId = issue.locationId;

      // The preflight plan above was read outside this transaction and can be
      // stale (a concurrent split/move changes rows and link quantities). Re-read
      // the plan under a row lock and re-validate the correctness-critical
      // invariants before posting, so a race rolls back instead of posting a
      // ledger off stale quantities. `forUpdate` on the item rows serializes
      // against split/move, which update the same rows.
      const itemRows = await trx
        .selectFrom("nonConformanceItem")
        .select(["id", "itemId", "disposition", "quantity"])
        .where("nonConformanceId", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .orderBy("createdAt", "asc")
        .forUpdate()
        .execute();

      const linkRows = await trx
        .selectFrom("nonConformanceItemTrackedEntity as link")
        .innerJoin("trackedEntity as te", (join) =>
          join
            .onRef("te.id", "=", "link.trackedEntityId")
            .onRef("te.companyId", "=", "link.companyId")
        )
        .select([
          "link.nonConformanceItemId as nonConformanceItemId",
          "link.id as id",
          "link.trackedEntityId as trackedEntityId",
          "link.quantity as quantity",
          "te.status as trackedEntityStatus"
        ])
        .where("link.nonConformanceId", "=", nonConformanceId)
        .where("link.companyId", "=", companyId)
        .execute();

      const linksByItem = new Map<string, DispositionLink[]>();
      for (const link of linkRows) {
        const arr = linksByItem.get(link.nonConformanceItemId) ?? [];
        arr.push({
          id: link.id,
          trackedEntityId: link.trackedEntityId,
          quantity: Number(link.quantity ?? 0),
          trackedEntityStatus: link.trackedEntityStatus ?? null
        });
        linksByItem.set(link.nonConformanceItemId, arr);
      }

      const freshPlan: DispositionRow[] = itemRows.map((row) => ({
        id: row.id,
        itemId: row.itemId,
        disposition: row.disposition,
        quantity: Number(row.quantity ?? 0),
        links: linksByItem.get(row.id) ?? []
      }));

      for (const row of freshPlan) {
        if (row.links.length === 0) continue;
        if (!row.disposition || row.disposition === "Pending") {
          throw new Error("Disposition changed while closing; please retry.");
        }
        const sum = row.links.reduce((acc, l) => acc + l.quantity, 0);
        if (Math.abs(sum - row.quantity) > 1e-6) {
          throw new Error("Quantities changed while closing; please retry.");
        }
        for (const link of row.links) {
          if (
            !link.trackedEntityStatus ||
            link.trackedEntityStatus === "Consumed"
          ) {
            throw new Error(
              "A tracked entity changed while closing; please retry."
            );
          }
        }
      }

      for (const row of freshPlan) {
        if (row.links.length === 0) continue;

        const activity = await trx
          .insertInto("trackedActivity")
          .values({
            type: "Disposition",
            sourceDocument: "Non-Conformance",
            sourceDocumentId: nonConformanceId,
            sourceDocumentReadableId: readableNc,
            attributes: {
              "Non-Conformance": nonConformanceId,
              Disposition: row.disposition ?? "",
              Employee: userId
            },
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("trackedActivityInput")
          .values(
            row.links.map((link) => ({
              trackedActivityId: activity.id,
              trackedEntityId: link.trackedEntityId,
              quantity: link.quantity,
              companyId,
              createdBy: userId
            }))
          )
          .execute();

        if (row.disposition === "Use As Is" || row.disposition === "Rework") {
          const idsToFlip = row.links
            .filter((l) => l.trackedEntityStatus !== "Available")
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Available" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
          continue;
        }

        if (
          row.disposition === "Scrap" ||
          row.disposition === "Return to Supplier"
        ) {
          const commentSuffix =
            row.disposition === "Scrap" ? "scrap" : "return to supplier";

          await trx
            .insertInto("itemLedger")
            .values(
              row.links.map((link) => ({
                itemId: row.itemId,
                locationId,
                entryType: "Negative Adjmt." as const,
                documentType: "Non-Conformance" as const,
                documentId: nonConformanceId,
                quantity: -link.quantity,
                trackedEntityId: link.trackedEntityId,
                companyId,
                createdBy: userId,
                comment: `NC ${readableNc} ${commentSuffix}`
              }))
            )
            .execute();

          const idsToFlip = row.links
            .filter((l) => l.trackedEntityStatus !== "Rejected")
            .map((l) => l.trackedEntityId);
          if (idsToFlip.length > 0) {
            await trx
              .updateTable("trackedEntity")
              .set({ status: "Rejected" })
              .where("id", "in", idsToFlip)
              .where("companyId", "=", companyId)
              .execute();
          }
        }
      }

      const updated = await trx
        .updateTable("nonConformance")
        .set({
          status: "Closed",
          closeDate: today,
          updatedBy: userId,
          updatedAt: nowIso
        })
        .where("id", "=", nonConformanceId)
        .where("companyId", "=", companyId)
        .returning(["id"])
        .executeTakeFirstOrThrow();

      return { id: updated.id };
    });

    return { data: result, error: null };
  } catch (err) {
    return errResult(
      err instanceof Error ? err.message : "Failed to close NCR"
    );
  }
}
