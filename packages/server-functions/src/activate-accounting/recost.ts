// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Steps 2 and 3 of the enable (.ai/specs/implemented/2026-10-08-accounting-cutover.md
// section 5): inventory as of the cutover date, and the
// outbound movements after it valued against it.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import {
  planInventoryReset,
  type RecostEvent,
  recostOutbound,
  splitOpeningLayersByStripe
} from "@carbon/database/accounting-cutover";
import type { getCutoverInventory } from "@carbon/database/accounting-cutover-reads";
import type { KyselyTx } from "@carbon/database/client";
import {
  type CostingMethod,
  isCostLayer,
  isCostRelief
} from "@carbon/database/cost-relief";
import { inOrder } from "@carbon/database/rows";
import { getNextSequences } from "@carbon/database/sequence";
import {
  accountTypeFromClass,
  chunkArray,
  credit,
  datetime,
  debit,
  EPSILON,
  equals,
  round
} from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { ServerFnError } from "../errors";
import { resolveInventoryAccount } from "../lib/get-posting-group";
import { buildProjectCipRow, writeProjectCipRows } from "../lib/project-cip";
import {
  buildProjectLedgerRow,
  insertProjectLedgerRows
} from "../lib/project-posting";
import { ROWS_PER_STATEMENT, readByIds } from "./legacy/write";

const RECOST_DESCRIPTION = "Cutover recost";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];
type ProjectLedgerRow = Database["public"]["Tables"]["projectLedger"]["Row"];

/** Sets each row's `column` to its value, one statement per chunk. */
async function setCostLedger(
  trx: KyselyTx,
  companyId: string,
  column: "remainingQuantity" | "cost",
  rows: [id: string, value: number][]
) {
  for (const chunk of chunkArray(rows, ROWS_PER_STATEMENT)) {
    await sql`
      UPDATE "costLedger" AS c
      SET ${sql.ref(column)} = v."value"
      FROM (VALUES ${sql.join(
        chunk.map(([id, value]) => sql`(${id}, ${value}::numeric)`)
      )}) AS v("id", "value")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }
}

/**
 * The pool a cost row relieves from or opens into: its item, on its stock
 * stripe. `calculateCOGS` relieves a project stripe from that stripe's
 * layers only. Common stock keys on the item alone.
 */
function poolKey(itemId: string, projectId: string | null): string {
  return projectId ? `${itemId}\u0000${projectId}` : itemId;
}

/**
 * Closes the cost layers dated before the cutover and opens one layer per
 * item and stock stripe at the reviewed unit cost
 * (`splitOpeningLayersByStripe`). Then re-costs every outbound movement of a
 * FIFO or LIFO item dated on or after the cutover: the opening layer and
 * every layer and movement after it run again in the order they were posted
 * (`recostOutbound`), each movement relieving the layers open then as
 * `calculateCOGS` does, with its serial units and the layers' invoice
 * write-ups. Each document's difference is booked as a Provisional "Cutover
 * recost" journal between the accounts its own posting used. Standard and
 * Average items cost from `itemCost`, not layers, so their movements keep
 * their cost. A serial recost (`costLedgerType` "Revaluation") keeps its
 * cost: it relieves the layers in the run, but the account its difference
 * was booked against is not stored, so it is not re-costed.
 *
 * Each stock stripe is its own pool, as `calculateCOGS` relieves it. A
 * project stock Transfer or Borrow moves stock at cost between two stripes
 * of one inventory account: the layer it opens takes the re-costed cost of
 * the stock it drew, and it books no journal. A Payback whose cost changes
 * is refused: its lender layers, variance journal and Payback Variance
 * ledger row would all have to move with it.
 */
export async function resetAndRecostInventory(
  trx: KyselyTx,
  {
    companyId,
    userId,
    cutoverDate,
    companyGroupId,
    inventory,
    defaults
  }: {
    companyId: string;
    userId: string;
    cutoverDate: string;
    companyGroupId: string;
    inventory: Awaited<ReturnType<typeof getCutoverInventory>>;
    defaults: AccountDefaults;
  }
) {
  // The layers before the cutover close, their invoice write-ups with them.
  const openBefore = trx
    .selectFrom("costLedger")
    .select("id")
    .where("companyId", "=", companyId)
    .where(isCostLayer)
    .where("postingDate", "<", cutoverDate)
    .where("remainingQuantity", ">", 0);
  await trx
    .updateTable("costLedger")
    .set({ remainingQuantity: 0 })
    .where("companyId", "=", companyId)
    .where("remainingQuantity", ">", 0)
    .where((eb) =>
      eb.or([
        eb("id", "in", openBefore),
        eb("appliesToCostLedgerId", "in", openBefore)
      ])
    )
    .execute();
  // Project stock at the cutover, per item and stripe.
  const projectOnHand = await trx
    .selectFrom("itemLedger")
    .select([
      "itemId",
      "projectId",
      sql<number>`sum("quantity")`.as("quantity")
    ])
    .where("companyId", "=", companyId)
    .where("postingDate", "<", cutoverDate)
    .where("projectId", "is not", null)
    .groupBy(["itemId", "projectId"])
    .having(sql`sum("quantity")`, ">", 0)
    .execute();
  const openingLayers = splitOpeningLayersByStripe(
    planInventoryReset(
      inventory.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity
      })),
      new Map(inventory.map((item) => [item.itemId, item.unitCost]))
    ),
    projectOnHand.map((row) => ({
      itemId: row.itemId,
      projectId: row.projectId!,
      quantity: Number(row.quantity)
    }))
  );

  // The FIFO and LIFO items' layers and movements after the cutover, in the
  // order they were posted, and the layers' invoice write-ups.
  const layeredItems = trx
    .selectFrom("itemCost")
    .select("itemId")
    .where("companyId", "=", companyId)
    .where("costingMethod", "in", ["FIFO", "LIFO"]);
  const afterCutover = trx
    .selectFrom("costLedger")
    .where("companyId", "=", companyId)
    .where("postingDate", ">=", cutoverDate)
    .where("itemId", "in", layeredItems);
  const [layeredCosts, ledger, children, leaving] = await inOrder([
    () =>
      trx
        .selectFrom("itemCost")
        .select(["itemId", "unitCost", "costingMethod"])
        .where("companyId", "=", companyId)
        .where("costingMethod", "in", ["FIFO", "LIFO"])
        .execute(),
    () =>
      afterCutover
        .select([
          "id",
          "itemId",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId",
          "costLedgerType",
          "documentType",
          "documentId",
          "postingDate",
          "projectId"
        ])
        .where((eb) => eb.or([isCostLayer(eb), isCostRelief(eb)]))
        .orderBy("postingDate")
        .orderBy("createdAt")
        .orderBy("entryNumber")
        .execute(),
    () =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "appliesToCostLedgerId",
          "quantity",
          "cost",
          "remainingQuantity"
        ])
        .where("companyId", "=", companyId)
        .where(
          "appliesToCostLedgerId",
          "in",
          afterCutover.select("id").where(isCostLayer)
        )
        .orderBy("createdAt")
        .execute(),
    // The serial units each document's outbound rows took out.
    () =>
      trx
        .selectFrom("itemLedger")
        .select(["documentId", "itemId", "trackedEntityId"])
        .distinct()
        .where("companyId", "=", companyId)
        .where("postingDate", ">=", cutoverDate)
        .where("itemId", "in", layeredItems)
        .where("quantity", "<", 0)
        .where("trackedEntityId", "is not", null)
        .execute()
  ]);
  const methodByItem = new Map(
    layeredCosts.map((row): [string, CostingMethod] => [
      row.itemId,
      row.costingMethod === "LIFO" ? "LIFO" : "FIFO"
    ])
  );
  const childrenByLayer = Map.groupBy(
    children,
    (child) => child.appliesToCostLedgerId
  );
  const leavingByDocumentItem = Map.groupBy(
    leaving,
    (row) => `${row.documentId}:${row.itemId}`
  );

  // The type of each project stock transfer after the cutover: a Transfer
  // or a Borrow opens its layer at the cost of the stock it drew.
  const transferIds = [
    ...new Set(
      ledger.flatMap((row) =>
        row.documentType === "Project Transfer" && row.documentId
          ? [row.documentId]
          : []
      )
    )
  ];
  const transferTypeById = new Map(
    (
      await readByIds(transferIds, (ids) =>
        trx
          .selectFrom("projectStockTransfer")
          .select(["id", "type"])
          .where("companyId", "=", companyId)
          .where("id", "in", ids)
          .execute()
      )
    ).map((transfer) => [transfer.id, transfer.type])
  );
  const transferType = (row: (typeof ledger)[number]) =>
    row.documentType === "Project Transfer" && row.documentId
      ? transferTypeById.get(row.documentId)
      : undefined;
  const movesAtCost = (row: (typeof ledger)[number]) => {
    const type = transferType(row);
    return type === "Transfer" || type === "Borrow";
  };

  const openingKey = (itemId: string, projectId: string | null) =>
    `opening:${poolKey(itemId, projectId)}`;
  // Each layer a Transfer or Borrow opens pairs with the relief before it
  // of the same document and item: the one line that drew the stock.
  const pendingReliefs = new Map<string, string[]>();
  // Every layer runs again from its full quantity.
  const events: RecostEvent[] = [
    ...openingLayers
      .filter((layer) => methodByItem.has(layer.itemId))
      .map((layer) => ({
        layer: {
          id: openingKey(layer.itemId, layer.projectId),
          itemId: poolKey(layer.itemId, layer.projectId),
          quantity: layer.quantity,
          cost: layer.cost,
          remainingQuantity: layer.quantity,
          trackedEntityId: null,
          children: []
        }
      })),
    ...ledger.map((row): RecostEvent => {
      const itemId = row.itemId!;
      const pool = poolKey(itemId, row.projectId);
      const lineKey = `${row.documentId}:${itemId}`;
      if (Number(row.quantity) > 0) {
        const costOf = movesAtCost(row)
          ? pendingReliefs.get(lineKey)?.shift()
          : undefined;
        return {
          layer: {
            id: row.id,
            itemId: pool,
            quantity: Number(row.quantity),
            cost: Number(row.cost),
            remainingQuantity: Number(row.quantity),
            trackedEntityId: row.trackedEntityId,
            children: (childrenByLayer.get(row.id) ?? []).map((child) => ({
              id: child.id,
              quantity: Number(child.quantity),
              cost: Number(child.cost),
              remainingQuantity: Number(child.quantity)
            }))
          },
          ...(costOf ? { costOf } : {})
        };
      }
      if (movesAtCost(row)) {
        const pending = pendingReliefs.get(lineKey) ?? [];
        pending.push(row.id);
        pendingReliefs.set(lineKey, pending);
      }
      return {
        outbound: {
          costLedgerId: row.id,
          itemId: pool,
          quantity: -Number(row.quantity),
          cost: -Number(row.cost),
          trackedEntityIds: row.trackedEntityId
            ? [row.trackedEntityId]
            : (leavingByDocumentItem.get(lineKey) ?? []).map(
                (unit) => unit.trackedEntityId!
              )
        }
      };
    })
  ];
  // Every pool of a FIFO or LIFO item relieves by the item's method. A
  // quantity no layer covers costs at the item's unit cost, as calculateCOGS
  // costs negative inventory.
  const unitCostByItem = new Map(
    layeredCosts.map((row) => [row.itemId, Number(row.unitCost ?? 0)])
  );
  const poolItem = new Map<string, string>([
    ...openingLayers.map(
      (layer) => [poolKey(layer.itemId, layer.projectId), layer.itemId] as const
    ),
    ...ledger.map(
      (row) => [poolKey(row.itemId!, row.projectId), row.itemId!] as const
    )
  ]);
  const methodByPool = new Map<string, CostingMethod>();
  const unitCostByPool = new Map<string, number>();
  for (const [pool, itemId] of poolItem) {
    const method = methodByItem.get(itemId);
    if (method) methodByPool.set(pool, method);
    const unitCost = unitCostByItem.get(itemId);
    if (unitCost !== undefined) unitCostByPool.set(pool, unitCost);
  }
  const recost = recostOutbound(events, methodByPool, unitCostByPool);

  // The opening layers, with what the re-cost left of them.
  if (openingLayers.length > 0) {
    const timeZone = await getCompanyTimeZone(trx, companyId);
    const createdAt = sql<string>`(${cutoverDate}::date::timestamp AT TIME ZONE ${timeZone})`;
    await trx
      .insertInto("costLedger")
      .values(
        openingLayers.map((layer) => ({
          itemLedgerType: "Purchase" as const,
          costLedgerType: "Direct Cost" as const,
          documentType: "Purchase Receipt" as const,
          adjustment: false,
          itemId: layer.itemId,
          projectId: layer.projectId,
          quantity: layer.quantity,
          cost: layer.cost,
          nominalCost: layer.cost,
          remainingQuantity:
            recost.remainingById.get(
              openingKey(layer.itemId, layer.projectId)
            ) ?? layer.quantity,
          postingDate: cutoverDate,
          // Before any layer posted on the cutover day, so later relief
          // takes the opening stock first.
          createdAt,
          companyId
        }))
      )
      .execute();
  }

  // The layers and write-ups after the cutover, where the re-cost moved them.
  const stored = new Map<string, number>([
    ...ledger.map((row) => [row.id, Number(row.remainingQuantity)] as const),
    ...children.map(
      (child) => [child.id, Number(child.remainingQuantity)] as const
    )
  ]);
  await setCostLedger(
    trx,
    companyId,
    "remainingQuantity",
    [...recost.remainingById].filter(
      ([id, remaining]) => stored.has(id) && stored.get(id) !== remaining
    )
  );

  const ledgerById = new Map(ledger.map((row) => [row.id, row]));
  const changed = recost.movements.filter(
    (movement) =>
      Math.abs(movement.delta) > EPSILON &&
      ledgerById.get(movement.costLedgerId)!.costLedgerType !== "Revaluation"
  );
  const payback = changed.find(
    (movement) =>
      transferType(ledgerById.get(movement.costLedgerId)!) === "Payback"
  );
  if (payback) {
    throw new ServerFnError(
      `The cutover re-cost changed the cost of project stock payback ${
        ledgerById.get(payback.costLedgerId)!.documentId
      }. Pick a cutover date after the payback.`,
      409
    );
  }
  // The layers a Transfer or Borrow opened, at the re-costed cost of the
  // stock they drew.
  const movedLayers = [...recost.layerCostById].filter(
    ([id, cost]) => !equals(Number(ledgerById.get(id)?.cost ?? cost), cost)
  );
  await setCostLedger(trx, companyId, "cost", [
    ...changed.map((movement): [string, number] => [
      movement.costLedgerId,
      -movement.newCost
    ]),
    ...movedLayers
  ]);

  // One Provisional journal per document and posting date. A Transfer or
  // Borrow moves cost between two stripes of one inventory account, so it
  // has no journal to adjust.
  const journaled = changed.filter(
    (movement) => !movesAtCost(ledgerById.get(movement.costLedgerId)!)
  );
  if (journaled.length === 0) return;
  const posted = await postRecostJournals(trx, {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults,
    deltas: journaled.map((movement) => {
      const row = ledgerById.get(movement.costLedgerId)!;
      return {
        costLedgerId: row.id,
        itemId: row.itemId!,
        documentId: row.documentId,
        documentType: row.documentType,
        postingDate: String(row.postingDate),
        quantity: -Number(row.quantity),
        delta: movement.delta
      };
    })
  });
  await recostProjectIssues(trx, {
    companyId,
    userId,
    recosted: posted.filter(
      (entry) => entry.delta.documentType === "Project Issue"
    )
  });
}

/**
 * A re-costed Project Issue changes the project's cost too: one
 * `projectLedger` adjustment row per issue (quantity 0, the cost difference,
 * the issue's project, element and cost type, `journalLineId` the re-cost's
 * project account line), written through `insertProjectLedgerRows` so a
 * Time & Materials line bills it like any row, and for a Capitalize project
 * the matching `fixedAssetCipCost` row. The issue's cost rows and its ledger
 * row are written in one transaction, so they share `createdAt`: that and
 * the project, item and date find the ledger row of each cost row. A
 * Statistical issue has no ledger row and gets none.
 */
async function recostProjectIssues(
  trx: KyselyTx,
  {
    companyId,
    userId,
    recosted
  }: { companyId: string; userId: string; recosted: PostedRecost[] }
) {
  if (recosted.length === 0) return;
  const recostByCostLedger = new Map(
    recosted.map((entry) => [entry.delta.costLedgerId, entry])
  );
  const issues: (ProjectLedgerRow & { costLedgerId: string })[] = [];
  for (const ids of chunkArray(
    [...recostByCostLedger.keys()],
    ROWS_PER_STATEMENT
  )) {
    const { rows } = await sql<ProjectLedgerRow & { costLedgerId: string }>`
      SELECT c."id" AS "costLedgerId", pl.*
      FROM "costLedger" c
      JOIN "projectLedger" pl
        ON pl."companyId" = c."companyId"
       AND pl."documentType" = 'Project Issue'
       AND pl."reversalOfId" IS NULL
       AND pl."projectId" = c."documentId"
       AND pl."itemId" = c."itemId"
       AND pl."postingDate" = c."postingDate"
       AND pl."createdAt" = c."createdAt"
      WHERE c."companyId" = ${companyId}
        AND c."id" = ANY(${ids}::text[])
    `.execute(trx);
    issues.push(...rows);
  }
  if (issues.length === 0) return;

  // One adjustment per issue: an issue split across stock stripes has one
  // cost row per stripe and one ledger row.
  const byIssue = Map.groupBy(issues, (issue) => issue.id);
  const adjustments = [...byIssue.values()].flatMap((rows) => {
    const issue = rows[0]!;
    const entries = rows.map(
      (row) => recostByCostLedger.get(row.costLedgerId)!
    );
    const amount = round(
      entries.reduce((sum, entry) => sum + entry.delta.delta, 0)
    );
    if (Math.abs(amount) <= EPSILON) return [];
    return [{ issue, amount, recost: entries[0]! }];
  });
  if (adjustments.length === 0) return;

  await insertProjectLedgerRows(trx, {
    companyId,
    userId,
    rows: adjustments.map(({ issue, amount, recost }) =>
      buildProjectLedgerRow({
        companyId,
        projectId: issue.projectId,
        projectElementId: issue.projectElementId,
        postingDate: String(issue.postingDate),
        costType: issue.costType,
        documentType: issue.documentType,
        documentId: issue.documentId,
        documentLineId: issue.documentLineId,
        itemId: issue.itemId,
        quantity: 0,
        unitOfMeasureCode: issue.unitOfMeasureCode,
        amount,
        journalLineId: recost.offsetJournalLineId,
        coverage: issue.coverage,
        coverageReason: issue.coverageReason,
        unallowable: issue.unallowable,
        createdBy: userId
      })
    )
  });

  // A Capitalize project's issue raised its asset's cost: the difference
  // goes on the same asset.
  const cipRows = await readByIds(
    adjustments.map(({ issue }) => issue.documentId),
    (ids) =>
      trx
        .selectFrom("fixedAssetCipCost")
        .select(["sourceDocumentId", "fixedAssetId", "postCapitalization"])
        .where("companyId", "=", companyId)
        .where("sourceType", "=", "Project Issue")
        .where("projectId", "is not", null)
        .where("sourceDocumentId", "in", ids)
        .execute()
  );
  const cipByIssue = new Map(cipRows.map((row) => [row.sourceDocumentId, row]));
  await writeProjectCipRows(trx, {
    companyId,
    userId,
    rows: adjustments.map(({ issue, amount, recost }) => {
      const cip = cipByIssue.get(issue.documentId);
      if (!cip) return null;
      return buildProjectCipRow({
        resolved: {
          fixedAssetId: cip.fixedAssetId,
          postCapitalization: cip.postCapitalization
        },
        companyId,
        userId,
        projectId: issue.projectId,
        projectElementId: issue.projectElementId,
        sourceType: "Project Issue",
        sourceDocumentId: issue.documentId,
        amount,
        costDate: String(issue.postingDate),
        journalId: recost.journalId
      });
    })
  });
}

type RecostDelta = {
  costLedgerId: string;
  itemId: string;
  documentId: string | null;
  documentType: string | null;
  postingDate: string;
  quantity: number;
  delta: number;
};

/** A re-costed movement and the journal line its difference posted to on
 *  the account its document charged (the inventory line's pair). */
type PostedRecost = {
  delta: RecostDelta;
  journalId: string;
  offsetJournalLineId: string;
};

/**
 * Books each re-costed movement's difference between the two accounts its
 * document's own Provisional journal used: the item's inventory line and the
 * line paired with it by `journalLineReference`. Inventory is credited by a
 * positive delta and the paired line moves the other way, signed as the
 * original pair is; the lines copy the original's document keys, so a reader
 * of the document's chain (close-job's WIP sum, a void) sees the new cost. A
 * pair posted at zero (a movement costed at nothing) carries no sign, so the
 * offset takes the debit sign of its own account's class: every re-costed
 * movement is outbound, so its inventory line is a credit and the offset a
 * debit. Refuses rather than guess an account.
 */
async function postRecostJournals(
  trx: KyselyTx,
  {
    companyId,
    companyGroupId,
    userId,
    cutoverDate,
    defaults,
    deltas
  }: {
    companyId: string;
    companyGroupId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
    deltas: RecostDelta[];
  }
): Promise<PostedRecost[]> {
  const label = (delta: RecostDelta) =>
    `${delta.documentType ?? "document"} ${delta.documentId ?? "(none)"}`;
  const missingDocument = deltas.find((delta) => !delta.documentId);
  if (missingDocument) {
    throw new ServerFnError(
      `The cutover re-cost changed a movement of item ${missingDocument.itemId} that names no document, so its journal cannot be adjusted.`,
      409
    );
  }
  const documentIds = [...new Set(deltas.map((delta) => delta.documentId!))];

  const [items, lines] = await inOrder([
    () =>
      readByIds(
        deltas.map((delta) => delta.itemId),
        (ids) =>
          trx
            .selectFrom("item")
            .select(["id", "replenishmentSystem"])
            .where("companyId", "=", companyId)
            .where("id", "in", ids)
            .execute()
      ),
    () =>
      readByIds(documentIds, (ids) =>
        trx
          .selectFrom("journalLine as line")
          .innerJoin("journal", (join) =>
            join
              .onRef("journal.id", "=", "line.journalId")
              .onRef("journal.companyId", "=", "line.companyId")
          )
          .select([
            "line.id",
            "line.journalId",
            "line.journalLineReference",
            "line.accountId",
            "line.accountDefaultRole",
            "line.amount",
            "line.quantity",
            "line.documentId",
            "line.documentType",
            "line.documentLineReference",
            "journal.postingDate",
            "journal.sourceType"
          ])
          .where("line.companyId", "=", companyId)
          .where("line.documentId", "in", ids)
          .where("journal.status", "=", "Provisional")
          .where("journal.postingDate", ">=", cutoverDate)
          .execute()
      )
  ]);
  type Line = (typeof lines)[number];
  const replenishmentByItem = new Map(
    items.map((item) => [item.id, item.replenishmentSystem])
  );
  const linesByPair = Map.groupBy(
    lines,
    (line) => `${line.journalId}:${line.journalLineReference}`
  );
  // A document's credit lines on an account, on one posting date.
  const creditsByDocument = Map.groupBy(
    lines.filter((line) => Number(line.amount) <= EPSILON),
    (line) => `${line.documentId}:${String(line.postingDate)}:${line.accountId}`
  );

  type Pair = { inventory: Line; offset: Line };
  const resolved = deltas.map((delta) => {
    const inventoryAccountId = resolveInventoryAccount(
      replenishmentByItem.get(delta.itemId) ?? null,
      defaults
    ).account;
    const pairs: Pair[] = (
      creditsByDocument.get(
        `${delta.documentId}:${delta.postingDate}:${inventoryAccountId}`
      ) ?? []
    ).flatMap((inventory) => {
      const others = (
        linesByPair.get(
          `${inventory.journalId}:${inventory.journalLineReference}`
        ) ?? []
      ).filter((line) => line.id !== inventory.id);
      return others.length === 1 ? [{ inventory, offset: others[0]! }] : [];
    });
    const offsetKey = (pair: Pair) =>
      `${pair.offset.accountId}:${pair.offset.accountDefaultRole ?? ""}`;
    let candidates = pairs;
    if (new Set(candidates.map(offsetKey)).size > 1) {
      candidates = pairs.filter((pair) =>
        equals(Number(pair.inventory.quantity), delta.quantity)
      );
    }
    if (candidates.length === 0) {
      throw new ServerFnError(
        `The cutover re-cost could not find the inventory line of ${label(delta)} and the line paired with it, so it cannot adjust that journal.`,
        409
      );
    }
    if (new Set(candidates.map(offsetKey)).size > 1) {
      throw new ServerFnError(
        `The inventory lines of ${label(delta)} pair with more than one account, so the cutover re-cost cannot tell which to adjust.`,
        409
      );
    }
    return { delta, pair: candidates[0]! };
  });

  // The class of each offset in a pair posted at zero, which signs it. A
  // stand-in line is signed for the default it stands in for, which no
  // account class records, so it keeps the refusal below.
  const zeroOffsetIds = resolved.flatMap(({ pair }) =>
    Number(pair.inventory.amount) === 0 &&
    Number(pair.offset.amount) === 0 &&
    !pair.offset.accountDefaultRole &&
    pair.offset.accountId
      ? [pair.offset.accountId]
      : []
  );
  const classByAccount = new Map(
    (
      await readByIds(zeroOffsetIds, (ids) =>
        trx
          .selectFrom("account")
          .select(["id", "class"])
          .where("companyGroupId", "=", companyGroupId)
          .where("id", "in", ids)
          .execute()
      )
    ).map((account) => [account.id, account.class])
  );
  const signRelation = (pair: Pair): number => {
    const relation =
      Math.sign(Number(pair.inventory.amount)) *
      Math.sign(Number(pair.offset.amount));
    if (relation !== 0) return relation;
    if (pair.offset.accountDefaultRole) return 0;
    const offsetClass = classByAccount.get(pair.offset.accountId ?? "");
    if (!offsetClass) return 0;
    return (
      Math.sign(credit("asset", 1)) *
      Math.sign(debit(accountTypeFromClass(offsetClass), 1))
    );
  };

  // One journal per document and posting date, numbered in one statement.
  const groups = [
    ...Map.groupBy(
      resolved,
      (entry) => `${entry.delta.documentId}:${entry.delta.postingDate}`
    ).values()
  ];
  const entryIds = await getNextSequences(
    trx,
    "journalEntry",
    companyId,
    groups.length
  );
  const postedAt = datetime.timestamp();
  const journals = await trx
    .insertInto("journal")
    .values(
      groups.map((entries, index) => ({
        journalEntryId: entryIds[index]!,
        description: RECOST_DESCRIPTION,
        postingDate: entries[0]!.delta.postingDate,
        sourceType: entries[0]!.pair.inventory.sourceType,
        status: "Provisional" as const,
        accountingPeriodId: null,
        postedAt,
        postedBy: userId,
        companyId,
        createdBy: userId
      }))
    )
    .returning(["id", "journalEntryId"])
    .execute();
  const journalIdByEntry = new Map(
    journals.map((journal) => [journal.journalEntryId, journal.id])
  );

  // Each movement's pair of lines shares one reference; the offset is the
  // line on its pair's offset account.
  const offsetByReference = new Map<
    string,
    { delta: RecostDelta; journalId: string; accountId: string | null }
  >();
  const lineInserts: JournalLineInsert[] = groups.flatMap((entries, index) => {
    const journalId = journalIdByEntry.get(entryIds[index]!)!;
    return entries.flatMap(({ delta, pair }) => {
      // The offset mirrors the original pair's sign relation rather than
      // re-deriving it from the offset's account class: a stand-in line sits
      // on retained earnings but is signed for the account it stands in for.
      const relation = signRelation(pair);
      if (relation === 0) {
        throw new ServerFnError(
          `The inventory line of ${label(delta)} or the line paired with it has no amount, so the cutover re-cost cannot sign its adjustment.`,
          409
        );
      }
      const inventoryAmount = round(credit("asset", delta.delta));
      const journalLineReference = nanoid();
      offsetByReference.set(journalLineReference, {
        delta,
        journalId,
        accountId: pair.offset.accountId
      });
      const keys = (line: Line) => ({
        documentType: line.documentType,
        documentId: line.documentId,
        documentLineReference: line.documentLineReference
      });
      return [
        {
          journalId,
          accountId: pair.inventory.accountId,
          description: RECOST_DESCRIPTION,
          amount: inventoryAmount,
          quantity: 0,
          ...keys(pair.inventory),
          journalLineReference,
          companyId,
          createdBy: userId
        },
        {
          journalId,
          accountId: pair.offset.accountId,
          accountDefaultRole: pair.offset.accountDefaultRole,
          description: RECOST_DESCRIPTION,
          amount: round(inventoryAmount * relation),
          quantity: 0,
          ...keys(pair.offset),
          journalLineReference,
          companyId,
          createdBy: userId
        }
      ];
    });
  });
  const posted: PostedRecost[] = [];
  for (const rows of chunkArray(lineInserts, ROWS_PER_STATEMENT)) {
    const inserted = await trx
      .insertInto("journalLine")
      .values(rows)
      .returning(["id", "journalLineReference", "accountId"])
      .execute();
    for (const line of inserted) {
      const offset = offsetByReference.get(line.journalLineReference);
      if (offset && line.accountId === offset.accountId) {
        posted.push({
          delta: offset.delta,
          journalId: offset.journalId,
          offsetJournalLineId: line.id
        });
      }
    }
  }
  return posted;
}
