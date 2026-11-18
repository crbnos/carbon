// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// An outside processing receipt debits WIP under the receipt, with its
// purchase order line in the reference. The cutover opens a job's WIP as its
// own item, so that item must hold the job's receipts too: the enable
// supersedes the receipt's journal, and after it the job's completion and
// close read WIP from the opening line alone.

import {
  getMigrationClearing,
  saveOpeningTrialBalance
} from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import { activateAccounting } from "../../../app/modules/accounting/accounting.service";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import {
  activationFixture,
  type Fixture,
  USER,
  unwrap
} from "../fixtures/activation";
import { handlesOf } from "../fixtures/handles";
import { databaseTest } from "../fixtures/local-database";

/** A completed job whose supplier's 50.00 was received before the cutover:
 *  a Provisional receipt journal, Dr WIP 50 under the receipt with the
 *  purchase order line in the reference. */
async function outsideReceiptBeforeCutover(f: Fixture) {
  const jobId = `${f.prefix}-job`;
  const purchaseOrderId = `${f.prefix}-po`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("job")
      .values({
        id: jobId,
        jobId: "J-OSP",
        itemId: f.partId,
        quantity: 10,
        unitOfMeasureCode: "EA",
        locationId: f.locationId,
        status: "Completed",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    const interaction = await trx
      .insertInto("supplierInteraction")
      .values({ supplierId: f.supplierId, companyId: f.companyId })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("purchaseOrder")
      .values({
        id: purchaseOrderId,
        purchaseOrderId: "PO-OSP",
        purchaseOrderType: "Outside Processing",
        supplierId: f.supplierId,
        supplierInteractionId: interaction.id,
        jobId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "To Invoice",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    const line = await trx
      .insertInto("purchaseOrderLine")
      .values({
        purchaseOrderId,
        purchaseOrderLineType: "Part",
        itemId: f.partId,
        purchaseQuantity: 10,
        quantityReceived: 10,
        receivedComplete: true,
        supplierUnitPrice: 5,
        exchangeRate: 1,
        conversionFactor: 1,
        inventoryUnitOfMeasureCode: "EA",
        locationId: f.locationId,
        jobId,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: `${f.prefix}-JE-RCV`,
        description: "Purchase Receipt",
        postingDate: f.beforeCutover,
        sourceType: "Purchase Receipt",
        status: "Provisional",
        accountingPeriodId: null,
        companyId: f.companyId,
        createdBy: USER
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const receiptLine = {
      journalId: journal.id,
      quantity: 10,
      documentType: "Receipt" as const,
      documentId: `${f.prefix}-receipt`,
      documentLineReference: `receipt:${line.id}`,
      companyId: f.companyId,
      createdBy: USER
    };
    await trx
      .insertInto("journalLine")
      .values([
        {
          ...receiptLine,
          accountId: f.account("wip"),
          description: "WIP Account",
          amount: 50,
          journalLineReference: `${f.prefix}-rcv-wip`
        },
        {
          ...receiptLine,
          accountId: f.account("inventory"),
          description: "Inventory",
          amount: -50,
          journalLineReference: `${f.prefix}-rcv-other`
        }
      ])
      .execute();
  });
  return jobId;
}

async function jobWipBalance(f: Fixture, jobId: string) {
  const { rows } = await sql<{ balance: number }>`
    SELECT job_wip_balance(${jobId}, ${f.companyId}) AS balance
  `.execute(f.db);
  return rows[0]!.balance;
}

databaseTest(
  "a job's outside processing receipt before the cutover opens in the job's WIP item",
  async () => {
    const f = await activationFixture();
    try {
      const jobId = await outsideReceiptBeforeCutover(f);
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };

      await saveOpeningTrialBalance(f.db, {
        ...args,
        userId: USER,
        lines: [
          { accountId: f.account("wip"), debit: 50, credit: 0 },
          { accountId: f.account("retained-earnings"), debit: 0, credit: 50 }
        ]
      });
      const clearing = await getMigrationClearing(f.db, args);
      expect(
        clearing.items
          .filter((item) => item.accountId === f.account("wip"))
          .map((item) => [item.documentId, item.amount])
      ).toEqual([[jobId, 50]]);
      expect(clearing.total).toBe(0);

      unwrap(
        await invokePosting(
          handlesOf(f.ctx),
          "activate-accounting",
          { ...args, confirmation: f.companyName },
          activateAccounting
        )
      );

      // The receipt's journal is Superseded; the job's opening line holds
      // the 50 its close will write off.
      expect(await jobWipBalance(f, jobId)).toBe(50);
    } finally {
      await f.cleanup();
    }
  }
);
