// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A payment's journal built again from its stored rows is the journal its
// posting wrote: the same lines, stand-in roles and dimensions.

import { sql } from "kysely";
import { expect } from "vitest";
import { databaseTest } from "../local-database-test-fixture";
import { paymentFixture } from "./payment-test-fixture";
import { postPaymentTransaction } from "./post-payment-transaction";
import { rebuildPaymentJournals } from "./rebuild-journal";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;

/** The journal's lines, in a fixed order, with what the parity compares. */
async function postedLines(f: Fixture, journalId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select([
      "id",
      "accountId",
      "amount",
      "description",
      "accountDefaultRole",
      "documentLineReference"
    ])
    .where("companyId", "=", f.companyId)
    .where("journalId", "=", journalId)
    .execute();
  const dimensions = await f.db
    .selectFrom("journalLineDimension")
    .select(["journalLineId", "dimensionId", "valueId"])
    .where("companyId", "=", f.companyId)
    .where(
      "journalLineId",
      "in",
      lines.map((line) => line.id)
    )
    .execute();
  return sortLines(
    lines.map(({ id, ...line }) => ({
      ...line,
      amount: Number(line.amount),
      dimensions: dimensions
        .filter((dimension) => dimension.journalLineId === id)
        .map(({ dimensionId, valueId }) => ({ dimensionId, valueId }))
    }))
  );
}

function sortLines<T extends { description: string | null; amount: number }>(
  lines: T[]
): T[] {
  return [...lines].sort(
    (a, b) =>
      (a.description ?? "").localeCompare(b.description ?? "") ||
      a.amount - b.amount
  );
}

/** Builds the payment's journal again from its stored rows. */
async function rebuilt(f: Fixture, paymentId: string) {
  return f.db.transaction().execute(async (trx) => {
    const payment = await trx
      .selectFrom("payment")
      .selectAll()
      .where("id", "=", paymentId)
      .where("companyId", "=", f.companyId)
      .executeTakeFirstOrThrow();
    const [journal] = await rebuildPaymentJournals(
      trx,
      [payment],
      f.companyId,
      {
        postingStatus: "Posted",
        feeByPaymentId: new Map()
      }
    );
    return sortLines(
      journal!.lines.map((line) => ({
        accountId: line.accountId,
        amount: line.amount,
        description: line.description,
        accountDefaultRole: line.accountDefaultRole,
        documentLineReference: line.documentLineReference ?? null,
        dimensions: journal!.dimensions
      }))
    );
  });
}

databaseTest(
  "a payment's journal built again from its stored rows equals the journal its posting wrote",
  async () => {
    const f = await paymentFixture();
    try {
      // A Customer dimension, so every line carries the party.
      const [dimension] = await f.db
        .insertInto("dimension")
        .values({
          name: "Customer",
          entityType: "Customer",
          companyGroupId: f.groupId,
          createdBy: "system"
        })
        .returning("id")
        .execute();
      // An intercompany customer with an empty Intercompany Receivables
      // default, after the cutover: the control falls back to receivables.
      await f.db
        .updateTable("customer")
        .set({ intercompanyCompanyId: f.companyId })
        .where("id", "=", f.customerId)
        .where("companyId", "=", f.companyId)
        .execute();
      // 165 EUR at 1.1 is 150 base: 100 settles the invoice and 50 stays on
      // account.
      const paymentId = await f.payment({ amount: 165 });
      const { journalId } = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });

      const posted = await postedLines(f, journalId!);
      expect(posted).toEqual([
        {
          accountId: f.account("control"),
          amount: -100,
          description: "Accounts Receivable",
          accountDefaultRole: null,
          documentLineReference: f.invoiceId,
          dimensions: [{ dimensionId: dimension!.id, valueId: f.customerId }]
        },
        {
          accountId: f.account("control"),
          amount: -50,
          description: "Accounts Receivable (on-account credit)",
          accountDefaultRole: null,
          documentLineReference: null,
          dimensions: [{ dimensionId: dimension!.id, valueId: f.customerId }]
        },
        {
          accountId: f.account("bank"),
          amount: 150,
          description: "Bank / Cash",
          accountDefaultRole: null,
          documentLineReference: null,
          dimensions: [{ dimensionId: dimension!.id, valueId: f.customerId }]
        }
      ]);
      expect(await rebuilt(f, paymentId)).toEqual(posted);
    } finally {
      // An intercompany customer refuses its delete.
      await f.db
        .updateTable("customer")
        .set({ intercompanyCompanyId: null })
        .where("id", "=", f.customerId)
        .where("companyId", "=", f.companyId)
        .execute();
      await f.cleanup();
    }
  }
);

databaseTest(
  "two targets whose control lines stand in for different defaults keep their own roles",
  async () => {
    const f = await paymentFixture();
    try {
      await f.db
        .updateTable("companySettings")
        .set({ accountingCutoverDate: null })
        .where("id", "=", f.companyId)
        .execute();
      // Two invoices whose control lines are stand-ins on the same account,
      // each naming another default.
      const first = await f.invoice();
      const second = await f.invoice();
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await sql`UPDATE "journalLine" SET "accountDefaultRole" =
            CASE "documentId" WHEN ${first} THEN 'intercompanyReceivablesAccount'
              ELSE 'contractAssetAccount' END
          WHERE "companyId" = ${f.companyId}
            AND "documentId" IN (${first}, ${second})
            AND "accountId" = ${f.account("control")}`.execute(trx);
      });
      // 275 EUR at 1.1: 100 base to each invoice and 50 on account, on the
      // same receivables account as both stand-ins.
      const paymentId = await f.payment({ amount: 275, invoiceId: first });
      await f.db
        .insertInto("invoiceSettlement")
        .values({
          paymentId,
          targetSalesInvoiceId: second,
          sourceAmount: 110,
          appliedAmount: 100,
          sourceExchangeRate: 99,
          targetExchangeRate: 99,
          appliedDate: "2026-09-01",
          companyId: f.companyId,
          createdBy: "system"
        })
        .execute();
      const { journalId } = await postPaymentTransaction(f.db, {
        ...f.args,
        paymentId
      });

      const roles = (lines: Awaited<ReturnType<typeof postedLines>>) =>
        lines
          .filter((line) => line.accountId === f.account("control"))
          .map(({ documentLineReference, accountDefaultRole }) => ({
            documentLineReference,
            accountDefaultRole
          }))
          .sort((a, b) =>
            (a.documentLineReference ?? "").localeCompare(
              b.documentLineReference ?? ""
            )
          );
      const expected = [
        // The new on-account credit wants the receivables default, which is
        // set: no stand-in.
        { documentLineReference: null, accountDefaultRole: null },
        {
          documentLineReference: first,
          accountDefaultRole: "intercompanyReceivablesAccount"
        },
        {
          documentLineReference: second,
          accountDefaultRole: "contractAssetAccount"
        }
      ].sort((a, b) =>
        (a.documentLineReference ?? "").localeCompare(
          b.documentLineReference ?? ""
        )
      );
      expect(roles(await postedLines(f, journalId!))).toEqual(expected);
      expect(roles(await rebuilt(f, paymentId))).toEqual(expected);
    } finally {
      await f.cleanup();
    }
  }
);
