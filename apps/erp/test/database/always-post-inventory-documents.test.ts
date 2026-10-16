// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database (SUPABASE_DB_URL); skipped without one.
// A nonconformance scrap and an inventory count, before and after the
// company's accounting cutover: Provisional with no period before it, Posted
// in the period of the posting date after it.

import {
  alwaysPostFixture,
  expectPostedJournals,
  expectProvisionalJournals,
  type Fixture,
  journalLinesOf,
  newJournals,
  seed,
  stampCutover,
  stockPart,
  USER,
  unwrap
} from "@carbon/server-functions/always-post-test-fixture";
import { databaseTest } from "@carbon/server-functions/local-database-test-fixture";
import { expect } from "vitest";
import { postInventoryCount } from "../../app/modules/inventory/inventory.service";
import { postNonconformance } from "../../app/modules/quality/quality.service";
import { invokePosting } from "../../app/modules/shared/shared.service";

/** A nonconformance at the fixture's location. */
async function nonConformance(f: Fixture, key: string): Promise<string> {
  const id = `${f.prefix}-ncr-${key}`;
  await seed(f, async (trx) => {
    const type = await trx
      .insertInto("nonConformanceType")
      .values({
        name: `${f.prefix} damage ${key}`,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("nonConformance")
      .values({
        id,
        nonConformanceId: `NCR-${key}`,
        name: "Damaged brackets",
        source: "Internal",
        locationId: f.locationId,
        nonConformanceTypeId: type.id,
        openDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return id;
}

/** Scraps two parts on the nonconformance. */
async function scrapOnNonConformance(f: Fixture, documentId: string) {
  return newJournals(f, async () =>
    unwrap(
      await invokePosting(f.service, "post-nonconformance", {
        documentType: "Non-Conformance",
        documentId,
        movements: [
          { itemId: f.partId, locationId: f.locationId, quantity: -2 }
        ]
      }, postNonconformance)
    )
  );
}

/** A Pending count of the part with a snapshot of 0 and 3 counted. */
async function pendingCount(f: Fixture, key: string): Promise<string> {
  const id = `${f.prefix}-count-${key}`;
  await seed(f, async (trx) => {
    await trx
      .insertInto("inventoryCount")
      .values({
        id,
        inventoryCountId: `IC-${key}`,
        locationId: f.locationId,
        status: "Pending",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("inventoryCountLine")
      .values({
        inventoryCountId: id,
        itemId: f.partId,
        locationId: f.locationId,
        systemQuantity: 0,
        countedQuantity: 3,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
  return id;
}

databaseTest(
  "a nonconformance scrap writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);

      const before = await nonConformance(f, "1");
      const provisional = await scrapOnNonConformance(f, before);
      await expectProvisionalJournals(f, provisional, "Non-Conformance");
      expect(await journalLinesOf(f, provisional)).toEqual([
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        },
        {
          accountId: f.account("scrap"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        }
      ]);

      const periodId = await stampCutover(f);
      const after = await nonConformance(f, "2");
      const posted = await scrapOnNonConformance(f, after);
      await expectPostedJournals(f, posted, "Non-Conformance", periodId);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a nonconformance scrap with no scrap account default posts to the variance account before the cutover",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await f.db
        .updateTable("accountDefault")
        .set({ scrapAccount: null })
        .where("companyId", "=", f.companyId)
        .execute();
      await stockPart(f, 10);

      const journals = await scrapOnNonConformance(
        f,
        await nonConformance(f, "1")
      );
      await expectProvisionalJournals(f, journals, "Non-Conformance");
      expect(await journalLinesOf(f, journals)).toEqual([
        {
          accountId: f.account("adjustment-variance"),
          amount: 20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        },
        {
          accountId: f.account("inventory"),
          amount: -20,
          accountDefaultRole: null,
          documentType: "Non-Conformance"
        }
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an inventory count writes a Provisional journal before the cutover and a Posted one after it",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const before = await pendingCount(f, "1");
      const provisional = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            f.service,
            "post-inventory-count",
            { inventoryCountId: before },
            postInventoryCount
          )
        )
      );
      await expectProvisionalJournals(f, provisional, "Inventory Adjustment");

      const periodId = await stampCutover(f);
      const after = await pendingCount(f, "2");
      const posted = await newJournals(f, async () =>
        unwrap(
          await invokePosting(
            f.service,
            "post-inventory-count",
            { inventoryCountId: after },
            postInventoryCount
          )
        )
      );
      await expectPostedJournals(f, posted, "Inventory Adjustment", periodId);
    } finally {
      await f.cleanup();
    }
  }
);
