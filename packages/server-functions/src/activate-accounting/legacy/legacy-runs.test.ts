// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Legacy asset and revenue runs dated on or after the cutover (spec section
// 5a). Their journals existed and the reset deleted them, leaving the runs
// Posted with no journal. The enable writes them again, and the opening
// balance is as of the day before the cutover, so nothing after it counts
// twice: the accumulated depreciation account equals the register, and
// deferred revenue nets to the rows still to recognize.

import {
  getCutoverFixedAssets,
  getCutoverOpenItems,
  getMigrationClearing,
  saveOpeningTrialBalance,
  updateCutoverAccumulatedDepreciation
} from "@carbon/database/accounting-cutover-reads";
import { round } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { expect } from "vitest";
import create from "../../create";
import { databaseTest } from "../../local-database-test-fixture";
import postSalesInvoice from "../../post-sales-invoice";
import postShipment from "../../post-shipment";
import activateAccounting from "..";
import {
  activationFixture,
  type Fixture,
  glBalance,
  journaledFamilies,
  legacyDocumentCounts,
  moveBeforeCutover,
  USER,
  unwrap
} from "../activation-test-fixture";

databaseTest(
  "enabling accounting writes legacy depreciation and scrap journals again, and the opening takes out the depreciation after the cutover",
  async () => {
    const f = await activationFixture();
    try {
      const { classId, assets, runs } = await legacyAssets(f);
      // An accounting integration was connected before the reset.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("companyIntegration")
          .values({
            id: "xero",
            companyId: f.companyId,
            active: true,
            metadata: {},
            updatedBy: USER
          })
          .execute();
      });

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };

      // The wizard: the accumulated depreciation the day before the cutover.
      // The scrapped asset is on the books then; the asset sold before the
      // reset leaves with no journal, so it is not.
      expect(
        (await getCutoverFixedAssets(f.db, args)).map((asset) => ({
          id: asset.id,
          status: asset.status,
          cost: asset.cost,
          accumulatedDepreciation: asset.accumulatedDepreciation
        }))
      ).toEqual([
        {
          id: assets.active,
          status: "Active",
          cost: 1200,
          accumulatedDepreciation: 200
        },
        {
          id: assets.scrapped,
          status: "Disposed",
          cost: 600,
          accumulatedDepreciation: 150
        }
      ]);
      // A saved value is the day before the cutover too; the asset keeps the
      // run after the cutover on top of it.
      expect(
        await updateCutoverAccumulatedDepreciation(f.db, {
          ...args,
          fixedAssetId: assets.active,
          accumulatedDepreciation: 250,
          userId: USER
        })
      ).toEqual({ id: assets.active, accumulatedDepreciation: 250 });
      expect(await assetAccumulated(f, assets.active)).toBe(350);
      await updateCutoverAccumulatedDepreciation(f.db, {
        ...args,
        fixedAssetId: assets.active,
        accumulatedDepreciation: 200
      });
      expect(await assetAccumulated(f, assets.active)).toBe(300);
      await expect(
        updateCutoverAccumulatedDepreciation(f.db, {
          ...args,
          fixedAssetId: assets.scrapped,
          accumulatedDepreciation: 100
        })
      ).rejects.toThrow("disposal cleared");

      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("fixed-assets"), debit: 1800, credit: 0 },
          {
            accountId: f.account("accumulated-depreciation"),
            debit: 0,
            credit: 350
          },
          {
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: 1450
          }
        ]
      });
      expect((await getMigrationClearing(f.db, args)).total).toBe(0);

      // The wizard counts the runs before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals).toMatchObject({
        depreciationRuns: 1,
        assetDisposals: 1,
        revenueRecognitionRuns: 0
      });

      // Only the run line after the cutover of an asset still on the books.
      const lines = await f.db
        .selectFrom("depreciationRunLine")
        .select(["id", "journalId"])
        .where("companyId", "=", f.companyId)
        .execute();
      const journalOf = new Map(lines.map((row) => [row.id, row.journalId]));
      expect(journalOf.get(runs.before)).toBeNull();
      expect(journalOf.get(runs.soldAfter)).toBeNull();
      const depreciationJournalId = journalOf.get(runs.after);
      expect(depreciationJournalId).toBeTruthy();

      const disposal = await f.db
        .selectFrom("fixedAssetDisposal")
        .select("journalId")
        .where("fixedAssetId", "=", assets.scrapped)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(disposal.journalId).toBeTruthy();

      const journals = await f.db
        .selectFrom("journal")
        .select(["id", "status", "sourceType", "postingDate", "description"])
        .where("companyId", "=", f.companyId)
        .where("id", "in", [depreciationJournalId!, disposal.journalId!])
        .orderBy("sourceType")
        .execute();
      expect(
        journals.map(({ id, postingDate, ...journal }) => ({
          ...journal,
          postingDate: String(postingDate)
        }))
      ).toEqual([
        {
          status: "Posted",
          sourceType: "Asset Depreciation",
          postingDate: endOfMonth(parseDate(f.cutoverDate)).toString(),
          description: "Depreciation: FA-ACTIVE"
        },
        {
          status: "Posted",
          sourceType: "Asset Disposal",
          postingDate: f.today,
          description: "Asset Disposal: FA-SCRAPPED (Scrapping)"
        }
      ]);
      const dimensions = await f.db
        .selectFrom("journalLineDimension as d")
        .innerJoin("journalLine as l", "l.id", "d.journalLineId")
        .select(["l.journalId", "d.valueId"])
        .where("l.journalId", "=", depreciationJournalId!)
        .execute();
      expect(dimensions.map((row) => row.valueId)).toEqual([classId, classId]);

      // The opening at the day before plus the runs after equals the register.
      expect(await glBalance(f, "accumulated-depreciation")).toBe(-300);
      expect(await assetAccumulated(f, assets.active)).toBe(300);
      expect(await glBalance(f, "fixed-assets")).toBe(1200);
      expect(await glBalance(f, "depreciation")).toBe(100);
      expect(await glBalance(f, "loss-on-disposal")).toBe(450);

      // Both journals stay out of provider sync; nothing else is recorded.
      const operations = await f.db
        .selectFrom("accountingSyncOperation")
        .select(["integration", "entityId", "status", "errorCode"])
        .where("companyId", "=", f.companyId)
        .orderBy("entityId")
        .execute();
      expect(operations).toEqual(
        [depreciationJournalId!, disposal.journalId!].sort().map((id) => ({
          integration: "xero",
          entityId: id,
          status: "Excluded",
          errorCode: "CUTOVER_REBUILT"
        }))
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "enabling accounting writes a legacy recognition run again, and deferred revenue nets to the rows still to recognize",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          deferredRevenueAccount: f.account("deferred-revenue"),
          scrapAccount: f.account("scrap")
        })
        .where("companyId", "=", f.companyId)
        .execute();
      // Three months of service, the month before the cutover to the month
      // after it, invoiced before the cutover.
      const invoiceId = await postDeferredServiceInvoice(f);
      await moveBeforeCutover(f);
      const rows = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select(["id", "amount", sql<string>`"scheduledDate"::text`.as("date")])
        .where("companyId", "=", f.companyId)
        .where("type", "=", "Deferral")
        .orderBy("scheduledDate")
        .execute();
      expect(rows).toHaveLength(3);
      const [before, current, next] = rows as [
        (typeof rows)[number],
        (typeof rows)[number],
        (typeof rows)[number]
      ];
      expect(before.date < f.cutoverDate).toBe(true);
      expect(current.date >= f.cutoverDate).toBe(true);

      // A run posted the current month before the reset; the reset deleted
      // its journal.
      const runId = await postedRunWithoutJournal(f, current.id, {
        amount: Number(current.amount),
        periodEnd: current.date
      });

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      // Deferred the day before the cutover: the current and next months.
      const deferredOpening = round(
        Number(current.amount) + Number(next.amount)
      );
      const deferred = (await getCutoverOpenItems(f.db, args)).filter(
        (item) => item.openItemType === "Deferred Revenue"
      );
      expect(deferred).toMatchObject([
        { documentId: invoiceId, amount: deferredOpening }
      ]);
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("receivables"), debit: 300, credit: 0 },
          {
            accountId: f.account("deferred-revenue"),
            debit: 0,
            credit: deferredOpening
          },
          {
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: round(300 - deferredOpening)
          }
        ]
      });
      expect((await getMigrationClearing(f.db, args)).total).toBe(0);

      // The wizard counts the runs before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals.revenueRecognitionRuns).toBe(1);

      const after = await f.db
        .selectFrom("revenueRecognitionSchedule")
        .select(["id", "status", "journalId"])
        .where("companyId", "=", f.companyId)
        .execute();
      const byId = new Map(after.map((row) => [row.id, row]));
      expect(byId.get(before.id)).toMatchObject({
        status: "Posted",
        journalId: null
      });
      expect(byId.get(next.id)).toMatchObject({
        status: "Planned",
        journalId: null
      });
      const journalId = byId.get(current.id)!.journalId;
      expect(journalId).toBeTruthy();
      const run = await f.db
        .selectFrom("revenueRecognitionRun")
        .select("journalId")
        .where("id", "=", runId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(run.journalId).toBe(journalId);
      const journal = await f.db
        .selectFrom("journal")
        .select(["status", "sourceType", "description"])
        .where("id", "=", journalId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(journal).toEqual({
        status: "Posted",
        sourceType: "Revenue Recognition",
        description: "Revenue Recognition RR-LEGACY"
      });

      // Deferred revenue holds the next month only; the current month is
      // revenue after the cutover.
      expect(await glBalance(f, "deferred-revenue")).toBe(Number(next.amount));
      expect(await glBalance(f, "sales")).toBe(Number(current.amount));
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the opening net investment of a sales-type lease comes from its lease rows, not a commencement journal",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ netInvestmentInLeasesAccount: f.account("fixed-assets") })
        .where("companyId", "=", f.companyId)
        .execute();
      const twoMonthsBefore = parseDate(f.cutoverDate)
        .subtract({ months: 2 })
        .toString();
      const { classId } = await legacyAssets(f, { runs: false });
      const agreementId = `${f.prefix}-ra`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // Commenced before the cutover, and one commenced after it.
        for (const [asset, disposalDate] of [
          ["leased-before", twoMonthsBefore],
          ["leased-after", f.today]
        ] as const) {
          await trx
            .insertInto("fixedAsset")
            .values({
              id: `${f.prefix}-${asset}`,
              fixedAssetId: asset.toUpperCase(),
              name: asset,
              fixedAssetClassId: classId,
              status: "Disposed",
              disposalMethod: "Sale",
              disposalDate,
              acquisitionCost: 1000,
              acquisitionDate: twoMonthsBefore,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute();
        }
        await trx
          .insertInto("rentalAgreement")
          .values({
            id: agreementId,
            rentalAgreementId: "RA-1",
            customerId: f.customerId,
            locationId: f.locationId,
            currencyCode: "USD",
            exchangeRate: 1,
            discountRate: 6,
            startDate: twoMonthsBefore,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        for (const [line, asset] of [
          ["before", "leased-before"],
          ["after", "leased-after"]
        ] as const) {
          await trx
            .insertInto("rentalAgreementLine")
            .values({
              id: `${f.prefix}-line-${line}`,
              rentalAgreementId: agreementId,
              itemId: f.partId,
              fixedAssetId: `${f.prefix}-${asset}`,
              rate: 100,
              lessorClassification: "Sale",
              initialNetInvestment: 1000,
              status: "On Rent",
              companyId: f.companyId,
              createdBy: USER
            })
            .execute();
        }
        await trx
          .insertInto("rentalLeaseScheduleLine")
          .values(
            [
              [twoMonthsBefore, 1000, 950],
              [f.beforeCutover, 950, 900],
              [f.today, 900, 850]
            ].map(([periodDate, opening, closing]) => ({
              rentalAgreementLineId: `${f.prefix}-line-before`,
              periodDate: String(periodDate),
              openingNetInvestment: Number(opening),
              closingNetInvestment: Number(closing),
              paymentAmount: 60,
              interestAmount: 10,
              principalAmount: 50,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
      });

      const items = await getCutoverOpenItems(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      expect(
        items.filter((item) => item.openItemType === "Lease Net Investment")
      ).toMatchObject([
        {
          accountId: f.account("fixed-assets"),
          documentType: "Rental Agreement",
          documentId: agreementId,
          amount: 900
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an asset bought before the cutover and sold after the reset keeps its opening, and its sale journal clears it",
  async () => {
    const f = await activationFixture();
    try {
      const { classId } = await legacyAssets(f, { runs: false });
      const acquired = parseDate(f.cutoverDate)
        .subtract({ years: 1 })
        .toString();
      const monthEnd = endOfMonth(parseDate(f.cutoverDate)).toString();
      const assets = {
        invoiced: `${f.prefix}-invoiced`,
        shipped: `${f.prefix}-shipped`
      };
      // Each asset: cost 400, accumulated 120, of it 20 by a Posted run after
      // the cutover whose journal the reset deleted.
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("fixedAsset")
          .values(
            Object.entries(assets).map(([name, id]) => ({
              id,
              fixedAssetId: `FA-${name.toUpperCase()}`,
              name,
              fixedAssetClassId: classId,
              status: "Active" as const,
              acquisitionCost: 400,
              acquisitionDate: acquired,
              depreciationStartDate: acquired,
              accumulatedDepreciation: 120,
              locationId: f.locationId,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        await trx
          .insertInto("depreciationRun")
          .values({
            id: `${f.prefix}-dep-after`,
            depreciationRunId: "DEP-AFTER",
            periodEnd: monthEnd,
            status: "Posted",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("depreciationRunLine")
          .values(
            Object.values(assets).map((fixedAssetId) => ({
              depreciationRunId: `${f.prefix}-dep-after`,
              fixedAssetId,
              periodEnd: monthEnd,
              amount: 20,
              companyId: f.companyId
            }))
          )
          .execute();
      });

      // Sold after the reset, so each sale writes a Provisional journal and
      // leaves `fixedAssetDisposal.journalId` empty.
      await sellAssetOnInvoice(f, assets.invoiced);
      await shipAsset(f, assets.shipped);
      const disposals = await f.db
        .selectFrom("fixedAssetDisposal")
        .select(["fixedAssetId", "journalId"])
        .where("companyId", "=", f.companyId)
        .orderBy("fixedAssetId")
        .execute();
      expect(disposals).toEqual(
        Object.values(assets)
          .sort()
          .map((fixedAssetId) => ({ fixedAssetId, journalId: null }))
      );

      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      expect(
        (await getCutoverFixedAssets(f.db, args)).map((asset) => ({
          id: asset.id,
          cost: asset.cost,
          accumulatedDepreciation: asset.accumulatedDepreciation
        }))
      ).toEqual(
        [assets.invoiced, assets.shipped].map((id) => ({
          id,
          cost: 400,
          accumulatedDepreciation: 100
        }))
      );
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("fixed-assets"), debit: 800, credit: 0 },
          {
            accountId: f.account("accumulated-depreciation"),
            debit: 0,
            credit: 200
          },
          {
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: 600
          }
        ]
      });
      expect((await getMigrationClearing(f.db, args)).total).toBe(0);

      // The wizard counts the runs before the enable journals them.
      const counted = await legacyDocumentCounts(f);
      const result = unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );
      expect(journaledFamilies(result.legacyJournals)).toEqual(counted);
      expect(result.legacyJournals.depreciationRuns).toBe(1);

      // Opening, the rebuilt run and the sale: both accounts net to 0.
      expect(await glBalance(f, "fixed-assets")).toBe(0);
      expect(await glBalance(f, "accumulated-depreciation")).toBe(0);
      expect(await glBalance(f, "migration-clearing")).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

/** Sells the asset for 300 on a direct sales invoice, posted today. */
async function sellAssetOnInvoice(f: Fixture, assetId: string) {
  const invoiceId = `${f.prefix}-asset-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "INV-ASSET",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        postingDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Fixed Asset",
        assetId,
        quantity: 1,
        unitPrice: 300,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
}

/** Ships the asset on a sales order, today. */
async function shipAsset(f: Fixture, assetId: string) {
  const salesOrderId = `${f.prefix}-asset-so`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesOrder")
      .values({
        id: salesOrderId,
        salesOrderId: "SO-ASSET",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesOrderShipment")
      .values({ id: salesOrderId, companyId: f.companyId })
      .execute();
    await trx
      .insertInto("salesOrderLine")
      .values({
        salesOrderId,
        salesOrderLineType: "Fixed Asset",
        assetId,
        saleQuantity: 1,
        unitPrice: 300,
        locationId: f.locationId,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  const shipment = unwrap(
    await create(f.ctx, {
      type: "shipmentFromSalesOrder",
      salesOrderId,
      locationId: f.locationId
    })
  );
  unwrap(await postShipment(f.ctx, { type: "post", shipmentId: shipment.id }));
}

async function assetAccumulated(f: Fixture, id: string) {
  const row = await f.db
    .selectFrom("fixedAsset")
    .select("accumulatedDepreciation")
    .where("id", "=", id)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return Number(row.accumulatedDepreciation);
}

/**
 * A fixed asset class and three assets bought before the cutover, as the
 * reset left them: an Active asset with a run before the cutover and one
 * after it (accumulated 300, 100 of it after), an asset scrapped after the
 * cutover (accumulated 150), and an asset sold after the cutover before the
 * reset (no journal; a run of 20 after the cutover). No run has a journal.
 */
async function legacyAssets(f: Fixture, { runs = true } = {}) {
  await f.db
    .updateTable("accountDefault")
    .set({ scrapAccount: f.account("scrap") })
    .where("companyId", "=", f.companyId)
    .execute();
  const classId = `${f.prefix}-class`;
  const assets = {
    active: `${f.prefix}-active`,
    scrapped: `${f.prefix}-scrapped`,
    sold: `${f.prefix}-sold`
  };
  const lineIds = {
    before: `${f.prefix}-run-before`,
    after: `${f.prefix}-run-after`,
    soldAfter: `${f.prefix}-run-sold-after`
  };
  const acquired = parseDate(f.cutoverDate).subtract({ years: 1 }).toString();
  const monthEnd = endOfMonth(parseDate(f.cutoverDate)).toString();
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("dimension")
      .values({
        name: "Asset Class",
        entityType: "FixedAssetClass",
        companyGroupId: f.groupId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: classId,
        name: "Machinery",
        assetAccountId: f.account("fixed-assets"),
        accumulatedDepreciationAccountId: f.account("accumulated-depreciation"),
        depreciationExpenseAccountId: f.account("depreciation"),
        lossOnDisposalAccountId: f.account("loss-on-disposal"),
        gainOnDisposalAccountId: f.account("sales"),
        writeOffAccountId: f.account("loss-on-disposal"),
        writeDownAccountId: f.account("loss-on-disposal"),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    if (!runs) return;
    const asset = (
      id: string,
      readableId: string,
      cost: number,
      accumulated: number,
      disposal?: "Scrapping" | "Sale"
    ) => ({
      id,
      fixedAssetId: readableId,
      name: readableId,
      fixedAssetClassId: classId,
      status: disposal ? ("Disposed" as const) : ("Active" as const),
      ...(disposal ? { disposalMethod: disposal, disposalDate: f.today } : {}),
      acquisitionCost: cost,
      acquisitionDate: acquired,
      depreciationStartDate: acquired,
      accumulatedDepreciation: accumulated,
      companyId: f.companyId,
      createdBy: USER
    });
    await trx
      .insertInto("fixedAsset")
      .values([
        asset(assets.active, "FA-ACTIVE", 1200, 300),
        asset(assets.scrapped, "FA-SCRAPPED", 600, 150, "Scrapping"),
        asset(assets.sold, "FA-SOLD", 400, 120, "Sale")
      ])
      .execute();
    await trx
      .insertInto("fixedAssetDisposal")
      .values(
        (
          [
            [assets.scrapped, "Scrapping", 450],
            [assets.sold, "Sale", 280]
          ] as const
        ).map(([fixedAssetId, disposalMethod, nbv]) => ({
          fixedAssetId,
          disposalMethod,
          disposalDate: f.today,
          saleProceeds: 0,
          netBookValueAtDisposal: nbv,
          gainLoss: -nbv,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("depreciationRun")
      .values([
        {
          id: `${f.prefix}-dep-before`,
          depreciationRunId: "DEP-BEFORE",
          periodEnd: f.beforeCutover,
          status: "Posted",
          companyId: f.companyId,
          createdBy: USER
        },
        {
          id: `${f.prefix}-dep-after`,
          depreciationRunId: "DEP-AFTER",
          periodEnd: monthEnd,
          status: "Posted",
          companyId: f.companyId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("depreciationRunLine")
      .values([
        {
          id: lineIds.before,
          depreciationRunId: `${f.prefix}-dep-before`,
          fixedAssetId: assets.active,
          periodEnd: f.beforeCutover,
          amount: 100,
          companyId: f.companyId
        },
        {
          id: lineIds.after,
          depreciationRunId: `${f.prefix}-dep-after`,
          fixedAssetId: assets.active,
          periodEnd: monthEnd,
          amount: 100,
          companyId: f.companyId
        },
        {
          id: lineIds.soldAfter,
          depreciationRunId: `${f.prefix}-dep-after`,
          fixedAssetId: assets.sold,
          periodEnd: monthEnd,
          amount: 20,
          companyId: f.companyId
        }
      ])
      .execute();
  });
  return { classId, assets, runs: lineIds };
}

/** A sales invoice of 300 for three months of service, the month before the
 *  cutover to the month after it. */
async function postDeferredServiceInvoice(f: Fixture): Promise<string> {
  const invoiceId = `${f.prefix}-deferred-invoice`;
  const cutover = parseDate(f.cutoverDate);
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "INV-DEFERRED",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Draft",
        postingDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceShipment")
      .values({
        id: invoiceId,
        shippingCost: 0,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Service",
        itemId: f.serviceId,
        quantity: 1,
        unitPrice: 300,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        serviceStartDate: cutover.subtract({ months: 1 }).toString(),
        serviceEndDate: endOfMonth(cutover.add({ months: 1 })).toString(),
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  unwrap(await postSalesInvoice(f.ctx, { type: "post", invoiceId }));
  return invoiceId;
}

/** A Posted recognition run holding one schedule row, with no journal. */
async function postedRunWithoutJournal(
  f: Fixture,
  scheduleId: string,
  { amount, periodEnd }: { amount: number; periodEnd: string }
): Promise<string> {
  const runId = `${f.prefix}-rr`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("revenueRecognitionRun")
      .values({
        id: runId,
        runId: "RR-LEGACY",
        periodEnd: endOfMonth(parseDate(periodEnd)).toString(),
        status: "Posted",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    const runLine = await trx
      .insertInto("revenueRecognitionRunLine")
      .values({
        runId,
        scheduleId,
        amount,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("revenueRecognitionSchedule")
      .set({ status: "Posted", runLineId: runLine.id })
      .where("id", "=", scheduleId)
      .where("companyId", "=", f.companyId)
      .execute();
  });
  return runId;
}
