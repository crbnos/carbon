// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounting enable against the live database. A company with no cutover
// receives stock and invoices a customer before the cutover date, ships and
// scraps after it, enters a trial balance that ties, and enables. The
// Provisional ledger then splits at the cutover: Superseded before it, Posted
// in a period after it, with one Posted opening journal between them.

import {
  getCutoverInventory,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import postInventoryAdjustment from "../post-inventory-adjustment";
import postPayment from "../post-payment";
import activateAccounting from ".";
import {
  activationFixture,
  debitOf,
  glBalance,
  moveBeforeCutover,
  pay,
  postServiceInvoice,
  receiveFiveParts,
  shipFiveParts,
  USER,
  unwrap
} from "./activation-test-fixture";

databaseTest(
  "enabling accounting splits the Provisional ledger at the cutover and opens it with one journal",
  async () => {
    const f = await activationFixture();
    try {
      // Before the cutover: 5 parts at 8 and 5 at 12 received and not
      // invoiced; an invoice of 100 with 40 paid.
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      const invoiceId = await postServiceInvoice(f);
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, { id: "pay-1", invoiceId, amount: 40 })
        })
      );
      await moveBeforeCutover(f);

      // On or after the cutover: ship 5 parts, and scrap 1 while the scrap
      // account default is empty.
      const shipmentId = await shipFiveParts(f);
      const scrapReason = await f.db
        .insertInto("scrapReason")
        .values({ name: "Damaged", companyId: f.companyId, createdBy: USER })
        .returning("id")
        .executeTakeFirstOrThrow();
      unwrap(
        await postInventoryAdjustment(f.ctx, {
          adjustmentType: "Scrap",
          itemId: f.partId,
          locationId: f.locationId,
          quantity: 1,
          scrapReasonId: scrapReason.id
        })
      );
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: f.account("scrap") })
        .where("companyId", "=", f.companyId)
        .execute();

      // The trial balance at the day before the cutover, tied to Carbon's
      // open items and its reviewed inventory value.
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const [part] = await getCutoverInventory(f.db, args);
      expect(part).toMatchObject({ itemId: f.partId, quantity: 10 });
      const unitCost = part!.unitCost;
      const inventoryValue = 10 * unitCost;
      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("receivables"), debit: 60, credit: 0 },
          {
            accountId: f.account("inventory"),
            debit: inventoryValue,
            credit: 0
          },
          { accountId: f.account("bank"), debit: 40, credit: 0 },
          { accountId: f.account("grni"), debit: 0, credit: 100 },
          {
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: inventoryValue
          }
        ]
      });

      // A wrong confirmation changes nothing.
      const refused = await activateAccounting(f.ctx, {
        ...args,
        confirmation: "not the company"
      });
      expect(refused.error?.message).toBe("Type the company name to confirm.");

      // No period is Active before the enable, so the enable must set it.
      await f.db
        .updateTable("accountingPeriod")
        .set({ status: "Inactive" })
        .where("companyId", "=", f.companyId)
        .execute();

      unwrap(
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
      );

      const journals = await f.db
        .selectFrom("journal")
        .select([
          "id",
          "status",
          "postingDate",
          "sourceType",
          "description",
          "accountingPeriodId"
        ])
        .where("companyId", "=", f.companyId)
        .execute();

      // No Provisional journal remains; nothing is left Draft either (the
      // trial balance became the opening journal).
      expect(journals.map((journal) => journal.status).sort()).not.toContain(
        "Provisional"
      );
      expect(journals.map((journal) => journal.status)).not.toContain("Draft");

      const opening = journals.filter(
        (journal) => journal.sourceType === "Opening Balance"
      );
      expect(opening).toHaveLength(1);
      expect(opening[0]).toMatchObject({
        status: "Posted",
        postingDate: f.beforeCutover
      });
      expect(opening[0]!.accountingPeriodId).not.toBeNull();

      // Before the cutover: Superseded, with no period. On or after it:
      // Posted, in a period.
      for (const journal of journals) {
        if (journal.sourceType === "Opening Balance") continue;
        if (String(journal.postingDate) < f.cutoverDate) {
          expect(journal).toMatchObject({
            status: "Superseded",
            accountingPeriodId: null
          });
        } else {
          expect(journal.status).toBe("Posted");
          expect(journal.accountingPeriodId).not.toBeNull();
        }
      }
      expect(
        journals.filter((journal) => journal.status === "Superseded").length
      ).toBeGreaterThanOrEqual(4);

      // The opening journal balances, and Migration Clearing nets to zero.
      const openingLines = await f.db
        .selectFrom("journalLine")
        .select(["accountId", "amount", "description", "documentLineReference"])
        .where("companyId", "=", f.companyId)
        .where("journalId", "=", opening[0]!.id)
        .execute();
      const imbalance = openingLines.reduce(
        (sum, line) => sum + debitOf(f, line.accountId, Number(line.amount)),
        0
      );
      expect(imbalance).toBeCloseTo(0, 6);
      expect(await glBalance(f, "migration-clearing")).toBeCloseTo(0, 6);
      expect(await glBalance(f, "receivables")).toBeCloseTo(60, 6);
      expect(await glBalance(f, "grni")).toBeCloseTo(100, 6);

      // No Posted line is a stand-in: the scrap moved to the scrap account.
      const standIns = await f.db
        .selectFrom("journalLine as line")
        .innerJoin("journal", (join) =>
          join
            .onRef("journal.id", "=", "line.journalId")
            .onRef("journal.companyId", "=", "line.companyId")
        )
        .select("line.id")
        .where("line.companyId", "=", f.companyId)
        .where("journal.status", "=", "Posted")
        .where("line.accountDefaultRole", "is not", null)
        .execute();
      expect(standIns).toEqual([]);
      expect(await glBalance(f, "scrap")).toBeCloseTo(unitCost, 6);

      // The shipment after the cutover costs 5 at the reset unit cost, in
      // its cost layer row and in its journals.
      const sale = await f.db
        .selectFrom("costLedger")
        .select(["cost", "quantity"])
        .where("companyId", "=", f.companyId)
        .where("documentId", "=", shipmentId)
        .executeTakeFirstOrThrow();
      expect(Number(sale.cost)).toBeCloseTo(-5 * unitCost, 6);
      // The shipment relieved the 8-cost layer (40) and the scrap the
      // 12-cost layer. The reset values the 10 parts on hand at the cutover
      // at 5 × 8 + 5 × 12 = 100, so a recost journal moves each difference.
      expect(unitCost).toBe(10);
      expect(
        journals.filter(
          (journal) =>
            journal.description === "Cutover recost" &&
            journal.status === "Posted"
        )
      ).toHaveLength(2);
      expect(await glBalance(f, "cogs")).toBeCloseTo(5 * unitCost, 6);
      // Opening stock less what left after the cutover, on the account and
      // on the one open layer.
      expect(await glBalance(f, "inventory")).toBeCloseTo(4 * unitCost, 6);
      const layers = await f.db
        .selectFrom("costLedger")
        .select(["quantity", "remainingQuantity", "postingDate"])
        .where("companyId", "=", f.companyId)
        .where("remainingQuantity", ">", 0)
        .execute();
      expect(
        layers.map((layer) => ({
          quantity: Number(layer.quantity),
          remainingQuantity: Number(layer.remainingQuantity),
          postingDate: layer.postingDate
        }))
      ).toEqual([
        { quantity: 10, remainingQuantity: 4, postingDate: f.cutoverDate }
      ]);

      // Every period before the cutover is Closed.
      const periods = await f.db
        .selectFrom("accountingPeriod")
        .select(["startDate", "endDate", "status", "closeStatus"])
        .where("companyId", "=", f.companyId)
        .execute();
      const before = periods.filter(
        (period) => String(period.endDate) < f.cutoverDate
      );
      expect(before.length).toBeGreaterThan(0);
      for (const period of before) expect(period.closeStatus).toBe("Closed");

      // The period that holds today is the one Active period.
      const active = periods.filter((period) => period.status === "Active");
      expect(active).toHaveLength(1);
      expect(String(active[0]!.startDate) <= f.today).toBe(true);
      expect(String(active[0]!.endDate) >= f.today).toBe(true);

      const settings = await f.db
        .selectFrom("companySettings")
        .select(["accountingCutoverDate", "accountingActivatedBy"])
        .where("id", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(settings).toEqual({
        accountingCutoverDate: f.cutoverDate,
        accountingActivatedBy: USER
      });

      // A payment of the rest posts against the opening line, and the
      // receivable nets to zero.
      unwrap(
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, { id: "pay-2", invoiceId, amount: 60 })
        })
      );
      expect(await glBalance(f, "receivables")).toBeCloseTo(0, 6);

      // The enable is one-way.
      const again = await activateAccounting(f.ctx, {
        ...args,
        confirmation: f.companyName
      });
      expect(again.error?.message).toBe("Accounting is already set up.");
    } finally {
      await f.cleanup();
    }
  }
);
