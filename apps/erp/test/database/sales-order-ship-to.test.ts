// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The sales order PDF prints its Ship To from the `salesOrderLocations` view:
// the drop-ship location when the order drop-ships, and nothing otherwise.
// Runs against the local database; skipped without one.

import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

/** Two sites of the fixture's customer, one order per drop-ship setting
 *  whose header names the yard and whose shipment names the job site, and a
 *  drop-ship order whose shipment names no site. */
async function shipToFixture(f: Fixture) {
  const ids = {
    yard: `${f.prefix}-yard`,
    jobSite: `${f.prefix}-job-site`,
    plain: `${f.prefix}-so-plain`,
    dropShip: `${f.prefix}-so-drop`,
    dropShipNoSite: `${f.prefix}-so-drop-no-site`
  };
  await seed(f, async (trx) => {
    const addresses = await trx
      .insertInto("address")
      .values([
        {
          addressLine1: "10 Yard Rd",
          city: "Springfield",
          postalCode: "11111",
          companyId: f.companyId
        },
        {
          addressLine1: "20 Site Ave",
          city: "Shelbyville",
          postalCode: "22222",
          companyId: f.companyId
        }
      ])
      .returning("id")
      .execute();
    await trx
      .insertInto("customerLocation")
      .values([
        {
          id: ids.yard,
          name: "Yard",
          customerId: f.customerId,
          addressId: addresses[0]!.id,
          companyId: f.companyId
        },
        {
          id: ids.jobSite,
          name: "Job site",
          customerId: f.customerId,
          addressId: addresses[1]!.id,
          companyId: f.companyId
        }
      ])
      .execute();
    for (const [id, dropShipment, shipToId] of [
      [ids.plain, false, ids.jobSite],
      [ids.dropShip, true, ids.jobSite],
      [ids.dropShipNoSite, true, null]
    ] as const) {
      await trx
        .insertInto("salesOrder")
        .values({
          id,
          salesOrderId: id.toUpperCase(),
          customerId: f.customerId,
          customerLocationId: ids.yard,
          status: "Draft",
          currencyCode: "USD",
          exchangeRate: 1,
          locationId: f.locationId,
          companyId: f.companyId,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("salesOrderShipment")
        .values({
          id,
          dropShipment,
          customerId: f.customerId,
          customerLocationId: shipToId,
          companyId: f.companyId
        })
        .onConflict((oc) =>
          oc.column("id").doUpdateSet({
            dropShipment,
            customerId: f.customerId,
            customerLocationId: shipToId
          })
        )
        .execute();
    }
  });
  return ids;
}

databaseTest(
  "only a drop-shipped order has a Ship To, and never the header's location",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const ids = await shipToFixture(f);
      const rows = await f.db
        .selectFrom("salesOrderLocations")
        .select([
          "id",
          "shipToAddressLine1",
          "shipToCity",
          "shipToPostalCode",
          "shipToCustomerName"
        ])
        .where("id", "in", [ids.plain, ids.dropShip, ids.dropShipNoSite])
        .orderBy("id")
        .execute();
      const customer = await f.db
        .selectFrom("customer")
        .select("name")
        .where("id", "=", f.customerId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();

      expect(rows).toEqual([
        {
          id: ids.dropShip,
          shipToAddressLine1: "20 Site Ave",
          shipToCity: "Shelbyville",
          shipToPostalCode: "22222",
          shipToCustomerName: customer.name
        },
        {
          id: ids.dropShipNoSite,
          shipToAddressLine1: null,
          shipToCity: null,
          shipToPostalCode: null,
          shipToCustomerName: null
        },
        {
          id: ids.plain,
          shipToAddressLine1: null,
          shipToCity: null,
          shipToPostalCode: null,
          shipToCustomerName: null
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
