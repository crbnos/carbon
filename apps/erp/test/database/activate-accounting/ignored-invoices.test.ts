// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Migration Clearing's ignore and apply, against the live database. Another
// system kept the books before the cutover, so an invoice open in Carbon may
// be settled there: the user ignores it, Carbon leaves it out of its opening
// total, and the enable closes it as Paid the day before the cutover.

import {
  applyCarbonToOpeningTrialBalance,
  getMigrationClearing,
  getOpeningTrialBalance,
  setCutoverInvoiceIgnored
} from "@carbon/database/accounting-cutover-reads";
import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../fixtures/local-database";
import { postPayment } from "../../../app/modules/invoicing/invoicing.service";
import { activateAccounting } from "../../../app/modules/accounting/accounting.service";
import {
  activationFixture,
  moveBeforeCutover,
  pay,
  postServiceInvoice,
  USER,
  unwrap
} from "../fixtures/activation";
import { invokePosting } from "../../../app/modules/shared/shared.service";
import { handlesOf } from "../fixtures/handles";

databaseTest(
  "an ignored invoice leaves Carbon's opening total and closes as Paid the day before the cutover",
  async () => {
    const f = await activationFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      await moveBeforeCutover(f);
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };

      const before = await getMigrationClearing(f.db, args);
      expect(before.items.map((item) => item.documentId)).toContain(invoiceId);
      expect(before.total).toBe(-100);

      await setCutoverInvoiceIgnored(f.db, {
        ...args,
        userId: USER,
        invoiceId,
        ignored: true
      });
      const ignored = await getMigrationClearing(f.db, args);
      expect(ignored.items.map((item) => item.documentId)).not.toContain(
        invoiceId
      );
      expect(ignored.ignoredItems).toEqual([
        expect.objectContaining({
          openItemType: "Receivable",
          documentId: invoiceId,
          reference: "INV-1",
          amount: 100
        })
      ]);
      expect(ignored.total).toBe(0);

      unwrap(
        await invokePosting(handlesOf(f.ctx), "activate-accounting", {
                    ...args,
                    confirmation: f.companyName
                  }, activateAccounting)
      );

      const invoice = await f.db
        .selectFrom("salesInvoice")
        .select(["status", "datePaid"])
        .where("id", "=", invoiceId)
        .executeTakeFirstOrThrow();
      expect(invoice).toEqual({
        status: "Paid",
        datePaid: f.beforeCutover
      });
      const open = await sql<{ documentId: string }>`
        SELECT "documentId"
        FROM get_ar_open_by_customer(${f.companyId}, ${f.cutoverDate}::date)
      `.execute(f.db);
      expect(open.rows).toEqual([]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "stops ignoring an invoice, and applies Carbon's totals to the trial balance's control accounts",
  async () => {
    const f = await activationFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      await moveBeforeCutover(f);
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      const ignore = (ignored: boolean) =>
        setCutoverInvoiceIgnored(f.db, {
          ...args,
          userId: USER,
          invoiceId,
          ignored
        });
      await ignore(true);
      await ignore(true);
      await ignore(false);
      expect((await getMigrationClearing(f.db, args)).ignoredItems).toEqual([]);

      await applyCarbonToOpeningTrialBalance(f.db, { ...args, userId: USER });

      const { lines } = await getOpeningTrialBalance(f.db, args);
      expect(lines).toHaveLength(2);
      expect(lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: f.account("receivables"),
            debit: 100,
            credit: 0
          }),
          // Nothing in the trial balance offset the receivable: the
          // difference lands on retained earnings.
          expect.objectContaining({
            accountId: f.account("retained-earnings"),
            debit: 0,
            credit: 100
          })
        ])
      );
      const clearing = await getMigrationClearing(f.db, args);
      expect(clearing.rows.every((row) => row.difference === 0)).toBe(true);
      expect(clearing.total).toBe(0);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "an invoice Carbon is paid on after the cutover cannot be ignored",
  async () => {
    const f = await activationFixture();
    try {
      const invoiceId = await postServiceInvoice(f);
      await moveBeforeCutover(f);
      // Paid in Carbon after the cutover: its journal credits receivables,
      // so the invoice must open there.
      unwrap(
        await invokePosting(handlesOf(f.ctx), "post-payment", {
                    type: "post",
                    paymentId: await pay(f, { id: "pay-1", invoiceId, amount: 100 })
                  }, postPayment)
      );
      const args = { companyId: f.companyId, cutoverDate: f.cutoverDate };
      await setCutoverInvoiceIgnored(f.db, {
        ...args,
        userId: USER,
        invoiceId,
        ignored: true
      });

      const clearing = await getMigrationClearing(f.db, args);
      expect(clearing.settledFromCutoverIds.has(invoiceId)).toBe(true);
      expect(clearing.ignoredItems).toEqual([]);
      expect(clearing.items.map((item) => item.documentId)).toContain(
        invoiceId
      );
    } finally {
      await f.cleanup();
    }
  }
);
