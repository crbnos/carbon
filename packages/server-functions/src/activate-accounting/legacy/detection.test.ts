// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What the detection finds and what the enable writes agree (spec section
// 5a): every legacy document found gets a journal and is not found again,
// and a rebuilt movement journal is kept out of provider sync only when the
// provider may already hold its original.

import { LEGACY_DOCUMENT_FAMILIES } from "@carbon/database/legacy-documents";
import { sql } from "kysely";
import { expect } from "vitest";
import issue from "../../issue";
import { databaseTest } from "../../local-database-test-fixture";
import {
  activationFixture,
  deleteJournals,
  enableWithStockAtTen,
  type Fixture,
  jobFixture,
  legacyDocumentCounts,
  moveBeforeCutover,
  receiveFiveParts,
  shipFiveParts,
  USER,
  unwrap
} from "../activation-test-fixture";

const NONE = Object.fromEntries(
  LEGACY_DOCUMENT_FAMILIES.map((family) => [family, 0])
);

databaseTest(
  "a zero-value job completion is journaled once, and a comment-only invoice is not found",
  async () => {
    const f = await activationFixture();
    try {
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);

      // After the cutover: a job completed with no material issued, its cost
      // row and journal gone, as a company with accounting off left it; and
      // a posted invoice with only a comment line.
      const job = await jobFixture(f);
      await f.db
        .deleteFrom("jobMaterial")
        .where("id", "=", job.materialId)
        .where("companyId", "=", f.companyId)
        .execute();
      await sql`SELECT complete_job_to_inventory(${job.jobId}, ${1}::numeric, ${null}, ${f.locationId}, ${f.companyId}, ${USER})`.execute(
        f.db
      );
      await f.db
        .deleteFrom("costLedger")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Receipt")
        .execute();
      await deleteJournals(f, ["Job Receipt"]);
      await postCommentOnlyInvoice(f);

      expect(await legacyDocumentCounts(f)).toEqual({
        ...NONE,
        jobOutputs: 1
      });
      // The enable writes what the wizard counted (`enableWithStockAtTen`
      // asserts it): the completion's pair at zero.
      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals.jobOutputs).toBe(1);
      const output = await f.db
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select(["journal.status", "journalLine.amount"])
        .where("journalLine.companyId", "=", f.companyId)
        .where("journal.sourceType", "=", "Job Receipt")
        .execute();
      expect(output.map((line) => [line.status, Number(line.amount)])).toEqual([
        ["Posted", 0],
        ["Posted", 0]
      ]);

      // Nothing is left for the wizard or the repair to find.
      expect(await legacyDocumentCounts(f)).toEqual(NONE);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "every journal the enable writes again stays out of provider sync, whether or not its document stored its cost",
  async () => {
    const f = await activationFixture();
    try {
      await f.db
        .insertInto("companyIntegration")
        .values({
          id: "xero",
          companyId: f.companyId,
          active: true,
          metadata: {},
          updatedBy: USER
        })
        .execute();
      await receiveFiveParts(f, { id: "po-1", unitPrice: 8 });
      await receiveFiveParts(f, { id: "po-2", unitPrice: 12 });
      await moveBeforeCutover(f);

      // After the cutover: a shipment that stored its "Sale" row (posted
      // with accounting on, its journal deleted by the reset), and a job
      // issue that stored none (posted with accounting off).
      await shipFiveParts(f);
      await deleteJournals(f, ["Sales Shipment"]);
      const job = await jobFixture(f);
      unwrap(
        await issue(f.ctx, {
          type: "partToOperation",
          id: job.operationId,
          itemId: f.partId,
          materialId: job.materialId,
          quantity: 2,
          adjustmentType: "Negative Adjmt."
        })
      );
      await f.db
        .deleteFrom("costLedger")
        .where("companyId", "=", f.companyId)
        .where("documentType", "=", "Job Consumption")
        .execute();
      await deleteJournals(f, ["Job Consumption"]);

      const result = await enableWithStockAtTen(f);
      expect(result.legacyJournals).toMatchObject({
        salesShipments: 1,
        jobConsumptions: 1
      });

      const rebuilt = async (
        sourceType: "Sales Shipment" | "Job Consumption"
      ) =>
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", sourceType)
            .where("description", "!=", "Cutover recost")
            .executeTakeFirstOrThrow()
        ).id;
      const operations = await f.db
        .selectFrom("accountingSyncOperation")
        .select(["entityId", "status", "errorCode"])
        .where("companyId", "=", f.companyId)
        .execute();
      // The shipment's original may sit in the provider. The issue stored no
      // cost, but the rows cannot prove it never had a journal, so it is kept
      // out too: a user sends it from Sync Activity.
      const expected = [
        await rebuilt("Sales Shipment"),
        await rebuilt("Job Consumption")
      ];
      // Sorted here: the database collation orders ids by another rule.
      expect(
        operations.sort((a, b) => (a.entityId < b.entityId ? -1 : 1))
      ).toEqual(
        expected.sort().map((entityId) => ({
          entityId,
          status: "Excluded",
          errorCode: "CUTOVER_REBUILT"
        }))
      );
    } finally {
      await f.cleanup();
    }
  }
);

/** A posted sales invoice dated today with only a comment line. */
async function postCommentOnlyInvoice(f: Fixture) {
  const invoiceId = `${f.prefix}-comment-invoice`;
  await f.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "INV-NOTE",
        customerId: f.customerId,
        currencyCode: "USD",
        exchangeRate: 1,
        status: "Submitted",
        postingDate: f.today,
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Comment",
        description: "Thank you for your business",
        quantity: 0,
        unitPrice: 0,
        exchangeRate: 1,
        unitOfMeasureCode: "EA",
        companyId: f.companyId,
        createdBy: USER
      })
      .execute();
  });
}
