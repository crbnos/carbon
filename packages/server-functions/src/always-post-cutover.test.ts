// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the cutover itself changes for documents already posted, against the
// live database. A shipment, a purchase invoice or a reimbursement posted as
// Provisional and dated before a cutover the company then gets refuses its
// void (the receipt, sales invoice and charge are covered by
// activate-accounting/pre-cutover-voids.test.ts). And a posting that read
// Provisional before its transaction refuses when the cutover lands before it
// writes.

import { getActivationReadiness } from "@carbon/database/accounting-cutover-reads";
import {
  assertPostingStatusUnchanged,
  DEFAULT_FALLBACKS,
  POSTING_STATUS_CHANGED_ERROR
} from "@carbon/database/journal-posting-status";
import { datetime } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  alwaysPostFixture,
  type Fixture,
  newJournals,
  postSuppliesInvoice,
  seed,
  shipSalesOrder,
  stampCutover,
  stockPart
} from "./always-post-test-fixture";
import {
  INVENTORY_VOID_BEFORE_CUTOVER_ERROR,
  PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR,
  REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR
} from "./lib/cutover-void";
import { databaseTest } from "./local-database-test-fixture";
import postPurchaseInvoice from "./post-purchase-invoice";
import { reimbursementFixture } from "./post-reimbursement/post-reimbursement-test-fixture";
import { postReimbursementTransaction } from "./post-reimbursement/post-reimbursement-transaction";
import postShipment from "./post-shipment";

/** Re-dates every posted row of the company to the day before the cutover,
 *  as if it had been posted then. */
async function moveBeforeCutover(f: Fixture) {
  await seed(f, async (trx) => {
    for (const table of [
      "journal",
      "itemLedger",
      "costLedger",
      "shipment",
      "purchaseInvoice"
    ] as const) {
      await trx
        .updateTable(table)
        .set({ postingDate: f.beforeCutover })
        .where("companyId", "=", f.companyId)
        .execute();
    }
  });
}

databaseTest(
  "a shipment dated before the cutover refuses its void",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await stockPart(f, 10);
      const shipmentId = await shipSalesOrder(f);
      await moveBeforeCutover(f);
      await stampCutover(f);

      const voids = await newJournals(f, async () => {
        const result = await postShipment(f.ctx, {
          type: "void",
          shipmentId
        });
        expect(result.error?.message).toBe(INVENTORY_VOID_BEFORE_CUTOVER_ERROR);
      });
      expect(voids).toEqual([]);
      const shipment = await f.db
        .selectFrom("shipment")
        .select("status")
        .where("id", "=", shipmentId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(shipment.status).toBe("Posted");
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a purchase invoice dated before the cutover refuses its void",
  async () => {
    const f = await alwaysPostFixture();
    try {
      const invoiceId = await postSuppliesInvoice(f);
      await moveBeforeCutover(f);
      await stampCutover(f);
      const status = async () =>
        (
          await f.db
            .selectFrom("purchaseInvoice")
            .select("status")
            .where("id", "=", invoiceId)
            .where("companyId", "=", f.companyId)
            .executeTakeFirstOrThrow()
        ).status;
      const before = await status();
      expect(before).not.toBe("Voided");

      const voids = await newJournals(f, async () => {
        const result = await postPurchaseInvoice(f.ctx, {
          type: "void",
          invoiceId
        });
        expect(result.error?.message).toBe(
          PURCHASE_INVOICE_VOID_BEFORE_CUTOVER_ERROR
        );
      });
      expect(voids).toEqual([]);
      expect(await status()).toBe(before);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reimbursement dated before the cutover refuses its void",
  async () => {
    const f = await reimbursementFixture();
    try {
      const cutover = datetime.today("America/New_York").set({ day: 1 });
      // A company with no cutover posts the reimbursement, dated the day
      // before the cutover it gets later.
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: null })
        .where("id", "=", f.companyId)
        .execute();
      await f.db
        .deleteFrom("accountingPeriod")
        .where("companyId", "=", f.companyId)
        .execute();
      await f.db
        .updateTable("reimbursement")
        .set({ reimbursementDate: cutover.subtract({ days: 1 }).toString() })
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .execute();
      const posted = await postReimbursementTransaction(f.db, f.args);
      const journal = await f.db
        .selectFrom("journal")
        .select("status")
        .where("id", "=", posted.journalId!)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(journal.status).toBe("Provisional");

      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: cutover.toString() })
        .where("id", "=", f.companyId)
        .execute();
      await expect(
        postReimbursementTransaction(f.db, { ...f.args, type: "void" })
      ).rejects.toThrow(REIMBURSEMENT_VOID_BEFORE_CUTOVER_ERROR);

      const header = await f.db
        .selectFrom("reimbursement")
        .select(["status", "voidedAt"])
        .where("id", "=", f.reimbursementId)
        .where("companyId", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(header).toEqual({ status: "Posted", voidedAt: null });
      const journals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .execute();
      expect(journals).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  }
);

class Rollback extends Error {}

databaseTest(
  "a posting that read Provisional refuses once the cutover lands in its transaction",
  async () => {
    const f = await alwaysPostFixture();
    try {
      await expect(
        f.db.transaction().execute(async (trx) => {
          await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
          // Before the cutover the status a posting read still holds.
          await expect(
            assertPostingStatusUnchanged(trx, f.companyId, "Provisional")
          ).resolves.toBeUndefined();

          await trx
            .updateTable("companySettings")
            .set({ accountingCutoverDate: f.cutoverDate })
            .where("id", "=", f.companyId)
            .execute();
          await expect(
            assertPostingStatusUnchanged(trx, f.companyId, "Provisional")
          ).rejects.toThrow(POSTING_STATUS_CHANGED_ERROR);
          await expect(
            assertPostingStatusUnchanged(trx, f.companyId, "Posted")
          ).resolves.toBeUndefined();
          throw new Rollback();
        })
      ).rejects.toBeInstanceOf(Rollback);

      const settings = await f.db
        .selectFrom("companySettings")
        .select("accountingCutoverDate")
        .where("id", "=", f.companyId)
        .executeTakeFirstOrThrow();
      expect(settings.accountingCutoverDate).toBeNull();
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "readiness does not require an empty default that has a fallback, and still requires one that has none",
  async () => {
    const f = await alwaysPostFixture();
    try {
      // Every default with a fallback is empty; so is the labor absorption
      // default, which has none.
      await f.db
        .updateTable("accountDefault")
        .set(
          Object.fromEntries(
            Object.keys(DEFAULT_FALLBACKS).map((role) => [role, null])
          )
        )
        .where("companyId", "=", f.companyId)
        .execute();
      const { checks } = await getActivationReadiness(f.db, {
        companyId: f.companyId,
        cutoverDate: f.cutoverDate
      });
      const flagged = checks
        .find((check) => check.key === "account-defaults")!
        .items.map((item) => item.id);
      expect(flagged).toContain("laborAbsorptionAccount");
      for (const role of Object.keys(DEFAULT_FALLBACKS)) {
        expect(flagged).not.toContain(role);
      }
    } finally {
      await f.cleanup();
    }
  }
);
