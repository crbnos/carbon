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
// - a sale row (post-shipment ~1216-1300; post-sales-invoice ~1861-1915:
//   "Sale", "Direct Cost", "Sales Shipment", the shipment's or the invoice's
//   id) gets its COGS pair from the builder that already reads that row: the
//   shipment journal (shipment.ts) or the direct line of the invoice journal
//   (sales-invoice.ts). So this step runs before them;
// - a job issue or return (issue/index.ts ~440-505 backflush, ~690-795
//   manual and tracked issue; backflush_job_materials, migration
//   20261009010412 ~100-440): one "Consumption", "Direct Cost", "Job
//   Consumption" row per ledger row, and a WIP/inventory pair on
//   `material-issue:<operationId>`, or `job:<jobId>` when the ledger row
//   names no operation (the SQL backflush). A return books inventory against
//   WIP. One journal per job and posting date;
// - a job completion (complete_job_to_inventory, same migration ~1290-1430):
//   one "Output", "Direct Cost", "Job Receipt" layer, and an inventory/WIP
//   pair on `job:<jobId>`, "Job Completion <job>". One journal per
//   completion.
//
// An outbound row costs at today's unit cost: the standard cost of a
// Standard item, else `itemCost.unitCost`. The enable's re-cost then values
// FIFO and LIFO rows against the opening and inbound layers. An outbound
// pair is written even at zero, as post-shipment and the backflush write it,
// so the re-cost finds the pair to adjust. A completion takes the material
// cost its job issued on or after the cutover up to that completion, as the
// posting takes the job's whole WIP balance. Labor and machine absorption are
// not rebuilt (no stored rate), and the re-cost moves the material cost
// without re-valuing the output layer. A completion with no material cost
// gets its layer at zero and no journal, as the posting writes none.
//
// A job issue or completion that stored its cost row (the company had
// accounting on) but lost its journal in the reset gets the journal at the
// stored cost, keyed on the day: a job and date with a journal line under the
// document type is left alone.

import type { Database } from "@carbon/database";
import { journalReference } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import {
  legacyJobMovements,
  legacySaleMovements
} from "@carbon/database/legacy-documents";
import { credit, debit, EPSILON, round } from "@carbon/utils";
import { nanoid } from "nanoid";
import { resolveInventoryAccount } from "../../lib/get-posting-group";
import {
  chunks,
  groupBy,
  type LegacyJournal,
  type LegacyJournalLine,
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
};

/** A cost row a posting stored for a job movement. Signed. */
export type StoredJobCost = {
  kind: JobMovement["kind"];
  jobId: string;
  itemId: string;
  quantity: number;
  cost: number;
};

export type PlannedJobMovement = {
  movement: JobMovement;
  /** The quantity no stored row covers, unsigned. A new row books it. */
  missingQuantity: number;
  /** The new row's cost, unsigned. */
  missingCost: number;
  /** The pair to write, unsigned; null when the movement needs none. */
  journal: { quantity: number; cost: number } | null;
};

/**
 * Plans the cost rows and journal pairs of job movements, in order. Stored
 * cost rows cover the earliest movements of a job, item and direction; the
 * rest costs at `unitCostByItem` for an issue or return, and at the job's
 * material cost not yet received for a completion. `journaledDays` holds
 * `<kind>:<jobId>:<postingDate>` for a job and date that has a journal.
 */
export function planLegacyJobCosts({
  movements,
  stored,
  journaledDays,
  unitCostByItem
}: {
  movements: JobMovement[];
  stored: StoredJobCost[];
  journaledDays: ReadonlySet<string>;
  unitCostByItem: ReadonlyMap<string, number>;
}): PlannedJobMovement[] {
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
  const cover = (movement: JobMovement) => {
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
      coveredQuantity,
      coveredCost: round(coveredCost),
      missingQuantity: wanted > EPSILON ? round(wanted) : 0
    };
  };

  const ordered = [...movements].sort((a, b) =>
    byText(`${a.postingDate}|${a.createdAt}`, `${b.postingDate}|${b.createdAt}`)
  );
  // The material cost each job has in WIP and no completion has taken.
  const wipByJob = new Map<string, number>();
  const planned: PlannedJobMovement[] = [];
  // Issues before completions at the same instant: the posting backflushes
  // the material, then receives the output, in one transaction.
  const atInstant = groupBy(
    ordered,
    (movement) => `${movement.postingDate}|${movement.createdAt}`
  );
  for (const group of atInstant.values()) {
    for (const movement of [
      ...group.filter((row) => row.kind === "Consumption"),
      ...group.filter((row) => row.kind === "Output")
    ]) {
      const { coveredQuantity, coveredCost, missingQuantity } = cover(movement);
      const journaled = journaledDays.has(
        `${movement.kind}:${movement.jobId}:${movement.postingDate}`
      );
      const wip = wipByJob.get(movement.jobId) ?? 0;
      if (movement.kind === "Consumption") {
        const outbound = movement.quantity < 0;
        const missingCost = round(
          missingQuantity * (unitCostByItem.get(movement.itemId) ?? 0)
        );
        const value = coveredCost + missingCost;
        wipByJob.set(movement.jobId, outbound ? wip + value : wip - value);
        const quantity = journaled
          ? missingQuantity
          : coveredQuantity + missingQuantity;
        const cost = journaled ? missingCost : value;
        // An issue's pair is written at zero, so the re-cost finds it; a
        // return at zero books nothing, as the manual issue skips it.
        const writes = quantity > EPSILON && (outbound || cost > EPSILON);
        planned.push({
          movement,
          missingQuantity,
          missingCost,
          journal: writes ? { quantity: round(quantity), cost } : null
        });
      } else {
        const afterCovered = wip - coveredCost;
        const missingCost =
          missingQuantity > 0 ? round(Math.max(afterCovered, 0)) : 0;
        wipByJob.set(movement.jobId, afterCovered - missingCost);
        const cost = (journaled ? 0 : coveredCost) + missingCost;
        planned.push({
          movement,
          missingQuantity,
          missingCost,
          // The posting writes no journal for a completion with no WIP.
          journal:
            cost > EPSILON
              ? { quantity: round(Math.abs(movement.quantity)), cost }
              : null
        });
      }
    }
  }
  return planned;
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
    return { costRows: 0, jobConsumptions: [], jobOutputs: [] };
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
  const jobIds = [...jobById.keys()];
  const storedRows = await readByIds(jobIds, (ids) =>
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
  // Today's unit cost, as calculateCOGS reads it for a Standard or Average
  // item. The re-cost replaces it for a FIFO or LIFO item.
  const unitCostByItem = new Map(
    itemCosts.map((row) => [
      row.itemId,
      Number(
        (row.costingMethod === "Standard" ? row.standardCost : row.unitCost) ??
          0
      )
    ])
  );

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
      kind: "Consumption" as const,
      jobId: row.documentId!,
      itemId: row.itemId,
      quantity: Number(row.quantity),
      postingDate: row.postingDate,
      createdAt: row.createdAt,
      documentLineId: row.documentLineId,
      locationId: row.locationId
    })),
    ...[
      ...groupBy(
        outputRows,
        (row) =>
          `${row.documentId}:${row.itemId}:${row.postingDate}:${row.createdAt}`
      ).values()
    ].map((group) => ({
      kind: "Output" as const,
      jobId: group[0]!.documentId!,
      itemId: group[0]!.itemId,
      quantity: group.reduce((sum, row) => sum + Number(row.quantity), 0),
      postingDate: group[0]!.postingDate,
      createdAt: group[0]!.createdAt,
      documentLineId: null,
      locationId: group[0]!.locationId
    }))
  ];
  const planned = planLegacyJobCosts({
    movements,
    stored: storedRows.map((row) => ({
      kind: row.itemLedgerType === "Output" ? "Output" : "Consumption",
      jobId: String(row.documentId),
      itemId: String(row.itemId),
      quantity: Number(row.quantity),
      cost: Number(row.cost)
    })),
    // The days with a job journal, as the detection reads them.
    journaledDays: new Set(
      ledgerRows
        .filter((row) => row.journaled)
        .map(
          (row) =>
            `${row.entryType === "Consumption" ? "Consumption" : "Output"}:${row.documentId}:${row.postingDate}`
        )
    ),
    unitCostByItem
  });

  // The rows, in the order of their movements, so the re-cost relieves
  // the layers in that order.
  const inserts: (CostLedgerInsert & { order: string })[] = [
    ...sales.map((row) => {
      const quantity = round(Number(row.quantity) - Number(row.covered));
      return {
        order: `${row.postingDate}|${row.createdAt}`,
        itemLedgerType: "Sale" as const,
        costLedgerType: "Direct Cost" as const,
        adjustment: false,
        documentType: "Sales Shipment" as const,
        documentId: row.documentId,
        itemId: row.itemId,
        quantity: -quantity,
        cost: -round(quantity * (unitCostByItem.get(row.itemId) ?? 0)),
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
          order: `${movement.postingDate}|${movement.createdAt}`,
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
  for (const rows of chunks(inserts)) {
    await trx
      .insertInto("costLedger")
      .values(rows.map(({ order, ...row }) => row))
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
  const withPair = planned.filter((plan) => plan.journal);

  const jobConsumptions = [
    ...groupBy(
      withPair.filter((plan) => plan.movement.kind === "Consumption"),
      (plan) => `${plan.movement.jobId}:${plan.movement.postingDate}`
    ).values()
  ].map((group): LegacyJournal => {
    const { jobId, postingDate } = group[0]!.movement;
    const lines = group.flatMap(
      ({ movement, journal }): LegacyJournalLine[] => {
        const inventory = inventoryOf(movement.itemId);
        const keys = {
          quantity: journal!.quantity,
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
              { ...wip, amount: round(debit("asset", journal!.cost)) },
              { ...stock, amount: round(credit("asset", journal!.cost)) }
            ]
          : [
              { ...stock, amount: round(debit("asset", journal!.cost)) },
              { ...wip, amount: round(credit("asset", journal!.cost)) }
            ];
      }
    );
    return {
      description: `Material Issue to Job ${jobById.get(jobId)?.jobId ?? jobId}`,
      postingDate,
      sourceType: "Job Consumption",
      lines
    };
  });

  const jobOutputs = withPair
    .filter((plan) => plan.movement.kind === "Output")
    .map(({ movement, journal }): LegacyJournal => {
      const inventory = inventoryOf(movement.itemId);
      const keys = {
        quantity: journal!.quantity,
        documentType: "Job Receipt" as const,
        documentId: movement.jobId,
        documentLineReference: journalReference.to.job(movement.jobId),
        journalLineReference: nanoid(),
        dimensions: dimensions(movement)
      };
      return {
        description: `Job Completion ${jobById.get(movement.jobId)?.jobId ?? movement.jobId}`,
        postingDate: movement.postingDate,
        sourceType: "Job Receipt",
        lines: [
          {
            ...keys,
            accountId: inventory.account,
            description: inventory.description,
            amount: round(debit("asset", journal!.cost))
          },
          {
            ...keys,
            accountId: defaults.workInProgressAccount,
            description: "WIP Account",
            amount: round(credit("asset", journal!.cost))
          }
        ]
      };
    });

  return { costRows: inserts.length, jobConsumptions, jobOutputs };
}

/** Code-point order: dates and UTC instants sort as written. */
function byText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
