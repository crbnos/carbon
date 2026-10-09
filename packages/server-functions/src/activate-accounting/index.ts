// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounting enable (.ai/specs/2026-10-08-accounting-cutover.md section
// 5). One transaction: it resets inventory as of the cutover date, re-costs
// the outbound movements after it, supersedes the Provisional journals before
// it, posts the opening journal, promotes the Provisional journals on or after
// it, closes the periods before it and stamps the cutover. It holds
// `companySettings` FOR UPDATE throughout; every posting reads that row FOR
// SHARE, so no posting can write a Provisional journal after the commit.

import { type Database, getCompanyTimeZone } from "@carbon/database";
import {
  buildOpeningJournalLines,
  planInventoryReset,
  type RecostLayer,
  recostOutbound
} from "@carbon/database/accounting-cutover";
import {
  ACCOUNTING_ALREADY_SET_UP,
  dayBeforeCutover,
  getActivationReadiness,
  getCutoverInventory,
  getMigrationClearing
} from "@carbon/database/accounting-cutover-reads";
import type { KyselyTx } from "@carbon/database/client";
import { inOrder } from "@carbon/database/rows";
import { getNextSequence } from "@carbon/database/sequence";
import { credit, datetime, EPSILON, equals, round } from "@carbon/utils";
import { endOfMonth, parseDate, startOfMonth } from "@internationalized/date";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { z } from "zod";
import { defineServerFn } from "../define-server-fn";
import { InvalidInputError, NotFoundError, ServerFnError } from "../errors";
import { resolveAccountingPeriod } from "../lib/get-accounting-period";
import { resolveInventoryAccount } from "../lib/get-posting-group";

export const activateAccountingInput = z.object({
  cutoverDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date"),
  confirmation: z.string()
});

export type ActivateAccountingResult = {
  cutoverDate: string;
  /** Null when nothing was open and the trial balance was empty. */
  openingJournalId: string | null;
};

/** Migration Clearing must total zero within this. */
const MIGRATION_CLEARING_TOLERANCE = 0.01;
const RECOST_DESCRIPTION = "Cutover recost";
const OPENING_JOURNAL_DESCRIPTION = "Opening Balance";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];
type JournalInsert = Database["public"]["Tables"]["journal"]["Insert"];
type JournalLineInsert = Database["public"]["Tables"]["journalLine"]["Insert"];
type JournalLineDocumentType =
  Database["public"]["Enums"]["journalLineDocumentType"];

const activateAccounting = defineServerFn({
  name: "activate-accounting",
  input: activateAccountingInput,
  permissions: { update: "accounting" },
  async run(
    { db, companyId, userId },
    { cutoverDate, confirmation }
  ): Promise<ActivateAccountingResult> {
    return db
      .transaction()
      .execute(async (trx): Promise<ActivateAccountingResult> => {
        // 1. Lock the cutover stamp. Every posting reads it FOR SHARE.
        const settings = await trx
          .selectFrom("companySettings")
          .select("accountingCutoverDate")
          .where("id", "=", companyId)
          .forUpdate()
          .executeTakeFirst();
        if (!settings) throw new NotFoundError("Company settings not found");
        if (settings.accountingCutoverDate) {
          throw new InvalidInputError(ACCOUNTING_ALREADY_SET_UP);
        }

        // 2. The typed company name.
        const company = await trx
          .selectFrom("company")
          .select(["name", "companyGroupId"])
          .where("id", "=", companyId)
          .executeTakeFirst();
        if (!company?.companyGroupId) {
          throw new NotFoundError("Company not found");
        }
        if (confirmation.trim() !== company.name.trim()) {
          throw new InvalidInputError("Type the company name to confirm.");
        }

        // 3. Every readiness check and Migration Clearing, under the lock.
        // These read the Provisional ledger, so they run before any write.
        const args = { companyId, cutoverDate };
        const readiness = await getActivationReadiness(trx, args);
        const failed = readiness.checks.find((check) => !check.passed);
        if (failed) {
          throw new InvalidInputError(failed.detail ?? failed.label);
        }
        const clearing = await getMigrationClearing(trx, args);
        if (!equals(clearing.total, 0, MIGRATION_CLEARING_TOLERANCE)) {
          throw new InvalidInputError(
            `Migration Clearing totals ${clearing.total}. It must be zero to set up accounting.`
          );
        }
        if (!clearing.migrationClearingAccountId) {
          throw new InvalidInputError(
            "Set the migrationClearingAccount account default."
          );
        }
        const inventory = await getCutoverInventory(trx, args);
        const defaults = await trx
          .selectFrom("accountDefault")
          .selectAll()
          .where("companyId", "=", companyId)
          .executeTakeFirstOrThrow();

        // 4–7. Inventory as of the cutover, and the movements after it.
        await resetAndRecostInventory(trx, {
          companyId,
          userId,
          cutoverDate,
          companyGroupId: company.companyGroupId,
          inventory,
          defaults
        });

        // 8. Journals before the cutover leave the ledger for good.
        await trx
          .updateTable("journal")
          .set({ status: "Superseded", updatedBy: userId, updatedAt: now() })
          .where("companyId", "=", companyId)
          .where("status", "=", "Provisional")
          .where("postingDate", "<", cutoverDate)
          .execute();

        // 9. Recognition and lease interest due before the cutover is in the
        // opening balance; no run posts it.
        await trx
          .updateTable("revenueRecognitionSchedule")
          .set({
            status: "Posted",
            journalId: null,
            updatedBy: userId,
            updatedAt: now()
          })
          .where("companyId", "=", companyId)
          .where("status", "=", "Planned")
          .where("scheduledDate", "<", cutoverDate)
          .execute();

        // 10. The opening journal, the day before the cutover. It replaces
        // the Draft trial balance the wizard kept.
        const openingDate = dayBeforeCutover(cutoverDate);
        const draftTrialBalances = trx
          .selectFrom("journal")
          .select("id")
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .where("sourceType", "=", "Opening Balance");
        await trx
          .deleteFrom("journalLine")
          .where("companyId", "=", companyId)
          .where("journalId", "in", draftTrialBalances)
          .execute();
        await trx
          .deleteFrom("journal")
          .where("companyId", "=", companyId)
          .where("status", "=", "Draft")
          .where("sourceType", "=", "Opening Balance")
          .execute();

        const openingLines = buildOpeningJournalLines(
          clearing.items,
          clearing.trialBalance,
          clearing.controlAccountIds,
          clearing.migrationClearingAccountId
        );
        // A company with nothing open and no trial balance opens with no
        // journal at all, rather than an empty one.
        let openingJournalId: string | null = null;
        if (openingLines.length > 0) {
          const openingPeriod = await resolveAccountingPeriod(
            trx,
            companyId,
            openingDate,
            "historical"
          );
          const openingJournal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: await getNextSequence(
                trx,
                "journalEntry",
                companyId
              ),
              accountingPeriodId: openingPeriod.id,
              description: OPENING_JOURNAL_DESCRIPTION,
              postingDate: openingDate,
              sourceType: "Opening Balance",
              status: "Posted",
              postedAt: now(),
              postedBy: userId,
              companyId,
              createdBy: userId
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          openingJournalId = openingJournal.id;
          for (const rows of chunks(openingLines)) {
            await trx
              .insertInto("journalLine")
              .values(
                rows.map((line) => ({
                  journalId: openingJournal.id,
                  accountId: line.accountId,
                  amount: line.amount,
                  description: line.description,
                  documentType: line.documentType as JournalLineDocumentType,
                  documentId: line.documentId,
                  documentLineReference: line.documentLineReference,
                  quantity: line.quantity ?? 0,
                  journalLineReference: nanoid(),
                  companyId,
                  createdBy: userId
                }))
              )
              .execute();
          }
        }

        // 11. Periods for the journals that stay. A Superseded journal keeps
        // none.
        await assignPeriods(trx, companyId, cutoverDate);

        // 12–13. Stand-ins written while a default was empty.
        await repointStandInScheduleRows(trx, companyId, userId, defaults);
        await repointStandInLines(trx, companyId, cutoverDate, defaults);

        // 14. Promote.
        await trx
          .updateTable("journal")
          .set({
            status: "Posted",
            postedAt: now(),
            postedBy: userId,
            updatedBy: userId,
            updatedAt: now()
          })
          .where("companyId", "=", companyId)
          .where("status", "=", "Provisional")
          .where("postingDate", ">=", cutoverDate)
          .execute();

        // 15. Close every period before the cutover, oldest first. Not
        // closeAccountingPeriod: it opens its own transaction.
        const periodsToClose = await trx
          .selectFrom("accountingPeriod")
          .select("id")
          .where("companyId", "=", companyId)
          .where("endDate", "<", cutoverDate)
          .where("closeStatus", "!=", "Closed")
          .orderBy("startDate")
          .execute();
        if (periodsToClose.length > 0) {
          await trx
            .updateTable("accountingPeriod")
            .set({
              closeStatus: "Closed",
              closedAt: now(),
              closedBy: userId,
              updatedBy: userId,
              updatedAt: now()
            })
            .where("companyId", "=", companyId)
            .where(
              "id",
              "in",
              periodsToClose.map((period) => period.id)
            )
            .execute();
          // The snapshot takes one period; the periods are few (at most
          // three before the current one, plus the opening journal's).
          for (const period of periodsToClose) {
            await sql`SELECT "snapshotAccountingPeriodBalances"(${companyId}, ${period.id}, ${userId})`.execute(
              trx
            );
          }
        }

        // 16. The stamp. One-way: a trigger refuses any later change.
        await trx
          .updateTable("companySettings")
          .set({
            accountingCutoverDate: cutoverDate,
            accountingActivatedAt: now(),
            accountingActivatedBy: userId
          })
          .where("id", "=", companyId)
          .execute();

        return { cutoverDate, openingJournalId };
      });
  }
});

export default activateAccounting;

function now() {
  return datetime.timestamp();
}

/** Rows per statement, well inside Postgres's 65,535 bind parameters. */
const CHUNK_SIZE = 1000;

function chunks<T>(rows: T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    result.push(rows.slice(start, start + CHUNK_SIZE));
  }
  return result;
}

/** Layers `calculateCOGS` relieves: not an adjustment child, not a PO artifact. */
function relievableLayers(trx: KyselyTx, companyId: string) {
  return trx
    .selectFrom("costLedger")
    .where("companyId", "=", companyId)
    .where("adjustment", "=", false)
    .where("appliesToCostLedgerId", "is", null)
    .where((eb) =>
      eb.or([
        eb("documentType", "is", null),
        eb("documentType", "!=", "Purchase Order")
      ])
    );
}

/**
 * Steps 4–7. Closes the cost layers dated before the cutover and opens one
 * layer per item at the reviewed unit cost. Then re-costs every outbound
 * movement of a FIFO or LIFO item dated on or after the cutover against the
 * opening layer and the inbound layers after it, in the item's own order, and books each document's
 * difference as a Provisional "Cutover recost" journal between the accounts
 * its own posting used. Standard and Average items cost from `itemCost`, not
 * layers, so their movements keep their cost.
 */
async function resetAndRecostInventory(
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
  // 4. The reset plan.
  const layersBefore = await relievableLayers(trx, companyId)
    .select(["id", "itemId"])
    .where("postingDate", "<", cutoverDate)
    .where("remainingQuantity", ">", 0)
    .execute();
  const plan = planInventoryReset(
    inventory.map((item) => ({ itemId: item.itemId, quantity: item.quantity })),
    new Map(inventory.map((item) => [item.itemId, item.unitCost])),
    layersBefore.map((layer) => ({
      id: layer.id,
      itemId: layer.itemId ?? ""
    }))
  );
  if (plan.layerIdsToClose.length > 0) {
    // The same rows as `layersBefore`, by condition rather than an id list,
    // so a company with many layers stays within the bind-parameter limit.
    // Their invoice adjustment children close with them.
    const closing = relievableLayers(trx, companyId)
      .select("id")
      .where("postingDate", "<", cutoverDate)
      .where("remainingQuantity", ">", 0);
    await trx
      .updateTable("costLedger")
      .set({ remainingQuantity: 0 })
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("id", "in", closing),
          eb.and([
            eb("appliesToCostLedgerId", "in", closing),
            eb("remainingQuantity", ">", 0)
          ])
        ])
      )
      .execute();
  }

  // 5. Re-cost the FIFO and LIFO items' outbound movements after the cutover.
  const layeredCosts = await trx
    .selectFrom("itemCost")
    .select(["itemId", "unitCost", "costingMethod"])
    .where("companyId", "=", companyId)
    .where("costingMethod", "in", ["FIFO", "LIFO"])
    .execute();
  const layered = new Set(layeredCosts.map((row) => row.itemId));
  const [inboundAfter, outboundAfter] = await inOrder([
    () =>
      relievableLayers(trx, companyId)
        .select(["id", "itemId", "quantity", "cost", "postingDate"])
        .where("postingDate", ">=", cutoverDate)
        .where("quantity", ">", 0)
        .orderBy("postingDate")
        .orderBy("createdAt")
        .execute(),
    () =>
      trx
        .selectFrom("costLedger")
        .select([
          "id",
          "itemId",
          "quantity",
          "cost",
          "documentType",
          "documentId",
          "postingDate"
        ])
        .where("companyId", "=", companyId)
        .where("postingDate", ">=", cutoverDate)
        .where("quantity", "<", 0)
        .where("adjustment", "=", false)
        .where("appliesToCostLedgerId", "is", null)
        .orderBy("postingDate")
        .orderBy("entryNumber")
        .execute()
  ]);

  const openingKey = (itemId: string) => `opening:${itemId}`;
  // The opening layer comes first: it holds the stock on hand at the cutover.
  const recostLayers: RecostLayer[] = [
    ...plan.openingLayers
      .filter((layer) => layered.has(layer.itemId))
      .map((layer) => ({
        key: openingKey(layer.itemId),
        itemId: layer.itemId,
        postingDate: cutoverDate,
        quantity: layer.quantity,
        cost: layer.cost,
        remainingQuantity: layer.quantity
      })),
    ...inboundAfter
      .filter((layer) => layer.itemId && layered.has(layer.itemId))
      .map((layer) => ({
        key: layer.id,
        itemId: layer.itemId as string,
        postingDate: layer.postingDate,
        quantity: Number(layer.quantity),
        cost: Number(layer.cost),
        remainingQuantity: Number(layer.quantity)
      }))
  ];
  // Stored negative; the planner takes positive values.
  const outbound = outboundAfter
    .filter((row) => row.itemId && layered.has(row.itemId))
    .map((row) => ({
      costLedgerId: row.id,
      itemId: row.itemId as string,
      postingDate: row.postingDate,
      quantity: -Number(row.quantity),
      cost: -Number(row.cost)
    }));
  // A quantity no layer covers costs at the item's unit cost, as
  // calculateCOGS costs negative inventory.
  const recost = recostOutbound(
    recostLayers,
    outbound,
    new Map(layeredCosts.map((row) => [row.itemId, Number(row.unitCost ?? 0)])),
    new Map(
      layeredCosts.map((row) => [
        row.itemId,
        row.costingMethod === "LIFO" ? ("LIFO" as const) : ("FIFO" as const)
      ])
    )
  );

  // The opening layers, with what the re-cost left of them.
  if (plan.openingLayers.length > 0) {
    const timeZone = await getCompanyTimeZone(trx, companyId);
    const createdAt = sql<string>`(${cutoverDate}::date::timestamp AT TIME ZONE ${timeZone})`;
    await trx
      .insertInto("costLedger")
      .values(
        plan.openingLayers.map((layer) => ({
          itemLedgerType: "Purchase" as const,
          costLedgerType: "Direct Cost" as const,
          documentType: "Purchase Receipt" as const,
          adjustment: false,
          itemId: layer.itemId,
          quantity: layer.quantity,
          cost: layer.cost,
          nominalCost: layer.cost,
          remainingQuantity:
            recost.remainingByLayer.get(openingKey(layer.itemId)) ??
            layer.remainingQuantity,
          postingDate: cutoverDate,
          // Before any layer posted on the cutover day, so later relief
          // takes the opening stock first.
          createdAt,
          companyId
        }))
      )
      .execute();
  }

  const inboundRemaining = inboundAfter
    .filter((layer) => recost.remainingByLayer.has(layer.id))
    .map((layer) => ({
      id: layer.id,
      remaining: recost.remainingByLayer.get(layer.id) as number
    }));
  for (const rows of chunks(inboundRemaining)) {
    await sql`
      UPDATE "costLedger" AS c
      SET "remainingQuantity" = v."remaining"
      FROM (VALUES ${sql.join(
        rows.map((row) => sql`(${row.id}, ${row.remaining}::numeric)`)
      )}) AS v("id", "remaining")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }

  const changed = recost.movements.filter(
    (movement) => Math.abs(movement.delta) > EPSILON
  );
  if (changed.length === 0) return;
  for (const rows of chunks(changed)) {
    await sql`
      UPDATE "costLedger" AS c
      SET "cost" = -v."cost"
      FROM (VALUES ${sql.join(
        rows.map((row) => sql`(${row.costLedgerId}, ${row.newCost}::numeric)`)
      )}) AS v("id", "cost")
      WHERE c."id" = v."id" AND c."companyId" = ${companyId}
    `.execute(trx);
  }

  // 6–7. One Provisional journal per document and posting date.
  const outboundById = new Map(outboundAfter.map((row) => [row.id, row]));
  await postRecostJournals(trx, {
    companyId,
    userId,
    cutoverDate,
    defaults,
    deltas: changed.map((movement) => {
      const row = outboundById.get(movement.costLedgerId)!;
      return {
        itemId: row.itemId as string,
        documentId: row.documentId,
        documentType: row.documentType,
        postingDate: String(row.postingDate),
        quantity: -Number(row.quantity),
        delta: movement.delta
      };
    })
  });
}

type RecostDelta = {
  itemId: string;
  documentId: string | null;
  documentType: string | null;
  postingDate: string;
  quantity: number;
  delta: number;
};

/**
 * Books each re-costed movement's difference between the two accounts its
 * document's own Provisional journal used: the item's inventory line and the
 * line paired with it by `journalLineReference`. Inventory is credited by a
 * positive delta and the paired line moves the other way, signed as the
 * original pair is; the lines copy the
 * original's document keys, so a reader of the document's chain (close-job's
 * WIP sum, a void) sees the new cost. Refuses rather than guess an account.
 */
async function postRecostJournals(
  trx: KyselyTx,
  {
    companyId,
    userId,
    cutoverDate,
    defaults,
    deltas
  }: {
    companyId: string;
    userId: string;
    cutoverDate: string;
    defaults: AccountDefaults;
    deltas: RecostDelta[];
  }
) {
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
  const itemIds = [...new Set(deltas.map((delta) => delta.itemId))];

  const [items, lines] = await inOrder([
    () =>
      trx
        .selectFrom("item")
        .select(["id", "replenishmentSystem"])
        .where("companyId", "=", companyId)
        .where("id", "in", itemIds)
        .execute(),
    () =>
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
        .where("line.documentId", "in", documentIds)
        .where("journal.status", "=", "Provisional")
        .where("journal.postingDate", ">=", cutoverDate)
        .execute()
  ]);
  const replenishmentByItem = new Map(
    items.map((item) => [item.id, item.replenishmentSystem])
  );
  const indexLines = <K>(key: (line: (typeof lines)[number]) => K) => {
    const map = new Map<K, typeof lines>();
    for (const line of lines) {
      const k = key(line);
      const list = map.get(k);
      if (list) list.push(line);
      else map.set(k, [line]);
    }
    return map;
  };
  const linesByPair = indexLines(
    (line) => `${line.journalId}:${line.journalLineReference}`
  );
  // A document's credit lines on an account, on one posting date.
  const creditsByDocument = indexLines((line) =>
    Number(line.amount) <= EPSILON
      ? `${line.documentId}:${String(line.postingDate)}:${line.accountId}`
      : ""
  );

  type Pair = {
    inventory: (typeof lines)[number];
    offset: (typeof lines)[number];
  };
  const resolved: { delta: RecostDelta; pair: Pair }[] = [];
  for (const delta of deltas) {
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
    resolved.push({ delta, pair: candidates[0]! });
  }

  // One journal per document and posting date.
  const groups = new Map<
    string,
    {
      postingDate: string;
      sourceType: (typeof lines)[number]["sourceType"];
      entries: { delta: RecostDelta; pair: Pair }[];
    }
  >();
  for (const entry of resolved) {
    const key = `${entry.delta.documentId}:${entry.delta.postingDate}`;
    const group = groups.get(key) ?? {
      postingDate: entry.delta.postingDate,
      sourceType: entry.pair.inventory.sourceType,
      entries: []
    };
    group.entries.push(entry);
    groups.set(key, group);
  }

  const journalInserts: JournalInsert[] = [];
  for (const group of groups.values()) {
    // One sequence number per journal, as every posting allocates it.
    journalInserts.push({
      journalEntryId: await getNextSequence(trx, "journalEntry", companyId),
      description: RECOST_DESCRIPTION,
      postingDate: group.postingDate,
      sourceType: group.sourceType,
      status: "Provisional" as const,
      accountingPeriodId: null,
      postedAt: now(),
      postedBy: userId,
      companyId,
      createdBy: userId
    });
  }
  const journals = await trx
    .insertInto("journal")
    .values(journalInserts)
    .returning(["id", "journalEntryId"])
    .execute();
  const journalIdByEntry = new Map(
    journals.map((journal) => [journal.journalEntryId, journal.id])
  );

  const lineInserts: JournalLineInsert[] = [];
  [...groups.values()].forEach((group, index) => {
    const journalId = journalIdByEntry.get(
      journalInserts[index]!.journalEntryId
    )!;
    for (const { delta, pair } of group.entries) {
      // The offset mirrors the original pair's sign relation rather than
      // re-deriving it from the offset's account class: a stand-in line sits
      // on retained earnings but is signed for the account it stands in for.
      const relation =
        Math.sign(Number(pair.inventory.amount)) *
        Math.sign(Number(pair.offset.amount));
      if (relation === 0) {
        throw new ServerFnError(
          `The inventory line of ${label(delta)} or the line paired with it has no amount, so the cutover re-cost cannot sign its adjustment.`,
          409
        );
      }
      const inventoryAmount = round(credit("asset", delta.delta));
      const journalLineReference = nanoid();
      const keys = (line: (typeof lines)[number]) => ({
        documentType: line.documentType,
        documentId: line.documentId,
        documentLineReference: line.documentLineReference
      });
      lineInserts.push(
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
      );
    }
  });
  for (const rows of chunks(lineInserts)) {
    await trx.insertInto("journalLine").values(rows).execute();
  }
}

/**
 * Step 11. Gives every Provisional journal dated on or after the cutover the
 * period that holds its date, resolving each month once.
 */
async function assignPeriods(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string
) {
  const dates = await trx
    .selectFrom("journal")
    .select("postingDate")
    .distinct()
    .where("companyId", "=", companyId)
    .where("status", "=", "Provisional")
    .where("postingDate", ">=", cutoverDate)
    .execute();
  const months = new Map<string, { start: string; end: string }>();
  for (const { postingDate } of dates) {
    const date = parseDate(String(postingDate));
    const start = startOfMonth(date).toString();
    months.set(start, { start, end: endOfMonth(date).toString() });
  }
  if (months.size === 0) return;

  const periods: { start: string; end: string; periodId: string }[] = [];
  for (const month of months.values()) {
    const period = await resolveAccountingPeriod(
      trx,
      companyId,
      month.start,
      "historical"
    );
    periods.push({ ...month, periodId: period.id });
  }
  await sql`
    UPDATE "journal" AS j
    SET "accountingPeriodId" = v."periodId"
    FROM (VALUES ${sql.join(
      periods.map(
        (period) =>
          sql`(${period.start}::date, ${period.end}::date, ${period.periodId})`
      )
    )}) AS v("start", "end", "periodId")
    WHERE j."companyId" = ${companyId}
      AND j."status" = 'Provisional'
      AND j."postingDate" BETWEEN v."start" AND v."end"
  `.execute(trx);
}

/**
 * Step 12. A schedule row has no role column, and retained earnings never
 * belongs on one, so a Planned row on retained earnings is a stand-in the
 * sales invoice wrote while a default was empty.
 */
async function repointStandInScheduleRows(
  trx: KyselyTx,
  companyId: string,
  userId: string,
  defaults: AccountDefaults
) {
  const standIn = defaults.retainedEarningsAccount;
  const rows = await trx
    .selectFrom("revenueRecognitionSchedule")
    .select([
      "id",
      "type",
      "debitAccountId",
      "creditAccountId",
      "rentalAgreementLineId"
    ])
    .where("companyId", "=", companyId)
    .where("status", "=", "Planned")
    .where((eb) =>
      eb.or([
        eb("debitAccountId", "=", standIn),
        eb("creditAccountId", "=", standIn)
      ])
    )
    .execute();
  if (rows.length === 0) return;

  const required = (role: keyof AccountDefaults) => {
    const accountId = defaults[role];
    if (typeof accountId !== "string" || !accountId) {
      throw new InvalidInputError(`Set the ${role} account default.`);
    }
    return accountId;
  };
  const updates = rows.map((row) => {
    let debitAccountId = row.debitAccountId;
    let creditAccountId = row.creditAccountId;
    if (debitAccountId === standIn) {
      if (row.type === "Deferral") {
        debitAccountId = required("deferredRevenueAccount");
      } else if (row.type === "Accrual") {
        debitAccountId = required("contractAssetAccount");
      } else {
        throw new ServerFnError(
          `Revenue schedule row ${row.id} (${row.type}) debits retained earnings, and the cutover cannot tell which account it wanted.`,
          409
        );
      }
    }
    if (creditAccountId === standIn) {
      creditAccountId = row.rentalAgreementLineId
        ? required("rentalIncomeAccount")
        : required("salesAccount");
    }
    return { id: row.id, debitAccountId, creditAccountId };
  });
  await sql`
    UPDATE "revenueRecognitionSchedule" AS r
    SET "debitAccountId" = v."debitAccountId",
        "creditAccountId" = v."creditAccountId",
        "updatedBy" = ${userId},
        "updatedAt" = now()
    FROM (VALUES ${sql.join(
      updates.map(
        (row) => sql`(${row.id}, ${row.debitAccountId}, ${row.creditAccountId})`
      )
    )}) AS v("id", "debitAccountId", "creditAccountId")
    WHERE r."id" = v."id" AND r."companyId" = ${companyId}
  `.execute(trx);
}

/**
 * Step 13. A stand-in line sits on retained earnings and names the default it
 * wanted. Before promotion it moves to that default, one UPDATE per role.
 */
async function repointStandInLines(
  trx: KyselyTx,
  companyId: string,
  cutoverDate: string,
  defaults: AccountDefaults
) {
  const staying = trx
    .selectFrom("journal")
    .select("id")
    .where("companyId", "=", companyId)
    .where("status", "=", "Provisional")
    .where("postingDate", ">=", cutoverDate);
  const roles = await trx
    .selectFrom("journalLine")
    .select("accountDefaultRole")
    .distinct()
    .where("companyId", "=", companyId)
    .where("accountDefaultRole", "is not", null)
    .where("journalId", "in", staying)
    .execute();
  for (const { accountDefaultRole: role } of roles) {
    if (!role) continue;
    const accountId = (defaults as Record<string, unknown>)[role];
    if (typeof accountId !== "string" || !accountId) {
      throw new InvalidInputError(`Set the ${role} account default.`);
    }
    await trx
      .updateTable("journalLine")
      .set({ accountId, accountDefaultRole: null })
      .where("companyId", "=", companyId)
      .where("accountDefaultRole", "=", role)
      .where("journalId", "in", staying)
      .execute();
  }
}
