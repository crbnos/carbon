// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Put a cost of the user's own on ONE serial unit in stock — a unit a job
// completed with no production or material recorded, or one issued in at no
// cost. The unit is relieved from whatever layer it carries today
// (calculateCOGS, its own layer first) and re-booked on a layer of its own
// at the new cost, both rows `costLedgerType 'Revaluation'`; the difference
// posts Dr / Cr the inventory account against the offset account the value
// was spent from. Nothing moves: no item ledger row is written.
//
// FIFO / LIFO only. A Standard or Average item carries every unit at the
// item's one cost, so a single unit cannot have its own.

import type { KyselyDatabase as DB, Kysely } from "@carbon/database/client";
import {
  type AutomaticJournalStatus,
  journalPostingStatus
} from "@carbon/database/journal-posting-status";
import { inOrder } from "@carbon/database/rows";
import { round } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError } from "../errors";
import { buildOffsetLines } from "../lib/asset-transfer";
import { calculateCOGS } from "../lib/calculate-cogs";
import { getAccountingPeriodForDate } from "../lib/get-accounting-period";
import {
  getDefaultPostingGroup,
  resolveInventoryAccount
} from "../lib/get-posting-group";
import { getOffsetAccount } from "../lib/offset-account";
import {
  buildCostLedgerRow,
  buildJournalLineDimensions
} from "../lib/plan-adjustment";
import { createAdjustmentJournal } from "../lib/post-adjustment";

export const recostSerialUnitInput = z.object({
  trackedEntityId: z.string().min(1),
  // The unit's new carrying cost, in base currency.
  unitCost: z.number().min(0),
  offsetAccountId: z.string().optional().nullable(),
  postingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
});

export type RecostResult = {
  previousCost: number;
  unitCost: number;
  journalId: string | null;
};

const recostSerialUnit = defineServerFn({
  name: "recost-serial-unit",
  input: recostSerialUnitInput,
  // Recosting puts a number of the user's own on the books.
  permissions: { update: "accounting" },
  async run({ db, companyId, userId }, input): Promise<RecostResult> {
    const unitCost = round(input.unitCost);

    return db.transaction().execute(async (trx): Promise<RecostResult> => {
      // Lock the unit before reading where it is: a second recost, or an
      // issue, pick, transfer or adjustment of it (they lock it too), waits,
      // so the on-hand check below still holds when calculateCOGS relieves
      // its layer (which locks the layers it reads).
      const entity = await trx
        .selectFrom("trackedEntity")
        .select(["id", "itemId", "readableId", "status"])
        .where("id", "=", input.trackedEntityId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!entity?.itemId) throw new NotFoundError("Tracked entity not found");
      const itemId = entity.itemId;
      const serial = entity.readableId ?? entity.id;

      const [item, itemCost] = await inOrder([
        () =>
          trx
            .selectFrom("item")
            .select(["readableId", "itemTrackingType", "replenishmentSystem"])
            .where("id", "=", itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst(),
        () =>
          trx
            .selectFrom("itemCost")
            .select(["costingMethod", "itemPostingGroupId"])
            .where("itemId", "=", itemId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
      ]);
      if (!item || !itemCost) throw new NotFoundError("Item not found");
      if (item.itemTrackingType !== "Serial") {
        throw new InvalidInputError("Only a serialized unit can be recosted");
      }
      if (
        itemCost.costingMethod !== "FIFO" &&
        itemCost.costingMethod !== "LIFO"
      ) {
        throw new InvalidInputError(
          `${item.readableId} uses ${itemCost.costingMethod} costing, so every unit carries the item's cost; one unit cannot have its own`
        );
      }

      // Where the unit is: exactly one on hand, at one location.
      const stock = await trx
        .selectFrom("itemLedger")
        .select([
          "locationId",
          (eb) => eb.fn.sum<number>("quantity").as("onHand")
        ])
        .where("trackedEntityId", "=", entity.id)
        .where("itemId", "=", itemId)
        .where("companyId", "=", companyId)
        .groupBy("locationId")
        .having(sql<number>`SUM("quantity")`, ">", 0)
        .execute();
      const onHand = stock.reduce((sum, row) => sum + Number(row.onHand), 0);
      if (round(onHand) !== 1 || stock.length !== 1) {
        throw new InvalidInputError(
          `${serial} must have exactly one unit on hand to be recosted`
        );
      }
      const locationId = stock[0]?.locationId ?? null;

      // Provisional before the company's accounting cutover, Posted after it.
      const postingStatus = await journalPostingStatus(trx, companyId);
      const accounting = await loadAccounting(
        trx,
        companyId,
        input,
        postingStatus
      );

      // Relieve what the unit carries today, exactly as a shipment would.
      const relieved = await calculateCOGS(trx, {
        itemId,
        quantity: 1,
        companyId,
        trackedEntityIds: [entity.id]
      });
      const previousCost = round(relieved.totalCost);
      const delta = round(unitCost - previousCost);
      if (delta === 0) {
        throw new InvalidInputError(
          `${serial} is already carried at that cost`
        );
      }

      const ledger = {
        documentType: null,
        documentId: entity.id,
        itemId,
        postingDate: input.postingDate,
        trackedEntityId: entity.id,
        companyId
      };
      await trx
        .insertInto("costLedger")
        .values([
          {
            ...buildCostLedgerRow({
              ...ledger,
              entryType: "Negative Adjmt.",
              quantity: -1,
              cost: -previousCost
            }),
            costLedgerType: "Revaluation"
          },
          {
            // The unit's own layer: it is relieved first when it leaves.
            ...buildCostLedgerRow({
              ...ledger,
              entryType: "Positive Adjmt.",
              quantity: 1,
              cost: unitCost
            }),
            costLedgerType: "Revaluation"
          }
        ])
        .execute();

      let journalId: string | null = null;
      {
        const inventoryAccount = resolveInventoryAccount(
          item.replenishmentSystem,
          accounting.accountDefaults
        );
        journalId = await createAdjustmentJournal(trx, {
          companyId,
          accountingPeriodId: accounting.accountingPeriodId,
          status: postingStatus,
          description: `Recost ${item.readableId} ${serial}`,
          postingDate: input.postingDate,
          userId,
          sourceType: "Inventory Adjustment"
        });
        const journalLineReference = nanoid();
        const lines = await trx
          .insertInto("journalLine")
          .values(
            buildOffsetLines({
              amount: delta,
              accountId: inventoryAccount.account,
              description: inventoryAccount.description,
              offsetAccountId: accounting.offsetAccount.id,
              offsetDescription: "Inventory Recost",
              offsetAccountType: accounting.offsetAccount.type,
              label: "Inventory recost journal"
            }).map((line) => ({
              journalId: journalId as string,
              accountId: line.accountId,
              description: line.description,
              amount: line.amount,
              quantity: 1,
              documentType: "Inventory Adjustment" as const,
              documentId: entity.id,
              journalLineReference,
              companyId
            }))
          )
          .returning(["id"])
          .execute();
        const dimensions = buildJournalLineDimensions({
          journalLineIds: lines.map((line) => line.id),
          dimensions: accounting.dimensions,
          itemId,
          itemPostingGroupId: itemCost.itemPostingGroupId,
          locationId,
          companyId
        });
        if (dimensions.length > 0) {
          await trx
            .insertInto("journalLineDimension")
            .values(dimensions)
            .execute();
        }
      }

      return { previousCost, unitCost, journalId };
    });
  }
});

// Everything the journal needs, read on the recost's transaction.
async function loadAccounting(
  db: Kysely<DB>,
  companyId: string,
  input: z.output<typeof recostSerialUnitInput>,
  postingStatus: AutomaticJournalStatus
) {
  const [defaults, offsetAccount, company] = await inOrder([
    () => getDefaultPostingGroup(db, companyId),
    () => getOffsetAccount(db, companyId, input.offsetAccountId),
    () =>
      db
        .selectFrom("company")
        .select("companyGroupId")
        .where("id", "=", companyId)
        .executeTakeFirst()
  ]);
  if (defaults.error || !defaults.data) {
    throw new Error("Error getting account defaults");
  }
  if (!company) throw new Error("Failed to fetch company");
  // Fail closed: journal lines must not silently lose dimension tags.
  const dimensionRows = await db
    .selectFrom("dimension")
    .select(["id", "entityType"])
    .where("companyGroupId", "=", company.companyGroupId)
    .where("active", "=", true)
    .where("entityType", "in", ["Item", "ItemPostingGroup", "Location"])
    .execute();
  const dimensions: Record<string, string> = {};
  for (const row of dimensionRows) {
    if (row.entityType) dimensions[row.entityType] = row.id;
  }
  // A Provisional journal has no accounting period.
  const accountingPeriodId =
    postingStatus === "Posted"
      ? await getAccountingPeriodForDate(companyId, db, input.postingDate)
      : null;
  return {
    accountingPeriodId,
    accountDefaults: {
      rawMaterialsAccount: defaults.data.rawMaterialsAccount,
      finishedGoodsAccount: defaults.data.finishedGoodsAccount
    },
    offsetAccount,
    dimensions
  };
}

export default recostSerialUnit;
