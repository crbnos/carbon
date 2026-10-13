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
import { databaseTest } from "../local-database-test-fixture";
import postPayment from "../post-payment";
import activateAccounting from ".";
import {
  activationFixture,
  moveBeforeCutover,
  pay,
  postServiceInvoice,
  USER,
  unwrap
} from "./activation-test-fixture";

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
        await activateAccounting(f.ctx, {
          ...args,
          confirmation: f.companyName
        })
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
      expect(lines).toEqual([
        expect.objectContaining({
          accountId: f.account("receivables"),
          debit: 100,
          credit: 0
        })
      ]);
      const clearing = await getMigrationClearing(f.db, args);
      expect(clearing.rows.every((row) => row.difference === 0)).toBe(true);
      // The receivable is still not offset anywhere in the trial balance.
      expect(clearing.total).toBe(-100);
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
        await postPayment(f.ctx, {
          type: "post",
          paymentId: await pay(f, { id: "pay-1", invoiceId, amount: 100 })
        })
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
