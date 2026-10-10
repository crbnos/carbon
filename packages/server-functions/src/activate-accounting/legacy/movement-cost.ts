// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The cost rows of legacy movements that stored none, and the journals of
// the job movements (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 5a,
// "Movement with no cost row"). With accounting off, a sales order shipment
// and a job material issue never costed their movement, a direct sales
// invoice line relieved its layers but wrote no row, and a job completion
// wrote no output layer. This step writes the missing rows, then:
//
// - a sale row ("Sale", "Direct Cost", "Sales Shipment", the shipment's or
//   the invoice's id, as post-shipment and post-sales-invoice write it) gets
//   its COGS pair from the builder that already reads that row: the shipment
//   journal (shipment.ts) or the direct line of the invoice journal
//   (sales-invoice.ts). So this step runs before them;
// - a job issue or return (`issue`'s backflush, manual and tracked issue; the
//   SQL `backflush_job_materials`): one "Consumption", "Direct Cost", "Job
//   Consumption" row per ledger row, and a WIP/inventory pair on
//   `material-issue:<operationId>`, or `job:<jobId>` when the ledger row
//   names no operation (the SQL backflush). A return books inventory against
//   WIP. One journal per job and posting date;
// - a job completion (`complete_job_to_inventory`): one "Output", "Direct
//   Cost", "Job Receipt" layer, and an inventory/WIP pair on `job:<jobId>`,
//   "Job Completion <job>". One journal per completion.
//
// An outbound row of a FIFO or LIFO item relieves the layers open now, as
// `calculateCOGS` does (`replayReliefs`, one read of the layers for every
// movement); a Standard item costs at its standard cost and an Average one at
// `itemCost.unitCost`, as `calculateCOGS` costs them. The enable then re-costs
// the FIFO and LIFO rows against the reset layers; a repair after it keeps
// what the open layers gave. A return costs at today's unit cost. Every pair
// is written, at zero too, so each movement the detection finds gets its
// journal and the re-cost finds the pair to adjust. A completion takes the
// material cost its job issued on or after the cutover up to that
// completion, as the posting takes the job's whole WIP balance. Labor and
// machine absorption are not rebuilt (no stored rate), and the re-cost moves
// the material cost without re-valuing the output layer.
//
// A job issue or completion that stored its cost row (the company had
// accounting on) but lost its journal in the reset gets the journal at the
// stored cost, keyed on the day: a job and date with a journal line under the
// document type is left alone.

import type { Database } from "@carbon/database";
import { journalReference } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  type CostingMethod,
  isCostLayer,
  type ReliefEvent,
  replayReliefs
} from "@carbon/database/cost-relief";
import {
  legacyJobMovements,
  legacySaleMovements
} from "@carbon/database/legacy-documents";
import { chunkArray, credit, debit, EPSILON, round } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError } from "../../errors";
import { resolveInventoryAccount } from "../../lib/get-posting-group";
import {
  type LegacyJournal,
  type LegacyJournalLine,
  ROWS_PER_STATEMENT,
  readByIds,
  readItems,
  readPostingGroups
} from "./write";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type CostLedgerInsert = Database["public"]["Tables"]["costLedger"]["Insert"];

export type LegacyMovementCosts = {
  /** Cost rows written: sales, job issues and returns, job output layers. */
  costRows: number;
  jobConsumptions: LegacyJournal[];
  jobOutputs: LegacyJournal[];
};

/** A job movement: one issue or return ledger row, or one completion. */
export type JobMovement = {
  /** The ledger row of an issue or return; the rows of a completion. */
  key: string;
  kind: "Consumption" | "Output";
  jobId: string;
  itemId: string;
  /** Signed, as the ledger stores it. */
  quantity: number;
  postingDate: string;
  /** A fixed-width UTC instant (`utcInstant`), so it sorts as text. */
  createdAt: string;
  documentLineId: string | null;
  locationId: string | null;
  /** The serial unit an issue relieves first. */
  trackedEntityIds: string[];
};

/** A cost row a posting stored for a job movement. Signed. */
export type StoredJobCost = {
  kind: JobMovement["kind"];
  jobId: string;
  itemId: string;
  quantity: number;
  cost: number;
};

/** A movement, and the part of it stored cost rows cover. */
export type CoveredJobMovement = {
  movement: JobMovement;
  coveredQuantity: number;
  coveredCost: number;
  /** The quantity no stored row covers, unsigned. A new row books it. */
  missingQuantity: number;
};

export type PlannedJobMovement = CoveredJobMovement & {
  /** The new row's cost, unsigned. */
  missingCost: number;
  /** The pair to write, unsigned; null when the day kept its journal. */
  journal: { quantity: number; cost: number } | null;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const instantOf = (movement: { postingDate: string; createdAt: string }) =>
  `${movement.postingDate}|${movement.createdAt}`;

/**
 * Splits each movement into what the stored cost rows cover and what is
 * missing, in the order the postings ran: by time, and at one instant the
 * issues before the completions (the posting backflushes the material, then
 * receives the output, in one transaction). Stored rows cover the earliest
 * movements of a job, item and direction.
 */
export function coverJobMovements({
  movements,
  stored
}: {
  movements: JobMovement[];
  stored: StoredJobCost[];
}): CoveredJobMovement[] {
  const coverKey = (row: {
    kind: string;
    jobId: string;
    itemId: string;
    quantity: number;
  }) => `${row.kind}:${row.jobId}:${row.itemId}:${row.quantity < 0}`;
  const budgets = new Map<string, { quantity: number; unitCost: number }[]>();
  for (const row of stored) {
    const quantity = Math.abs(row.quantity);
    if (quantity <= EPSILON) continue;
    const list = budgets.get(coverKey(row)) ?? [];
    list.push({ quantity, unitCost: Math.abs(row.cost) / quantity });
    budgets.set(coverKey(row), list);
  }
  const ordered = [...movements].sort(
    (a, b) =>
      byText(instantOf(a), instantOf(b)) ||
      (a.kind === b.kind ? 0 : a.kind === "Consumption" ? -1 : 1)
  );
  return ordered.map((movement) => {
    let wanted = Math.abs(movement.quantity);
    let coveredQuantity = 0;
    let coveredCost = 0;
    for (const budget of budgets.get(coverKey(movement)) ?? []) {
      if (wanted <= EPSILON) break;
      const take = Math.min(wanted, budget.quantity);
      if (take <= 0) continue;
      budget.quantity -= take;
      wanted -= take;
      coveredQuantity += take;
      coveredCost += take * budget.unitCost;
    }
    return {
      movement,
      coveredQuantity,
      coveredCost: round(coveredCost),
      missingQuantity: wanted > EPSILON ? round(wanted) : 0
    };
  });
}

/**
 * Plans the cost rows and journal pairs of the covered job movements, in
 * their order. An issue's or return's missing quantity costs what
 * `missingCostByKey` gives it; a completion takes the job's material cost
 * not yet received. `journaledDays` holds `<kind>:<jobId>:<postingDate>` for
 * a job and date that kept its journal: only what is missing there gets a
 * pair. Every other movement gets its pair, at zero too.
 */
export function planLegacyJobCosts({
  covered,
  journaledDays,
  missingCostByKey
}: {
  covered: CoveredJobMovement[];
  journaledDays: ReadonlySet<string>;
  missingCostByKey: ReadonlyMap<string, number>;
}): PlannedJobMovement[] {
  // The material cost each job has in WIP and no completion has taken.
  const wipByJob = new Map<string, number>();
  return covered.map((cover) => {
    const { movement, coveredQuantity, coveredCost, missingQuantity } = cover;
    const journaled = journaledDays.has(
      `${movement.kind}:${movement.jobId}:${movement.postingDate}`
    );
    const wip = wipByJob.get(movement.jobId) ?? 0;
    if (movement.kind === "Consumption") {
      const missingCost =
        missingQuantity > 0 ? missingCostByKey.get(movement.key) : 0;
      if (missingCost === undefined) {
        throw new Error(
          `The missing cost of job movement ${movement.key} was not computed`
        );
      }
      const value = coveredCost + missingCost;
      wipByJob.set(
        movement.jobId,
        movement.quantity < 0 ? wip + value : wip - value
      );
      const quantity = journaled
        ? missingQuantity
        : coveredQuantity + missingQuantity;
      return {
        ...cover,
        missingCost,
        journal:
          quantity > EPSILON
            ? {
                quantity: round(quantity),
                cost: journaled ? missingCost : value
              }
            : null
      };
    }
    const afterCovered = wip - coveredCost;
    const missingCost =
      missingQuantity > 0 ? round(Math.max(afterCovered, 0)) : 0;
    wipByJob.set(movement.jobId, afterCovered - missingCost);
    return {
      ...cover,
      missingCost,
      journal:
        !journaled || missingQuantity > 0
          ? {
              quantity: round(
                journaled ? missingQuantity : Math.abs(movement.quantity)
              ),
              cost: (journaled ? 0 : coveredCost) + missingCost
            }
          : null
    };
  });
}

/**
 * Writes the missing cost rows and returns the journals of the job
 * movements. Runs before the invoice and shipment builders read the sale
 * rows, and before the inventory reset.
 */
export async function writeLegacyMovementCosts(
  trx: KyselyTx,
  {
    companyId,
    cutoverDate,
    defaults
  }: { companyId: string; cutoverDate: string; defaults: AccountDefaults }
): Promise<LegacyMovementCosts> {
  const args = { companyId, cutoverDate };
  const sales = await legacySaleMovements(trx, args).execute();
  const ledgerRows = await legacyJobMovements(trx, args).execute();
  if (sales.length === 0 && ledgerRows.length === 0) {
    return {
      costRows: 0,
      jobConsumptions: [],
      jobOutputs: []
    };
  }

  const jobs = await readByIds(
    ledgerRows.map((row) => row.documentId),
    (ids) =>
      trx
        .selectFrom("job")
        .select(["id", "jobId", "locationId"])
        .where("companyId", "=", companyId)
        .where("id", "in", ids)
        .execute()
  );
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const storedRows = await readByIds(jobById.keys(), (ids) =>
    trx
      .selectFrom("costLedger")
      .select(["itemLedgerType", "documentId", "itemId", "quantity", "cost"])
      .where("companyId", "=", companyId)
      .where("documentId", "in", ids)
      .where("postingDate", ">=", cutoverDate)
      .where("adjustment", "=", false)
      .where("appliesToCostLedgerId", "is", null)
      .where((eb) =>
        eb.or([
          eb.and([
            eb("documentType", "=", "Job Consumption"),
            eb("itemLedgerType", "=", "Consumption")
          ]),
          eb.and([
            eb("documentType", "=", "Job Receipt"),
            eb("itemLedgerType", "=", "Output")
          ])
        ])
      )
      .orderBy("postingDate")
      .orderBy("entryNumber")
      .execute()
  );

  const itemIds = [
    ...sales.map((row) => row.itemId),
    ...ledgerRows.map((row) => row.itemId)
  ];
  const itemById = await readItems(trx, companyId, itemIds);
  const postingGroupByItem = await readPostingGroups(trx, companyId, itemIds);
  const itemCosts = await readByIds(itemIds, (ids) =>
    trx
      .selectFrom("itemCost")
      .select(["itemId", "costingMethod", "standardCost", "unitCost"])
      .where("companyId", "=", companyId)
      .where("itemId", "in", ids)
      .execute()
  );
  const itemCostById = new Map(itemCosts.map((row) => [row.itemId, row]));
  const itemCostOf = (itemId: string) => {
    const itemCost = itemCostById.get(itemId);
    if (!itemCost) {
      throw new InvalidInputError(
        `Item ${itemById.get(itemId)?.readableIdWithRevision ?? itemId} has no cost record, so its movements after the cutover cannot be costed.`
      );
    }
    return itemCost;
  };
  // Today's unit cost, as calculateCOGS reads it for a Standard or Average
  // item.
  const unitCostOf = (itemId: string) => {
    const itemCost = itemCostOf(itemId);
    return Number(
      (itemCost.costingMethod === "Standard"
        ? itemCost.standardCost
        : itemCost.unitCost) ?? 0
    );
  };
  const layeredMethod = (itemId: string): CostingMethod | null => {
    const method = itemCostOf(itemId).costingMethod;
    return method === "FIFO" || method === "LIFO" ? method : null;
  };

  // One movement per issue or return ledger row, and one per completion: the
  // rows of one completion (a unit each, when serialized) share an instant.
  const consumptionRows = ledgerRows.filter(
    (row) => row.entryType === "Consumption" && jobById.has(row.documentId!)
  );
  const outputRows = ledgerRows.filter(
    (row) => row.entryType === "Assembly Output" && jobById.has(row.documentId!)
  );
  const movements: JobMovement[] = [
    ...consumptionRows.map((row) => ({
      key: row.id,
      kind: "Consumption" as const,
      jobId: row.documentId!,
      itemId: row.itemId,
      quantity: Number(row.quantity),
      postingDate: row.postingDate,
      createdAt: row.createdAt,
      documentLineId: row.documentLineId,
      locationId: row.locationId,
      trackedEntityIds: row.trackedEntityId ? [row.trackedEntityId] : []
    })),
    ...[
      ...Map.groupBy(
        outputRows,
        (row) =>
          `${row.documentId}:${row.itemId}:${row.postingDate}:${row.createdAt}`
      )
    ].map(([key, group]) => ({
      key,
      kind: "Output" as const,
      jobId: group[0]!.documentId!,
      itemId: group[0]!.itemId,
      quantity: group.reduce((sum, row) => sum + Number(row.quantity), 0),
      postingDate: group[0]!.postingDate,
      createdAt: group[0]!.createdAt,
      documentLineId: null,
      locationId: group[0]!.locationId,
      trackedEntityIds: []
    }))
  ];
  const covered = coverJobMovements({
    movements,
    stored: storedRows.map((row) => ({
      kind:
        row.itemLedgerType === "Output"
          ? ("Output" as const)
          : ("Consumption" as const),
      jobId: String(row.documentId),
      itemId: String(row.itemId),
      quantity: Number(row.quantity),
      cost: Number(row.cost)
    }))
  });

  // The outbound quantities with no cost row, in movement order: the sales,
  // and the missing quantity of each issue.
  const saleKey = (row: (typeof sales)[number]) =>
    `sale:${row.documentId}:${row.itemId}`;
  const saleQuantity = (row: (typeof sales)[number]) =>
    round(Number(row.quantity) - Number(row.covered));
  const outbound = [
    ...sales.map((row) => ({
      order: instantOf(row),
      key: saleKey(row),
      itemId: row.itemId,
      quantity: saleQuantity(row),
      trackedEntityIds: row.trackedEntityIds
    })),
    ...covered
      .filter(
        ({ movement, missingQuantity }) =>
          movement.kind === "Consumption" &&
          movement.quantity < 0 &&
          missingQuantity > 0
      )
      .map(({ movement, missingQuantity }) => ({
        order: instantOf(movement),
        key: movement.key,
        itemId: movement.itemId,
        quantity: missingQuantity,
        trackedEntityIds: movement.trackedEntityIds
      }))
  ].sort((a, b) => byText(a.order, b.order));
  const relievedCostByKey = await relieveOpenLayers(trx, {
    companyId,
    reliefs: outbound.filter((relief) => layeredMethod(relief.itemId)),
    methodByItem: new Map(
      outbound.flatMap((relief) => {
        const method = layeredMethod(relief.itemId);
        return method ? [[relief.itemId, method] as const] : [];
      })
    ),
    // calculateCOGS costs a quantity no layer covers at the unit cost.
    fallbackUnitCostByItem: new Map(
      outbound.map((relief) => [
        relief.itemId,
        Number(itemCostOf(relief.itemId).unitCost ?? 0)
      ])
    )
  });
  const outboundCost = (relief: (typeof outbound)[number]) =>
    relievedCostByKey.get(relief.key) ??
    round(relief.quantity * unitCostOf(relief.itemId));
  const costByKey = new Map(
    outbound.map((relief) => [relief.key, outboundCost(relief)])
  );
  // A return costs at today's unit cost.
  for (const { movement, missingQuantity } of covered) {
    if (movement.kind === "Consumption" && movement.quantity > 0) {
      costByKey.set(
        movement.key,
        round(missingQuantity * unitCostOf(movement.itemId))
      );
    }
  }
  const planned = planLegacyJobCosts({
    covered,
    journaledDays: new Set(
      ledgerRows
        .filter((row) => row.journaled)
        .map(
          (row) =>
            `${row.entryType === "Consumption" ? "Consumption" : "Output"}:${row.documentId}:${row.postingDate}`
        )
    ),
    missingCostByKey: costByKey
  });

  // The rows, in the order of their movements, so the re-cost relieves
  // the layers in that order.
  const inserts: (CostLedgerInsert & { order: string })[] = [
    ...sales.map((row) => {
      const cost = costByKey.get(saleKey(row))!;
      return {
        order: instantOf(row),
        itemLedgerType: "Sale" as const,
        costLedgerType: "Direct Cost" as const,
        adjustment: false,
        documentType: "Sales Shipment" as const,
        documentId: row.documentId,
        itemId: row.itemId,
        quantity: -saleQuantity(row),
        cost: -cost,
        remainingQuantity: 0,
        postingDate: row.postingDate,
        createdAt: row.createdAt,
        companyId
      };
    }),
    ...planned
      .filter((plan) => plan.missingQuantity > 0)
      .map(({ movement, missingQuantity, missingCost }) => {
        const sign = movement.quantity < 0 ? -1 : 1;
        const isOutput = movement.kind === "Output";
        return {
          order: instantOf(movement),
          itemLedgerType: movement.kind,
          costLedgerType: "Direct Cost" as const,
          adjustment: false,
          documentType: isOutput
            ? ("Job Receipt" as const)
            : ("Job Consumption" as const),
          documentId: movement.jobId,
          itemId: movement.itemId,
          quantity: sign * missingQuantity,
          cost: sign * missingCost,
          // An output is a layer; an issue or return relieves or holds none.
          remainingQuantity: isOutput ? missingQuantity : 0,
          postingDate: movement.postingDate,
          createdAt: movement.createdAt,
          companyId
        };
      })
  ].sort((a, b) => byText(a.order, b.order));
  for (const rows of chunkArray(inserts, ROWS_PER_STATEMENT)) {
    await trx
      .insertInto("costLedger")
      .values(rows.map(({ order: _order, ...row }) => row))
      .execute();
  }

  // The journals of the job movements.
  const dimensions = (movement: JobMovement) => ({
    Item: movement.itemId,
    ItemPostingGroup: postingGroupByItem.get(movement.itemId) ?? null,
    Location:
      movement.locationId ?? jobById.get(movement.jobId)?.locationId ?? null
  });
  const inventoryOf = (itemId: string) =>
    resolveInventoryAccount(
      itemById.get(itemId)?.replenishmentSystem ?? null,
      defaults
    );
  const jobNumber = (jobId: string) => jobById.get(jobId)!.jobId;
  const withPair = planned.flatMap((plan) =>
    plan.journal ? [{ ...plan, journal: plan.journal }] : []
  );

  const jobConsumptions = [
    ...Map.groupBy(
      withPair.filter((plan) => plan.movement.kind === "Consumption"),
      (plan) => `${plan.movement.jobId}:${plan.movement.postingDate}`
    ).values()
  ].map((group): LegacyJournal => {
    const { jobId, postingDate } = group[0]!.movement;
    const lines = group.flatMap(
      ({ movement, journal }): LegacyJournalLine[] => {
        const inventory = inventoryOf(movement.itemId);
        const keys = {
          quantity: journal.quantity,
          documentType: "Job Consumption" as const,
          documentId: jobId,
          documentLineReference: movement.documentLineId
            ? journalReference.to.materialIssue(movement.documentLineId)
            : journalReference.to.job(jobId),
          journalLineReference: nanoid(),
          dimensions: dimensions(movement)
        };
        const wip = {
          ...keys,
          accountId: defaults.workInProgressAccount,
          description: "WIP Account"
        };
        const stock = {
          ...keys,
          accountId: inventory.account,
          description: inventory.description
        };
        return movement.quantity < 0
          ? [
              { ...wip, amount: round(debit("asset", journal.cost)) },
              { ...stock, amount: round(credit("asset", journal.cost)) }
            ]
          : [
              { ...stock, amount: round(debit("asset", journal.cost)) },
              { ...wip, amount: round(credit("asset", journal.cost)) }
            ];
      }
    );
    return {
      description: `Material Issue to Job ${jobNumber(jobId)}`,
      postingDate,
      sourceType: "Job Consumption",
      lines
    };
  });

  const jobOutputs = withPair
    .filter((plan) => plan.movement.kind === "Output")
    .map(({ movement, journal, coveredQuantity }): LegacyJournal => {
      const inventory = inventoryOf(movement.itemId);
      const keys = {
        quantity: journal.quantity,
        documentType: "Job Receipt" as const,
        documentId: movement.jobId,
        documentLineReference: journalReference.to.job(movement.jobId),
        journalLineReference: nanoid(),
        dimensions: dimensions(movement)
      };
      return {
        description: `Job Completion ${jobNumber(movement.jobId)}`,
        postingDate: movement.postingDate,
        sourceType: "Job Receipt",
        lines: [
          {
            ...keys,
            accountId: inventory.account,
            description: inventory.description,
            amount: round(debit("asset", journal.cost))
          },
          {
            ...keys,
            accountId: defaults.workInProgressAccount,
            description: "WIP Account",
            amount: round(credit("asset", journal.cost))
          }
        ]
      };
    });

  return {
    costRows: inserts.length,
    jobConsumptions,
    jobOutputs
  };
}

/**
 * Relieves the open layers of FIFO and LIFO items for the reliefs, in order,
 * as successive `calculateCOGS` calls would: reads the layers and their open
 * children once, locked as `calculateCOGS` locks them, replays the reliefs
 * (`replayReliefs`) and writes the remaining quantities that changed. A layer
 * this step writes (a job's output) is not open to a relief in the same
 * step; its quantity costs at the fallback, as negative stock does. Returns
 * each relief's cost by key.
 */
async function relieveOpenLayers(
  trx: KyselyTx,
  {
    companyId,
    reliefs,
    methodByItem,
    fallbackUnitCostByItem
  }: {
    companyId: string;
    reliefs: {
      key: string;
      itemId: string;
      quantity: number;
      trackedEntityIds: readonly string[];
    }[];
    methodByItem: ReadonlyMap<string, CostingMethod>;
    fallbackUnitCostByItem: ReadonlyMap<string, number>;
  }
): Promise<Map<string, number>> {
  if (reliefs.length === 0) return new Map();
  const layers = await readByIds(
    reliefs.map((relief) => relief.itemId),
    (ids) =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "itemId",
          "quantity",
          "cost",
          "remainingQuantity",
          "trackedEntityId"
        ])
        .where("companyId", "=", companyId)
        .where("itemId", "in", ids)
        .where("remainingQuantity", ">", 0)
        .where(isCostLayer)
        .orderBy("itemId")
        .orderBy("postingDate")
        .orderBy("createdAt")
        .forUpdate()
        .execute()
  );
  const children = await readByIds(
    layers.map((layer) => layer.id),
    (ids) =>
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
        .where("appliesToCostLedgerId", "in", ids)
        .where("remainingQuantity", ">", 0)
        .orderBy("createdAt")
        .forUpdate()
        .execute()
  );
  const childrenByLayer = Map.groupBy(
    children,
    (child) => child.appliesToCostLedgerId
  );
  const loaded = new Map<string, number>();
  const events: ReliefEvent[] = [
    ...layers.map((layer): ReliefEvent => {
      loaded.set(layer.id, Number(layer.remainingQuantity));
      return {
        kind: "layer",
        itemId: layer.itemId!,
        layer: {
          id: layer.id,
          quantity: Number(layer.quantity),
          cost: Number(layer.cost),
          remainingQuantity: Number(layer.remainingQuantity),
          trackedEntityId: layer.trackedEntityId,
          children: (childrenByLayer.get(layer.id) ?? []).map((child) => {
            loaded.set(child.id, Number(child.remainingQuantity));
            return {
              id: child.id,
              quantity: Number(child.quantity),
              cost: Number(child.cost),
              remainingQuantity: Number(child.remainingQuantity)
            };
          })
        }
      };
    }),
    ...reliefs.map((relief): ReliefEvent => ({ kind: "relief", ...relief }))
  ];
  const { costByKey, remainingById } = replayReliefs({
    events,
    methodByItem,
    fallbackUnitCostByItem
  });
  const changed = [...remainingById].filter(
    ([id, remaining]) => loaded.get(id) !== remaining
  );
  for (const rows of chunkArray(changed, ROWS_PER_STATEMENT)) {
    await sql`
      UPDATE "costLedger" AS c
      SET "remainingQuantity" = v."remaining"
      FROM (VALUES ${sql.join(
        rows.map(([id, remaining]) => sql`(${id}, ${remaining}::numeric)`)
      )}) AS v("id", "remaining")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }
  return costByKey;
}
