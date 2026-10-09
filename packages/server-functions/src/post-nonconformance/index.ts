// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import {
  assertPostingStatusUnchanged,
  journalPostingStatus,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { inOrder, many, single } from "@carbon/database/rows";
import { datetime } from "@carbon/utils";
import { z } from "zod";
import { assertCompanyRecords } from "../company-records";
import { defineServerFn } from "../define-server-fn";
import { NotFoundError } from "../errors";
import { getCurrentAccountingPeriod } from "../lib/get-accounting-period";
import { getDefaultPostingGroup } from "../lib/get-posting-group";
import {
  bookAdjustment,
  createAdjustmentJournal
} from "../lib/post-adjustment";
import type { AdjustmentItemCost } from "../lib/post-adjustment-cost";

// The GL/cost posting path for inspection-reject and NCR-disposition inventory
// write-offs. The caller (inspection reject route / closeIssue) owns the
// physical/status side — tracked-entity flips, nonConformance.status — and hands
// this function a batch of explicit SIGNED movements. In ONE transaction each
// movement books through the shared core: item ledger + cost layers + a
// balanced journal (Provisional before the accounting cutover, Posted after it)
// against the company's scrapAccount (offset), one shared journal per call. Scrap / Return post a
// Negative Adjmt. (Dr Scrap / Cr Inventory + relieve layers); a kept lot's
// restore posts a Positive Adjmt. (Dr Inventory / Cr Scrap + create a layer).
export const postNonConformanceInput = z.object({
  // Drives both the itemLedger/costLedger documentType and the journal
  // sourceType — 'Non-Conformance' for a disposition close, 'Inbound Inspection'
  // for an inspection reject.
  documentType: z.enum(["Non-Conformance", "Inbound Inspection"]),
  documentId: z.string(),
  description: z.string().optional().nullable(),
  postingDate: z.string().optional().nullable(),
  movements: z
    .array(
      z.object({
        itemId: z.string(),
        locationId: z.string().optional().nullable(),
        trackedEntityId: z.string().optional().nullable(),
        // SIGNED: < 0 removes value (scrap/return), > 0 restores value (kept).
        quantity: z.number(),
        comment: z.string().optional().nullable()
      })
    )
    .min(1)
});

const postNonConformance = defineServerFn({
  name: "post-nonconformance",
  input: postNonConformanceInput,
  permissions: { update: "quality" },
  async run(
    ctx,
    {
      documentType,
      documentId,
      description,
      postingDate: providedPostingDate,
      movements
    }
  ) {
    const { db, companyId, userId } = ctx;
    const postingDate =
      providedPostingDate ||
      datetime.today(await getCompanyTimeZone(db, companyId)).toString();

    // Only movements that actually move stock post anything.
    const effectiveMovements = movements.filter((m) => m.quantity !== 0);
    if (effectiveMovements.length === 0) {
      return { journalId: null };
    }

    // The permission check proves the caller may act in companyId, not that
    // the document or the movements' location / tracked entity belong to it —
    // all three land on this company's ledger rows.
    await assertCompanyRecords(
      db,
      documentType === "Inbound Inspection" ? "inspection" : "nonConformance",
      [documentId],
      companyId,
      documentType === "Inbound Inspection" ? "Inspection" : "Non-conformance"
    );
    await assertCompanyRecords(
      db,
      "location",
      effectiveMovements.map((m) => m.locationId),
      companyId,
      "Location"
    );
    await assertCompanyRecords(
      db,
      "trackedEntity",
      effectiveMovements.map((m) => m.trackedEntityId),
      companyId,
      "Tracked entity"
    );

    const itemIds = [...new Set(effectiveMovements.map((m) => m.itemId))];

    const [itemsResult, itemCostsResult] = await inOrder([
      () =>
        many(
          db,
          "item",
          { id: itemIds, companyId },
          { columns: ["id", "itemTrackingType", "replenishmentSystem"] }
        ),
      () =>
        many(
          db,
          "itemCost",
          { itemId: itemIds, companyId },
          {
            columns: [
              "itemId",
              "costingMethod",
              "unitCost",
              "standardCost",
              "itemPostingGroupId"
            ]
          }
        )
    ]);

    if (itemsResult.error) throw new Error("Failed to fetch items");
    if (itemCostsResult.error) throw new Error("Failed to fetch item costs");

    // The generated types are deep enough that a multi-row .select() infers as
    // {} here; type the projected rows explicitly (the reference sidesteps this
    // via .single()).
    type NcItemRow = {
      id: string;
      itemTrackingType: string | null;
      replenishmentSystem:
        | Database["public"]["Enums"]["itemReplenishmentSystem"]
        | null;
    };
    type NcItemCostRow = {
      itemId: string;
      costingMethod: Database["public"]["Enums"]["itemCostingMethod"];
      unitCost: number | null;
      standardCost: number | null;
      itemPostingGroupId: string | null;
    };
    const itemById = new Map<string, NcItemRow>(
      ((itemsResult.data ?? []) as NcItemRow[]).map((row) => [row.id, row])
    );
    const costByItem = new Map<string, NcItemCostRow>(
      ((itemCostsResult.data ?? []) as NcItemCostRow[]).map((row) => [
        row.itemId,
        row
      ])
    );

    // Every movement that carries value posts a journal: Provisional before the
    // company's accounting cutover, Posted after it. Read here to decide
    // whether to resolve a period, and again inside the transaction.
    const postingStatus = await journalPostingStatus(db, companyId);
    const accountDefaults = await getDefaultPostingGroup(db, companyId);
    if (accountDefaults.error || !accountDefaults.data) {
      throw new Error("Error getting account defaults");
    }

    // Active dimensions for the company group — journal lines get
    // Item / ItemPostingGroup / Location tags (post-adjustment precedent).
    const dimensionMap: Record<string, string> = {};
    const companyRecord = await single(
      db,
      "company",
      { id: companyId },
      { columns: ["companyGroupId"] }
    );
    if (companyRecord.error) throw new Error("Failed to fetch company");
    const companyGroupId = companyRecord.data.companyGroupId;
    if (companyGroupId) {
      const dimensions = await many(
        db,
        "dimension",
        {
          companyGroupId,
          active: true,
          entityType: ["Item", "ItemPostingGroup", "Location"]
        },
        { columns: ["id", "entityType"] }
      );
      if (dimensions.error) throw new Error("Failed to fetch dimensions");
      for (const dim of dimensions.data ?? []) {
        if (dim.entityType) dimensionMap[dim.entityType] = dim.id;
      }
    }

    // Resolve the accounting period BEFORE opening the transaction —
    // getCurrentAccountingPeriod uses the REST client and calling it
    // mid-transaction parks the (size 1) pool in idle-in-transaction. A
    // Provisional journal has no accounting period.
    const accountingPeriodId =
      postingStatus === "Posted"
        ? await getCurrentAccountingPeriod(companyId, db, postingDate)
        : null;

    const journalDescription =
      description?.trim() ||
      (documentType === "Inbound Inspection"
        ? "Inbound Inspection write-off"
        : "Non-Conformance disposition");

    let journalId: string | null = null;

    await db.transaction().execute(async (trx) => {
      // Idempotent per (documentType, documentId): a reject posts one write-off
      // per inspection, a disposition close posts once per NCR (reopen is blocked
      // after posting). A retry after a partial route failure — e.g. the caller's
      // status/NCR step failed after this already committed — must not double-post.
      const alreadyPosted = await trx
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", companyId)
        .where("documentType", "=", documentType)
        .where("documentId", "=", documentId)
        .limit(1)
        .executeTakeFirst();
      if (alreadyPosted) return;

      await assertPostingStatusUnchanged(trx, companyId, postingStatus);

      // One shared journal per call (per reject / per disposition close), a line
      // pair per movement — created lazily so an all-zero-value run posts none.
      // Cost of quality: offset to scrapAccount, or to the variance account
      // when it is empty.
      const scrapAccountId = resolveDefaultAccount(
        accountDefaults.data,
        "scrapAccount",
        postingStatus
      ).accountId;
      const accounting = {
        postingStatus,
        accountingPeriodId,
        accountDefaults: {
          rawMaterialsAccount: accountDefaults.data.rawMaterialsAccount,
          finishedGoodsAccount: accountDefaults.data.finishedGoodsAccount,
          inventoryAdjustmentVarianceAccount:
            accountDefaults.data.inventoryAdjustmentVarianceAccount
        },
        offsetAccount: scrapAccountId,
        offsetDescription: "Scrap / Cost of Quality",
        sourceType: documentType,
        description: journalDescription,
        userId,
        dimensions: dimensionMap,
        getJournalId: async () => {
          if (!journalId) {
            journalId = await createAdjustmentJournal(trx, {
              companyId,
              accountingPeriodId,
              status: postingStatus,
              description: journalDescription,
              postingDate,
              userId,
              sourceType: documentType
            });
          }
          return journalId;
        }
      };

      for (const movement of effectiveMovements) {
        const itemRow = itemById.get(movement.itemId);
        if (!itemRow)
          throw new NotFoundError(`Item ${movement.itemId} not found`);
        const costRow = costByItem.get(movement.itemId);
        // Missing itemCost (rare) — post the ledger movement at zero value so a
        // disposition is never blocked; no journal results from a zero cost.
        const itemCost: AdjustmentItemCost = costRow
          ? {
              costingMethod: costRow.costingMethod,
              unitCost: costRow.unitCost,
              standardCost: costRow.standardCost
            }
          : { costingMethod: "Average", unitCost: 0, standardCost: 0 };

        await bookAdjustment(trx, {
          ledger: {
            postingDate,
            itemId: movement.itemId,
            quantity: movement.quantity,
            locationId: movement.locationId ?? null,
            storageUnitId: null,
            trackedEntityId: movement.trackedEntityId ?? null,
            entryType:
              movement.quantity < 0 ? "Negative Adjmt." : "Positive Adjmt.",
            documentType,
            documentId,
            comment: movement.comment ?? null,
            companyId,
            createdBy: userId
          },
          item: {
            itemTrackingType: itemRow.itemTrackingType,
            replenishmentSystem: itemRow.replenishmentSystem,
            itemPostingGroupId: costRow?.itemPostingGroupId ?? null
          },
          itemCost,
          accounting
        });
      }
    });

    return { journalId: journalId as string | null };
  }
});

export default postNonConformance;
