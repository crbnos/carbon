// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The Rental Site of an agreement: an Active agreement may change it through
// `setRentalAgreementTerm` (its other terms stay locked), the new site is the
// bill-to and ship-to of every invoice drafted after, and a site of another customer is
// refused on insert, on a Draft and on an Active agreement alike.
// Runs against the local stack; skipped without one.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { sql } from "kysely";
import { expect } from "vitest";
import * as sales from "../../app/modules/sales/sales.server";
import {
  draftEarlyRentalInvoice,
  previewEarlyRentalInvoice,
  insertRentalAgreement,
  updateRentalAgreement
} from "../../app/modules/sales/sales.service";
import { operationContext, postgrestTest } from "./fixtures/local-supabase";
import { rentalFixture } from "./fixtures/rental";

type RentalFixture = Awaited<ReturnType<typeof rentalFixture>>;

/** Two sites of the fixture's customer and one of a second customer of the
 *  same company. */
async function addSites(f: RentalFixture) {
  const otherCustomerId = `${f.companyId}-customer-2`;
  await f.db
    .insertInto("customer")
    .values({
      id: otherCustomerId,
      readableId: "CUS-OTHER",
      name: otherCustomerId,
      companyId: f.companyId
    })
    .execute();
  const addresses = await f.db
    .insertInto("address")
    .values([
      { addressLine1: "2 Yard Rd", companyId: f.companyId },
      { addressLine1: "3 Other St", companyId: f.companyId },
      { addressLine1: "4 South Rd", companyId: f.companyId }
    ])
    .returning("id")
    .execute();
  const sites = await f.db
    .insertInto("customerLocation")
    .values([
      {
        name: "North site",
        customerId: f.customerId,
        addressId: addresses[0]!.id,
        companyId: f.companyId
      },
      {
        name: "Other customer's site",
        customerId: otherCustomerId,
        addressId: addresses[1]!.id,
        companyId: f.companyId
      },
      {
        name: "South site",
        customerId: f.customerId,
        addressId: addresses[2]!.id,
        companyId: f.companyId
      }
    ])
    .returning("id")
    .execute();
  return {
    ownSite: sites[0]!.id,
    otherSite: sites[1]!.id,
    secondSite: sites[2]!.id
  };
}

async function agreementSite(db: Kysely<KyselyDatabase>, f: RentalFixture) {
  const row = await db
    .selectFrom("rentalAgreement")
    .select("customerLocationId")
    .where("id", "=", f.agreementId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.customerLocationId;
}

/** A system context for the fixture's company, as a route's `api` runs. */
async function contextOf(
  f: RentalFixture,
  client: Parameters<typeof operationContext>[1]
) {
  const company = await f.db
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return operationContext(
    { db: f.db, companyId: f.companyId, groupId: company.companyGroupId ?? "" },
    client,
    "system"
  );
}

async function draftInvoice(f: RentalFixture) {
  const args = {
    companyId: f.companyId,
    userId: "system",
    today: "2026-10-05",
    rentalAgreementId: f.agreementId,
    periods: 1
  };
  // The preview's first period, as the Invoice dialog sends it.
  const { firstPeriodStart } = await previewEarlyRentalInvoice(f.db, args);
  const drafted = await draftEarlyRentalInvoice(f.db, {
    ...args,
    fromPeriodStart: firstPeriodStart,
    canDraftCreditMemo: true
  });
  expect(drafted.invoiceId).not.toBeNull();
  return drafted.invoiceId!;
}

/** An invoice's bill-to and ship-to customer locations, read now. */
async function invoiceSites(f: RentalFixture, invoiceId: string) {
  const row = await f.db
    .selectFrom("salesInvoice as si")
    .innerJoin("salesInvoiceShipment as sis", (join) =>
      join
        .onRef("sis.id", "=", "si.id")
        .onRef("sis.companyId", "=", "si.companyId")
    )
    .select([
      "si.invoiceCustomerLocationId as billTo",
      "sis.customerLocationId as shipTo"
    ])
    .where("si.id", "=", invoiceId)
    .where("si.companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row;
}

postgrestTest(
  "a site changed on an Active agreement bills and ships only the invoices drafted after it",
  async (client) => {
    const f = await rentalFixture();
    try {
      const { ownSite, secondSite } = await addSites(f);
      const ctx = await contextOf(f, client);
      const setSite = (value: string) =>
        sales.setRentalAgreementTerm(ctx, {
          id: f.agreementId,
          field: "customerLocationId",
          value
        });

      expect((await setSite(ownSite)).error).toBeNull();
      const first = await draftInvoice(f);
      expect((await setSite(secondSite)).error).toBeNull();
      const second = await draftInvoice(f);

      // Both invoices read after the second change: the first keeps its sites.
      expect({
        first: await invoiceSites(f, first),
        second: await invoiceSites(f, second),
        agreement: await agreementSite(f.db, f)
      }).toEqual({
        first: { billTo: ownSite, shipTo: ownSite },
        second: { billTo: secondSite, shipTo: secondSite },
        agreement: secondSite
      });
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an Active agreement refuses a change to a locked term such as the billing cycle",
  async (client) => {
    const f = await rentalFixture();
    try {
      const ctx = await contextOf(f, client);
      const result = await sales.setRentalAgreementTerm(ctx, {
        id: f.agreementId,
        field: "billingCycle",
        value: "28 Days"
      });
      expect(result.error?.category).toBe("rule");
      const row = await f.db
        .selectFrom("rentalAgreement")
        .select("billingCycle")
        .where("id", "=", f.agreementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(row.billingCycle).toBe("Calendar Month");
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "an Active agreement refuses a site of another customer",
  async (client) => {
    const f = await rentalFixture();
    try {
      const { otherSite } = await addSites(f);
      const ctx = await contextOf(f, client);
      const result = await sales.setRentalAgreementTerm(ctx, {
        id: f.agreementId,
        field: "customerLocationId",
        value: otherSite
      });
      expect(result.error?.category).toBe("rule");
      expect(await agreementSite(f.db, f)).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a new agreement refuses a site of another customer",
  async (client) => {
    const f = await rentalFixture();
    try {
      const { otherSite } = await addSites(f);
      const inserted = await insertRentalAgreement(client, {
        rentalAgreementId: "RA-NEW",
        companyId: f.companyId,
        createdBy: "system",
        customerId: f.customerId,
        customerLocationId: otherSite,
        locationId: f.locationId,
        startDate: "2026-09-01",
        billingCycle: "Calendar Month",
        billingTiming: "Advance",
        currencyCode: "USD",
        depositAmount: 0,
        taxPercent: 0,
        discountRate: 0,
        ownershipTransfers: false,
        specializedAsset: false,
        purchaseOptionReasonablyCertain: false
      });
      expect(inserted.error?.code).toBe("RENTAL_SITE_WRONG_CUSTOMER");
      const created = await f.db
        .selectFrom("rentalAgreement")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("rentalAgreementId", "=", "RA-NEW")
        .execute();
      expect(created).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

postgrestTest(
  "a Draft agreement refuses a site of another customer",
  async (client) => {
    const f = await rentalFixture();
    try {
      const { otherSite } = await addSites(f);
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .updateTable("rentalAgreement")
          .set({ status: "Draft" })
          .where("id", "=", f.agreementId)
          .where("companyId", "=", f.companyId)
          .execute();
      });
      const update = await updateRentalAgreement(client, {
        id: f.agreementId,
        companyId: f.companyId,
        updatedBy: "system",
        customerId: f.customerId,
        customerLocationId: otherSite,
        locationId: f.locationId,
        startDate: "2026-09-01",
        billingCycle: "Calendar Month",
        billingTiming: "Advance",
        currencyCode: "USD",
        depositAmount: 0,
        taxPercent: 0,
        discountRate: 0,
        ownershipTransfers: false,
        specializedAsset: false,
        purchaseOptionReasonablyCertain: false
      });
      expect(update.error?.code).toBe("RENTAL_SITE_WRONG_CUSTOMER");
      expect(await agreementSite(f.db, f)).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);
