// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { connectLocalTestDatabase } from "../local-database-test-fixture";

export async function paymentFixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `accttest-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const customerId = `${prefix}-customer`;
  const invoiceId = `${prefix}-invoice`;
  const periodId = `${prefix}-period`;
  const employeeTypeId = `${prefix}-employee-type`;
  const employeeId = `${prefix}-employee`;
  const account = (name: string) => `${prefix}-${name}`;
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({
        id: groupId,
        name: prefix,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values(
        ["USD", "EUR"].map((code) => ({
          code,
          decimalPlaces: 2,
          companyGroupId: groupId,
          createdBy: "system"
        }))
      )
      .execute();
    await trx
      .insertInto("account")
      .values(
        [
          { name: "bank", class: "Asset" as const },
          { name: "control", class: "Asset" as const },
          { name: "sales", class: "Revenue" as const },
          { name: "gain", class: "Revenue" as const },
          { name: "loss", class: "Expense" as const },
          { name: "discount", class: "Expense" as const },
          { name: "writeoff", class: "Expense" as const },
          // The segregated employee-payable control, plus a coding account for a
          // reimbursement's expense line.
          { name: "employee-payable", class: "Liability" as const },
          { name: "travel", class: "Expense" as const }
        ].map((row) => ({
          id: account(row.name),
          name: row.name,
          class: row.class,
          incomeBalance:
            row.class === "Asset" || row.class === "Liability"
              ? ("Balance Sheet" as const)
              : ("Income Statement" as const),
          companyGroupId: groupId,
          createdBy: "system"
        }))
      )
      .execute();
    await sql`INSERT INTO "accountDefault" SELECT (jsonb_populate_record(NULL::"accountDefault",
      (SELECT jsonb_object_agg(attname, to_jsonb(${account(
        "control"
      )}::text)) FROM pg_attribute
       WHERE attrelid='"accountDefault"'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull AND attname<>'companyId')
      || jsonb_build_object('companyId', ${companyId}::text, 'receivablesAccount', ${account(
        "control"
      )}::text,
         'salesAccount', ${account("sales")}::text, 'bankCashAccount', ${account(
           "bank"
         )}::text,
         'realizedExchangeGainAccount', ${account(
           "gain"
         )}::text, 'realizedExchangeLossAccount', ${account("loss")}::text,
         'customerPaymentDiscountAccount', ${account(
           "discount"
         )}::text, 'customerWriteOffAccount', ${account("writeoff")}::text,
         'payablesAccount', ${account(
           "employee-payable"
         )}::text, 'employeeReimbursementsPayableAccount', ${account(
           "employee-payable"
         )}::text))).*`.execute(trx);
    await trx
      .insertInto("companySettings")
      // A company keeping its ledger in Carbon: it has an accounting cutover,
      // so its journals post as Posted. No activation stamp, so the fixture
      // can still change the cutover (the one-way lock keys on it).
      .values({
        id: companyId,
        accountingCutoverDate: "2000-01-01"
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          accountingCutoverDate: "2000-01-01"
        })
      )
      .execute();
    await trx
      .insertInto("accountingPeriod")
      .values({
        id: periodId,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        status: "Active",
        closeStatus: "Open",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("sequence")
      .values({
        table: "journalEntry",
        name: "Test journals",
        prefix: "TEST-",
        companyId
      })
      .execute();
    await trx
      .insertInto("customer")
      .values({
        id: customerId,
        name: prefix,
        companyId
      })
      .execute();
    // `employeeType` carries a SECURITY DEFINER interceptor
    // (`sync_create_employee_type_group`) that inserts a `membership` row
    // pointing at a company-level `group` the real onboarding path creates and
    // this fixture does not. `app.sync_in_progress` does not suppress it, so
    // the inserts run with triggers off — the same escape hatch `cleanup()`
    // already uses, restored immediately.
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    await trx
      .insertInto("employeeType")
      .values({
        id: employeeTypeId,
        name: prefix,
        companyId
      })
      .execute();
    await trx
      .insertInto("employee")
      .values({
        id: employeeId,
        employeeTypeId,
        companyId
      })
      .execute();
    await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    await trx
      .insertInto("salesInvoice")
      .values({
        id: invoiceId,
        invoiceId: "TEST-INVOICE",
        customerId,
        currencyCode: "EUR",
        exchangeRate: 1.1,
        status: "Submitted",
        companyId,
        createdBy: "system"
      })
      .execute();
    await trx
      .insertInto("salesInvoiceLine")
      .values({
        invoiceId,
        invoiceLineType: "Service",
        quantity: 1,
        unitPrice: 100,
        unitOfMeasureCode: "EA",
        companyId,
        createdBy: "system"
      })
      .execute();
    const journal = await trx
      .insertInto("journal")
      .values({
        journalEntryId: "TEST-ORIGINAL",
        accountingPeriodId: periodId,
        companyId,
        sourceType: "Sales Invoice",
        status: "Posted",
        postingDate: "2026-09-01",
        createdBy: "system"
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("journalLine")
      .values(
        [
          { accountId: account("control"), description: "Accounts Receivable" },
          { accountId: account("sales"), description: "Sales" }
        ].map((row) => ({
          ...row,
          amount: 100,
          quantity: 1,
          documentType: "Invoice" as const,
          documentId: invoiceId,
          journalLineReference: `${prefix}-reference`,
          journalId: journal.id,
          companyId
        }))
      )
      .execute();
  });
  const args = {
    type: "post" as const,
    companyId,
    userId: "system",
    today: "2026-09-07"
  };
  return {
    db,
    args,
    companyId,
    groupId,
    invoiceId,
    customerId,
    employeeId,
    account,
    connect: connectLocalTestDatabase,
    async payment(
      input: {
        amount?: number;
        rate?: number;
        status?: "Draft" | "Posted";
        sourceAmount?: number;
        appliedAmount?: number;
        targetRate?: number;
        noApplication?: boolean;
        sourcePaymentId?: string;
        invoiceId?: string;
      } = {}
    ) {
      const id = `${prefix}-payment-${crypto.randomUUID()}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("payment")
          .values({
            id,
            paymentId: id,
            paymentType: "Receipt",
            customerId,
            paymentDate: "2026-09-01",
            postingDate: "2026-09-01",
            currencyCode: "EUR",
            totalAmount: input.amount ?? 110,
            exchangeRate: input.rate ?? 1.1,
            bankAccount: account("bank"),
            status: input.status ?? "Draft",
            companyId,
            createdBy: "system"
          })
          .execute();
        if (!input.noApplication) {
          await trx
            .insertInto("invoiceSettlement")
            .values({
              paymentId: id,
              targetSalesInvoiceId: input.invoiceId ?? invoiceId,
              sourceAmount: input.sourceAmount ?? 110,
              appliedAmount: input.appliedAmount ?? 100,
              sourcePaymentId: input.sourcePaymentId,
              sourceExchangeRate: 99,
              targetExchangeRate: input.targetRate ?? 99,
              appliedDate: "2026-09-01",
              companyId,
              createdBy: "system"
            })
            .execute();
        }
      });
      return id;
    },
    /** A POSTED reimbursement with one expense coding line and the journal the
     *  post-reimbursement path would have written — the employee payable
     *  CREDITED for the total, which is the carrying value a payout draws
     *  down. `payableAccountId` is stamped on the row, as posting does.
     *
     *  `reimbursement_draft_guard` forbids inserting anything but a Draft and
     *  only allows the Draft → Posted transition to also change `journalId`,
     *  `postingDate` and `payableAccountId` — so this seeds exactly the way
     *  the real posting path does rather than fighting the trigger.
     *
     *  `journalPayableAccountId` lets a test book the journal to a DIFFERENT
     *  account than the row records, which is the divergence the payout must
     *  refuse. */
    async reimbursement(
      input: {
        amount?: number;
        rate?: number;
        status?: "Draft" | "Posted";
        payableAccountId?: string;
        journalPayableAccountId?: string;
        controlDescription?: string;
        withJournal?: boolean;
      } = {}
    ) {
      const id = `${prefix}-reimbursement-${crypto.randomUUID()}`;
      const amount = input.amount ?? 620;
      const rate = input.rate ?? 1;
      const status = input.status ?? "Posted";
      const payableAccountId =
        input.payableAccountId ?? account("employee-payable");
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("reimbursement")
          .values({
            id,
            reimbursementId: id,
            employeeId,
            status: "Draft",
            reimbursementDate: "2026-09-01",
            currencyCode: "EUR",
            exchangeRate: rate,
            amount,
            companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("reimbursementLine")
          .values({
            reimbursementId: id,
            accountId: account("travel"),
            amount,
            companyId,
            createdBy: "system"
          })
          .execute();
        if (status === "Draft") return;
        let journalId: string | null = null;
        if (input.withJournal !== false) {
          const journal = await trx
            .insertInto("journal")
            .values({
              journalEntryId: id,
              accountingPeriodId: periodId,
              companyId,
              sourceType: "Reimbursement",
              status: "Posted",
              postingDate: "2026-09-01",
              createdBy: "system"
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          journalId = journal.id;
          // Natural-balance signed, exactly as build-reimbursement-journal
          // emits: the expense coding line DEBITED — `debit("expense", x)` is
          // `+x`, since a POSITIVE amount on an Expense account is a debit —
          // and the payable CREDITED, `credit("liability", x)` also `+x`.
          // Both store positive here; the sign alone does not tell you the
          // side, the account's class does.
          await trx
            .insertInto("journalLine")
            .values(
              [
                {
                  accountId: account("travel"),
                  description: "Travel",
                  amount: amount / rate
                },
                {
                  accountId: input.journalPayableAccountId ?? payableAccountId,
                  description:
                    input.controlDescription ??
                    "Employee reimbursement payable",
                  amount: amount / rate
                }
              ].map((row) => ({
                ...row,
                quantity: 1,
                documentType: "Reimbursement" as const,
                documentId: id,
                journalLineReference: id,
                journalId: journal.id,
                companyId
              }))
            )
            .execute();
        }
        // `reimbursement_lifecycle_audit_check` requires postingDate/postedAt/
        // postedBy on a Posted row; all three are in the draft guard's allowed
        // change set for the Draft -> Posted transition.
        await trx
          .updateTable("reimbursement")
          .set({
            status: "Posted",
            postingDate: "2026-09-01",
            postedAt: "2026-09-01T00:00:00Z",
            postedBy: "system",
            payableAccountId,
            journalId
          })
          .where("id", "=", id)
          .where("companyId", "=", companyId)
          .execute();
      });
      return id;
    },
    /** A Draft employee disbursement with one application against a
     *  reimbursement. Rates are deliberately forged (99) so the posting path
     *  has to overwrite them, like the AR `payment()` helper. */
    async reimbursementPayment(input: {
      reimbursementId: string;
      amount?: number;
      rate?: number;
      appliedAmount?: number;
      sourceAmount?: number;
      discountAmount?: number;
      noApplication?: boolean;
    }) {
      const id = `${prefix}-payout-${crypto.randomUUID()}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("payment")
          .values({
            id,
            paymentId: id,
            paymentType: "Disbursement",
            employeeId,
            paymentDate: "2026-09-01",
            currencyCode: "EUR",
            totalAmount: input.amount ?? 620,
            exchangeRate: input.rate ?? 1,
            bankAccount: account("bank"),
            status: "Draft",
            companyId,
            createdBy: "system"
          })
          .execute();
        if (input.noApplication) return;
        await trx
          .insertInto("invoiceSettlement")
          .values({
            paymentId: id,
            targetReimbursementId: input.reimbursementId,
            sourceAmount: input.sourceAmount ?? null,
            appliedAmount: input.appliedAmount ?? 620,
            discountAmount: input.discountAmount ?? 0,
            sourceExchangeRate: 99,
            targetExchangeRate: 99,
            appliedDate: "2026-09-01",
            companyId,
            createdBy: "system"
          })
          .execute();
      });
      return id;
    },
    async invoice(
      input: {
        amount?: number;
        rate?: number;
        controlDescription?: string;
      } = {}
    ) {
      const id = `${prefix}-invoice-${crypto.randomUUID()}`;
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("salesInvoice")
          .values({
            id,
            invoiceId: id,
            customerId,
            currencyCode: "EUR",
            exchangeRate: input.rate ?? 1.1,
            status: "Submitted",
            companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("salesInvoiceLine")
          .values({
            invoiceId: id,
            invoiceLineType: "Service",
            quantity: 1,
            unitPrice: input.amount ?? 100,
            unitOfMeasureCode: "EA",
            companyId,
            createdBy: "system"
          })
          .execute();
        const journal = await trx
          .insertInto("journal")
          .values({
            journalEntryId: id,
            accountingPeriodId: periodId,
            companyId,
            sourceType: "Sales Invoice",
            status: "Posted",
            postingDate: "2026-09-01",
            createdBy: "system"
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("journalLine")
          .values(
            [
              {
                accountId: account("control"),
                description: input.controlDescription ?? "Accounts Receivable"
              },
              { accountId: account("sales"), description: "Sales" }
            ].map((row) => ({
              ...row,
              amount: input.amount ?? 100,
              quantity: 1,
              documentType: "Invoice" as const,
              documentId: id,
              journalLineReference: id,
              journalId: journal.id,
              companyId
            }))
          )
          .execute();
      });
      return id;
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        // Test-owned committed journals are immutable. Temporarily bypass only
        // for their cleanup status update; restore normal FK cascades immediately.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        // `reimbursement_draft_guard` refuses to DELETE a Posted row, and the
        // company delete below cascades into it. Walk them back to Draft here,
        // inside the same trigger-free window, so the cascade stays a normal
        // FK cascade rather than needing triggers off for the whole teardown.
        await trx
          .updateTable("reimbursement")
          .set({
            status: "Draft",
            journalId: null,
            postingDate: null,
            postedAt: null,
            postedBy: null
          })
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
