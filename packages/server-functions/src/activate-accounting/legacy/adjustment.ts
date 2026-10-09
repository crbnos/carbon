// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journals of legacy movements booked through the adjustment core
// (`bookAdjustment` / `valueMovement`, lib/post-adjustment.ts): one pair per
// cost row, inventory against the offset the posting used, at the cost the
// row stored, zero included for an outbound row, so the enable's re-cost
// finds it (.ai/specs/implemented/2026-10-08-accounting-cutover.md section
// 5a). The pair is `buildAdjustmentJournalLines`, so the document type,
// sides and descriptions are the core's own.
//
// Per family, as each posting calls the core:
// - a manual adjustment (post-inventory-adjustment): one journal per
//   movement, "Inventory Adjustment[ — comment]", the variance account;
// - the CSV stock import (import-csv/stock-quantity-import.ts,
//   `importStockQuantities`): one journal per file, "Inventory Adjustment —
//   CSV import". A file is the movements one transaction wrote, found by their shared
//   `createdAt`; a file of one row reads as a manual adjustment;
// - scrap and unscrap (post-inventory-adjustment): "Scrap[ — comment]" or
//   "Unscrap[ — comment]", the scrap account, with the ScrapReason and
//   Employee dimensions. A scrap from a job (`issue`, `scrapTrackedEntity`) is
//   "Scrap — <item>" on the job; its WorkCenter dimension
//   (the material's operation) is not stored on the movement and is left off;
// - an inventory count (post-inventory-count): one journal per count,
//   "Inventory Count <id>", the variance account;
// - a non-conformance disposition or inspection reject (post-nonconformance,
//   called from quality-disposition.server.ts and
//   inspection+/$id.reject.tsx): one journal per call, "NC <id> disposition"
//   or "Inbound inspection lot rejected", the scrap account as "Scrap / Cost
//   of Quality", sourceType the document type;
// - maintenance parts (`issue`, `valueMaintenanceMovements`): one journal
//   per call, "Maintenance Consumption <id>", the maintenance account, with
//   the WorkCenter dimension of the dispatch.
// A scrap offset before the cutover is a stand-in line when the scrap
// account is empty, as `resolveDefaultAccount` makes it; the enable
// re-points it.
//
// The Location, ScrapReason and Employee of a movement come from its item
// ledger row. A row whose cost row names the movement itself (an adjustment,
// a manual scrap) is read by id. Otherwise the rows of one document, item,
// sign and transaction are paired with the cost rows in entry order, as
// the core writes them one after the other.

import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import { legacyAdjustmentCostRows } from "@carbon/database/legacy-documents";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { buildAdjustmentJournalLines } from "../../lib/plan-adjustment";
import {
  type DimensionEntityType,
  type LegacyJournalLine,
  type LegacyMovementJournal,
  readByIds,
  readItems,
  readPostingGroups
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

export type LegacyAdjustmentJournals = {
  inventoryAdjustments: LegacyMovementJournal[];
  inventoryCounts: LegacyMovementJournal[];
  nonConformances: LegacyMovementJournal[];
  maintenanceConsumptions: LegacyMovementJournal[];
};

type Offset = {
  accountId: string | null;
  accountDefaultRole: OptionalDefaultRole | null;
  description: string;
};

/** "Label — comment", or the label alone, as the postings describe. */
function withComment(label: string, comment: string | null | undefined) {
  return comment?.trim() ? `${label} — ${comment.trim()}` : label;
}

function sign(quantity: number) {
  return quantity < 0 ? "out" : "in";
}

export async function buildLegacyAdjustmentJournals(
  trx: KyselyTx,
  {
    companyId,
    cutoverDate,
    defaults
  }: { companyId: string; cutoverDate: string; defaults: AccountDefaults }
): Promise<LegacyAdjustmentJournals> {
  const result: LegacyAdjustmentJournals = {
    inventoryAdjustments: [],
    inventoryCounts: [],
    nonConformances: [],
    maintenanceConsumptions: []
  };
  const rows = await legacyAdjustmentCostRows(trx, {
    companyId,
    cutoverDate
  }).execute();
  if (rows.length === 0) return result;

  const ledgerColumns = [
    "id",
    "itemId",
    "quantity",
    "documentType",
    "documentId",
    "comment",
    "createdBy",
    "locationId",
    "scrapReasonId",
    sql<string>`"createdAt"::text`.as("createdAt")
  ] as const;

  // The movement a cost row names itself: an adjustment, a CSV import row, a
  // manual scrap or unscrap. The core sets the cost row's document to the
  // ledger row's id when the movement has no document.
  const ownLedgers = await readByIds(
    rows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger")
        .select(ledgerColumns)
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .where("documentId", "is", null)
        .execute()
  );
  const ownLedgerById = new Map(ownLedgers.map((row) => [row.id, row]));
  const ownLedger = (row: (typeof rows)[number]) => {
    const ledger = ownLedgerById.get(row.documentId);
    return ledger && ledger.documentType === row.documentType
      ? ledger
      : undefined;
  };

  // The movements of a document, paired with its cost rows in entry order.
  const documentRows = rows.filter(
    (row) =>
      !ownLedger(row) &&
      row.documentType !== null &&
      row.documentType !== "Maintenance Consumption"
  );
  const documentLedgers = await readByIds(
    documentRows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger")
        .select(ledgerColumns)
        .where("companyId", "=", companyId)
        .where("documentId", "in", ids)
        .where("documentType", "in", [
          "Scrap",
          "Inventory Count",
          "Non-Conformance",
          "Inbound Inspection"
        ])
        .where("correctionOfItemLedgerId", "is", null)
        .orderBy("entryNumber")
        .execute()
  );
  const pairKey = (row: {
    documentType: string | null;
    documentId: string | null;
    itemId: string | null;
    createdAt: string;
    quantity: number;
  }) =>
    `${row.documentType}|${row.documentId}|${row.itemId}|${row.createdAt}|${sign(Number(row.quantity))}`;
  const ledgerQueues = Map.groupBy(documentLedgers, (row) => pairKey(row));
  const pairedLedger = new Map<string, (typeof documentLedgers)[number]>();
  for (const row of documentRows) {
    const next = ledgerQueues.get(pairKey(row))?.shift();
    if (next) pairedLedger.set(row.id, next);
  }

  // How many movements with no document each transaction wrote: more than
  // one is a CSV import file.
  const batchSizes = await readByIds(
    rows
      .filter((row) => row.documentType === null && ownLedger(row))
      .map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("itemLedger as batch")
        .select([
          sql<string>`"batch"."createdAt"::text`.as("createdAt"),
          sql<number>`count(*)`.as("count")
        ])
        .where("batch.companyId", "=", companyId)
        .where("batch.documentType", "is", null)
        .where("batch.documentId", "is", null)
        .where("batch.correctionOfItemLedgerId", "is", null)
        .where("batch.createdAt", "in", (eb) =>
          eb
            .selectFrom("itemLedger")
            .select("createdAt")
            .where("companyId", "=", companyId)
            .where("id", "in", ids)
        )
        .groupBy("batch.createdAt")
        .execute()
  );
  const batchSizeByCreatedAt = new Map(
    batchSizes.map((row) => [row.createdAt, Number(row.count)])
  );

  const documentIds = (documentType: string) =>
    rows
      .filter((row) => row.documentType === documentType)
      .map((row) => row.documentId);
  const counts = await readByIds(documentIds("Inventory Count"), (ids) =>
    trx
      .selectFrom("inventoryCount")
      .select(["id", "inventoryCountId"])
      .where("companyId", "=", companyId)
      .where("id", "in", ids)
      .execute()
  );
  const nonConformances = await readByIds(
    documentIds("Non-Conformance"),
    (ids) =>
      trx
        .selectFrom("nonConformance")
        .select(["id", "nonConformanceId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const dispatches = await readByIds(
    documentIds("Maintenance Consumption"),
    (ids) =>
      trx
        .selectFrom("maintenanceDispatch")
        .select(["id", "maintenanceDispatchId", "locationId", "workCenterId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const itemIds = rows.map((row) => row.itemId);
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const countById = new Map(counts.map((row) => [row.id, row]));
  const nonConformanceById = new Map(
    nonConformances.map((row) => [row.id, row])
  );
  const dispatchById = new Map(dispatches.map((row) => [row.id, row]));

  const variance: Offset = {
    accountId: defaults.inventoryAdjustmentVarianceAccount,
    accountDefaultRole: null,
    description: "Inventory Adjustment"
  };
  // Before the cutover an empty scrap account is a stand-in line.
  const scrapAccount = resolveDefaultAccount(
    defaults,
    "scrapAccount",
    "Provisional"
  );

  const groups = new Map<
    string,
    { family: keyof LegacyAdjustmentJournals; journal: LegacyMovementJournal }
  >();
  for (const row of rows) {
    const { itemId, documentId } = row;
    const quantity = Number(row.quantity);
    const own = ownLedger(row);
    const ledger = own ?? pairedLedger.get(row.id);
    let key: string;
    // The family the detection names (legacy-documents.ts), so the wizard's
    // counts and these journals agree.
    const family: keyof LegacyAdjustmentJournals = row.family;
    let description: string;
    let sourceType: LegacyMovementJournal["sourceType"] =
      "Inventory Adjustment";
    let offset = variance;
    let locationId = ledger?.locationId ?? null;
    let extra: Partial<Record<DimensionEntityType, string | null>> = {};

    switch (row.documentType) {
      case null: {
        // Not a movement of the core (a revaluation names its unit).
        if (!own) continue;
        const isImport = (batchSizeByCreatedAt.get(own.createdAt) ?? 1) > 1;
        key = isImport ? `import:${own.createdAt}` : `adjustment:${own.id}`;
        description = isImport
          ? "Inventory Adjustment — CSV import"
          : withComment("Inventory Adjustment", own.comment);
        break;
      }
      case "Scrap": {
        if (own) {
          key = `scrap:${own.id}`;
          description = withComment(
            quantity < 0 ? "Scrap" : "Unscrap",
            own.comment
          );
        } else {
          key = `job-scrap:${row.id}`;
          description = `Scrap — ${itemById.get(itemId)?.readableIdWithRevision ?? ""}`;
        }
        offset = { ...scrapAccount, description: "Scrap Account" };
        extra = {
          ScrapReason: ledger?.scrapReasonId ?? null,
          Employee: ledger?.createdBy ?? null
        };
        break;
      }
      case "Inventory Count": {
        key = `count:${documentId}:${row.createdAt}`;
        const count = countById.get(documentId);
        description = count
          ? `Inventory Count ${count.inventoryCountId}`
          : (ledger?.comment ?? "Inventory Count");
        break;
      }
      case "Non-Conformance":
      case "Inbound Inspection": {
        key = `${row.documentType}:${documentId}:${row.createdAt}`;
        sourceType = row.documentType;
        description =
          row.documentType === "Non-Conformance"
            ? `NC ${nonConformanceById.get(documentId)?.nonConformanceId ?? documentId} disposition`
            : "Inbound inspection lot rejected";
        offset = { ...scrapAccount, description: "Scrap / Cost of Quality" };
        break;
      }
      case "Maintenance Consumption": {
        key = `maintenance:${documentId}:${row.createdAt}`;
        const dispatch = dispatchById.get(documentId);
        description = `Maintenance Consumption ${dispatch?.maintenanceDispatchId ?? documentId}`;
        // An empty maintenance account falls back to the variance account
        // in the core's pair builder.
        offset = {
          accountId: defaults.maintenanceAccount,
          accountDefaultRole: null,
          description: "Maintenance Expense"
        };
        locationId = dispatch?.locationId ?? null;
        extra = { WorkCenter: dispatch?.workCenterId ?? null };
        break;
      }
      default:
        continue;
    }

    const [inventoryLine, offsetLine] = buildAdjustmentJournalLines({
      journalId: "",
      documentId,
      documentType: row.documentType,
      journalLineReference: nanoid(),
      isGain: quantity > 0,
      cost: Math.abs(Number(row.cost)),
      quantity: Math.abs(quantity),
      replenishmentSystem: itemById.get(itemId)?.replenishmentSystem ?? null,
      accountDefaults: defaults,
      offsetAccount: offset.accountId,
      offsetDescription: offset.description,
      companyId
    });
    const dimensions = {
      Item: itemId,
      ItemPostingGroup: postingGroupByItem.get(itemId) ?? null,
      Location: locationId,
      ...extra
    };
    const lines: LegacyJournalLine[] = [inventoryLine, offsetLine].map(
      ({ journalId: _journalId, companyId: _companyId, ...line }) => ({
        ...line,
        dimensions
      })
    );
    lines[1]!.accountDefaultRole = offset.accountDefaultRole;

    const group = groups.get(key);
    if (group) {
      group.journal.lines.push(...lines);
    } else {
      groups.set(key, {
        family,
        journal: {
          description,
          postingDate: String(row.postingDate),
          sourceType,
          lines,
          // Every posting through the core stores its cost row.
          fromStoredCost: true
        }
      });
    }
  }

  for (const { family, journal } of groups.values()) {
    result[family].push(journal);
  }
  return result;
}
