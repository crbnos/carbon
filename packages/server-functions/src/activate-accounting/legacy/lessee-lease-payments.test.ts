// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A lessee lease's liability at the cutover is read from its schedule, but a
// purchase invoice's Lease line takes each payment off the liability when it
// posts. The opening liability therefore adds back a payment the schedule has
// taken off whose invoice has not posted before the cutover, and takes off one
// invoiced before the cutover that a later schedule line takes off.

import { getCutoverOpenItems } from "@carbon/database/accounting-cutover-reads";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../../local-database-test-fixture";
import { activationFixture, USER } from "../activation-test-fixture";

databaseTest(
  "the opening lease liability counts each payment once, by its invoice",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({
          leaseLiabilityAccount: f.account("card"),
          rightOfUseAssetAccount: f.account("fixed-assets"),
          accumulatedRightOfUseAmortizationAccount: f.account(
            "accumulated-depreciation"
          )
        })
        .where("companyId", "=", f.companyId)
        .execute();

      // Monthly rent in advance, from three months before the cutover: the
      // lines of months 0–2 are before it, month 3 starts on it.
      const cutover = parseDate(f.cutoverDate);
      const commenced = cutover.subtract({ months: 3 });
      const monthStart = (m: number) => commenced.add({ months: m }).toString();
      const monthEnd = (m: number) =>
        commenced
          .add({ months: m + 1 })
          .subtract({ days: 1 })
          .toString();

      const leaseId = `${f.prefix}-lease`;
      const leaseLineId = `${leaseId}-line`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("lease")
          .values({
            id: leaseId,
            leaseId: "LSE-PAY",
            supplierId: f.supplierId,
            locationId: f.locationId,
            status: "Active",
            commencementDate: commenced.toString(),
            endDate: commenced
              .add({ years: 3 })
              .subtract({ days: 1 })
              .toString(),
            invoiceFromDate: commenced.toString(),
            paymentTiming: "Advance",
            discountRate: 6,
            currencyCode: "USD",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("leaseLine")
          .values({
            id: leaseLineId,
            leaseId,
            description: "Forklift",
            paymentAmount: 1000,
            lesseeClassification: "Operating",
            initialLiability: 33000,
            initialRouAsset: 33000,
            rouAssetCost: 33000,
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("leaseScheduleLine")
          .values(
            [30000, 29100, 28200, 27300].map((closingLiability, m) => ({
              leaseId,
              leaseLineId,
              periodDate: monthEnd(m),
              openingLiability: 0,
              paymentAmount: 1000,
              interestAmount: 100,
              principalAmount: 900,
              closingLiability,
              leaseCost: 1000,
              rouAmortization: 900,
              closingRouAsset: 0,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();

        // Month 0 billed and posted before the cutover; month 2 billed on a
        // Draft invoice; month 3 billed and posted the day before the cutover.
        const interaction = await trx
          .insertInto("supplierInteraction")
          .values({ supplierId: f.supplierId, companyId: f.companyId })
          .returning("id")
          .executeTakeFirstOrThrow();
        const invoices = [
          {
            key: "posted",
            status: "Open" as const,
            postingDate: monthStart(0)
          },
          { key: "draft", status: "Draft" as const, postingDate: null },
          {
            key: "early",
            status: "Open" as const,
            postingDate: f.beforeCutover
          }
        ];
        for (const invoice of invoices) {
          await trx
            .insertInto("purchaseInvoice")
            .values({
              id: `${f.prefix}-${invoice.key}`,
              invoiceId: `PI-${invoice.key}`,
              supplierId: f.supplierId,
              supplierInteractionId: interaction.id,
              currencyCode: "USD",
              exchangeRate: 1,
              status: invoice.status,
              postingDate: invoice.postingDate,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute();
          await trx
            .insertInto("purchaseInvoiceLine")
            .values({
              id: `${f.prefix}-${invoice.key}-line`,
              invoiceId: `${f.prefix}-${invoice.key}`,
              invoiceLineType: "Lease",
              leaseId,
              quantity: 1,
              supplierUnitPrice: 1000,
              companyId: f.companyId,
              createdBy: USER
            })
            .execute();
        }
        const billedBy: Record<number, string> = {
          0: `${f.prefix}-posted-line`,
          2: `${f.prefix}-draft-line`,
          3: `${f.prefix}-early-line`
        };
        await trx
          .insertInto("leasePayment")
          .values(
            [0, 1, 2, 3, 4].map((m) => ({
              leaseId,
              leaseLineId,
              periodStart: monthStart(m),
              periodEnd: monthEnd(m),
              dueDate: monthStart(m),
              amount: 1000,
              status: billedBy[m]
                ? ("Invoiced" as const)
                : ("Pending" as const),
              purchaseInvoiceLineId: billedBy[m] ?? null,
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
      // The last line before the cutover closes at 28,200. Month 1 (Pending)
      // and month 2 (Draft invoice) were taken off by the schedule and will
      // be again by their invoices: +2,000. Month 3 posted before the cutover
      // and is taken off by a line after it: −1,000. Month 0 and month 4 are
      // counted once already.
      expect(
        items.find(
          (item) =>
            item.documentId === leaseId &&
            item.openItemType === "Lease Liability"
        )?.amount
      ).toBe(29200);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "the opening net investment of a sales-type lease adds back rent the schedule took off and no invoice has",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ netInvestmentInLeasesAccount: f.account("fixed-assets") })
        .where("companyId", "=", f.companyId)
        .execute();

      // Monthly periods from two months before the cutover: the lines of
      // months 0 and 1 are before it.
      const cutover = parseDate(f.cutoverDate);
      const commenced = cutover.subtract({ months: 2 });
      const monthStart = (m: number) => commenced.add({ months: m }).toString();
      const monthEnd = (m: number) =>
        commenced
          .add({ months: m + 1 })
          .subtract({ days: 1 })
          .toString();
      const agreementId = `${f.prefix}-ra`;
      const lineId = `${f.prefix}-ra-line`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("fixedAssetClass")
          .values({
            id: `${f.prefix}-class`,
            name: "Machinery",
            assetAccountId: f.account("fixed-assets"),
            accumulatedDepreciationAccountId: f.account(
              "accumulated-depreciation"
            ),
            depreciationExpenseAccountId: f.account("depreciation"),
            lossOnDisposalAccountId: f.account("loss-on-disposal"),
            gainOnDisposalAccountId: f.account("sales"),
            writeOffAccountId: f.account("loss-on-disposal"),
            writeDownAccountId: f.account("loss-on-disposal"),
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("fixedAsset")
          .values({
            id: `${f.prefix}-leased`,
            fixedAssetId: "LEASED",
            name: "Leased",
            fixedAssetClassId: `${f.prefix}-class`,
            status: "Disposed",
            disposalMethod: "Sale",
            disposalDate: monthStart(0),
            acquisitionCost: 1000,
            acquisitionDate: monthStart(0),
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("rentalAgreement")
          .values({
            id: agreementId,
            rentalAgreementId: "RA-PAY",
            customerId: f.customerId,
            locationId: f.locationId,
            currencyCode: "USD",
            exchangeRate: 1,
            discountRate: 6,
            startDate: monthStart(0),
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("rentalAgreementLine")
          .values({
            id: lineId,
            rentalAgreementId: agreementId,
            itemId: f.partId,
            fixedAssetId: `${f.prefix}-leased`,
            rate: 100,
            lessorClassification: "Sale",
            initialNetInvestment: 1000,
            status: "On Rent",
            companyId: f.companyId,
            createdBy: USER
          })
          .execute();
        await trx
          .insertInto("rentalLeaseScheduleLine")
          .values(
            [950, 900, 850].map((closing, m) => ({
              rentalAgreementLineId: lineId,
              periodDate: monthEnd(m),
              openingNetInvestment: closing + 50,
              closingNetInvestment: closing,
              paymentAmount: 60,
              interestAmount: 10,
              principalAmount: 50,
              companyId: f.companyId,
              createdBy: USER
            }))
          )
          .execute();
        // Month 1 is not invoiced yet; month 2 is after the cutover.
        await trx
          .insertInto("rentalBillingPeriod")
          .values(
            [1, 2].map((m) => ({
              rentalAgreementLineId: lineId,
              periodStart: monthStart(m),
              periodEnd: monthEnd(m),
              days: 30,
              amount: 60,
              dueOn: monthStart(m),
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
      // Month 1's line closes at 900 having taken its 60 off; its invoice
      // will take it off again, so the opening adds it back.
      expect(
        items.find(
          (item) =>
            item.documentId === agreementId &&
            item.openItemType === "Lease Net Investment"
        )?.amount
      ).toBe(960);
    } finally {
      await f.cleanup();
    }
  }
);
