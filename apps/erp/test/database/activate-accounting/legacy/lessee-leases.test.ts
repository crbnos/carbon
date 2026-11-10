// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Lessee lease balances at the cutover (spec 2026-10-11-lessee-leases, Leases
// live at cutover): the liability, the right-of-use asset at cost and its
// accumulated amortization come from the lease rows, not from journals, so a
// lease commenced before the reset opens with what its schedule says.

import { getCutoverOpenItems } from "@carbon/database/accounting-cutover-reads";
import { parseDate } from "@internationalized/date";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../../fixtures/local-database";
import {
  activationFixture,
  type Fixture,
  USER
} from "../../fixtures/activation";

async function insertLease(
  f: Fixture,
  args: {
    key: string;
    status: "Active" | "Terminated";
    commencementDate: string;
    lines: {
      periodDate: string;
      closingLiability: number;
      rouAmortization: number;
    }[];
    events?: {
      eventType: "Modification" | "Termination";
      effectiveDate: string;
      liabilityDelta: number;
      rouDelta: number;
    }[];
  }
): Promise<string> {
  const leaseId = `${f.prefix}-${args.key}`;
  const leaseLineId = `${leaseId}-line`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("lease")
      .values({
        id: leaseId,
        leaseId: args.key.toUpperCase(),
        name: args.key,
        supplierId: f.supplierId,
        locationId: f.locationId,
        status: args.status,
        commencementDate: args.commencementDate,
        endDate: parseDate(args.commencementDate)
          .add({ years: 3 })
          .subtract({ days: 1 })
          .toString(),
        invoiceFromDate: args.commencementDate,
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
        description: args.key,
        paymentAmount: 1000,
        status: args.status,
        lesseeClassification: "Operating",
        initialLiability: 30000,
        initialRouAsset: 30000,
        rouAssetCost: 30000,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("leaseScheduleLine")
      .values(
        args.lines.map((line) => ({
          leaseId,
          leaseLineId,
          periodDate: line.periodDate,
          openingLiability: 0,
          paymentAmount: 1000,
          interestAmount: 150,
          principalAmount: 850,
          closingLiability: line.closingLiability,
          leaseCost: 1000,
          rouAmortization: line.rouAmortization,
          closingRouAsset: 0,
          companyId: f.companyId,
          createdBy: USER
        }))
      )
      .execute();
    for (const event of args.events ?? []) {
      await trx
        .insertInto("leaseEvent")
        .values({
          leaseId,
          leaseLineId,
          eventType: event.eventType,
          effectiveDate: event.effectiveDate,
          liabilityBefore: 20000,
          liabilityAfter: 20000 + event.liabilityDelta,
          rouAssetBefore: 20000,
          rouAssetAfter: 20000 + event.rouDelta,
          classificationBefore: "Operating",
          classificationAfter: "Operating",
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
    }
  });
  return leaseId;
}

databaseTest(
  "a lessee lease opens with its liability, right-of-use cost and accumulated amortization at the cutover",
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

      const cutover = parseDate(f.cutoverDate);
      const monthEnd = (monthsBefore: number) =>
        cutover.subtract({ months: monthsBefore, days: 1 }).toString();
      const commenced = cutover.subtract({ months: 3 }).toString();

      const active = await insertLease(f, {
        key: "active",
        status: "Active",
        commencementDate: commenced,
        lines: [
          {
            periodDate: monthEnd(2),
            closingLiability: 29150,
            rouAmortization: 840
          },
          {
            periodDate: monthEnd(1),
            closingLiability: 28300,
            rouAmortization: 845
          },
          {
            periodDate: monthEnd(0),
            closingLiability: 27450,
            rouAmortization: 850
          },
          // After the cutover: not yet on the books.
          {
            periodDate: cutover
              .add({ months: 1 })
              .subtract({ days: 1 })
              .toString(),
            closingLiability: 26600,
            rouAmortization: 855
          }
        ],
        // A remeasurement two months in raised the asset by 1,200 (the lines
        // after it already carry the liability).
        events: [
          {
            eventType: "Modification",
            effectiveDate: cutover.subtract({ months: 1 }).toString(),
            liabilityDelta: 1200,
            rouDelta: 1200
          }
        ]
      });
      // Terminated before the cutover: derecognized, so nothing opens.
      await insertLease(f, {
        key: "ended",
        status: "Terminated",
        commencementDate: commenced,
        lines: [
          {
            periodDate: monthEnd(2),
            closingLiability: 29150,
            rouAmortization: 840
          }
        ],
        events: [
          {
            eventType: "Termination",
            effectiveDate: monthEnd(2),
            liabilityDelta: -29150,
            rouDelta: -29160
          }
        ]
      });

      const items = await getCutoverOpenItems(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      const lessee = items.filter((item) => item.documentType === "Lease");
      expect(lessee).toHaveLength(3);
      expect(lessee).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            openItemType: "Lease Liability",
            accountId: f.account("card"),
            documentId: active,
            amount: 27450
          }),
          expect.objectContaining({
            openItemType: "Right-of-Use Asset",
            accountId: f.account("fixed-assets"),
            documentId: active,
            amount: 31200
          }),
          expect.objectContaining({
            openItemType: "Accumulated ROU Amortization",
            accountId: f.account("accumulated-depreciation"),
            documentId: active,
            // A credit on an asset account.
            amount: -2535
          })
        ])
      );
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a remeasurement after the last schedule line before the cutover still moves the opening liability",
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

      // Lease months run from the 15th, so the month that straddles the
      // cutover has no schedule line before it.
      const cutover = parseDate(f.cutoverDate);
      const commenced = cutover.subtract({ months: 2 }).set({ day: 15 });
      const leaseId = await insertLease(f, {
        key: "mid-month",
        status: "Active",
        commencementDate: commenced.toString(),
        lines: [
          {
            periodDate: commenced
              .add({ months: 1 })
              .subtract({ days: 1 })
              .toString(),
            closingLiability: 29150,
            rouAmortization: 840
          }
        ],
        events: [
          {
            eventType: "Modification",
            effectiveDate: commenced.add({ months: 1 }).toString(),
            liabilityDelta: 500,
            rouDelta: 500
          }
        ]
      });

      const items = await getCutoverOpenItems(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      expect(
        items.find(
          (item) =>
            item.documentId === leaseId &&
            item.openItemType === "Lease Liability"
        )?.amount
      ).toBe(29650);
    } finally {
      await f.cleanup();
    }
  }
);
