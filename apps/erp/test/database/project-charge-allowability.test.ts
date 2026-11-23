// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { sql } from "kysely";
import { expect } from "vitest";
import {
  postChargeTransaction,
  postReimbursementTransaction
} from "../../app/modules/accounting/accounting.service";
import { postPurchaseInvoice } from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import { handlesOf } from "./fixtures/handles";
import { databaseTest } from "./fixtures/local-database";
import { projectPostingFixture } from "./fixtures/project-posting";

type Fixture = Awaited<ReturnType<typeof projectPostingFixture>>;

/** A travel account and an Expressly Unallowable entertainment account. */
async function allowabilityFixture() {
  const f = await projectPostingFixture({ costTreatment: "Contract" });
  await f.db
    .insertInto("account")
    .values(
      (
        [
          ["card", "Card liability", "Liability", "Allowable"],
          ["reimb-payable", "Reimbursements payable", "Liability", "Allowable"],
          ["travel", "Travel", "Expense", "Allowable"],
          ["entertainment", "Entertainment", "Expense", "Expressly Unallowable"]
        ] as const
      ).map(([key, name, accountClass, allowability]) => ({
        id: f.account(key),
        name,
        class: accountClass,
        incomeBalance:
          accountClass === "Expense"
            ? ("Income Statement" as const)
            : ("Balance Sheet" as const),
        allowability,
        companyGroupId: f.groupId,
        createdBy: "system"
      }))
    )
    .execute();
  return f;
}

/** The project's ledger rows, as [amount, unallowable], largest first. */
async function ledgerFlags(f: Fixture) {
  const rows = await f.db
    .selectFrom("projectLedger")
    .select(["amount", "unallowable"])
    .where("companyId", "=", f.companyId)
    .where("projectId", "=", f.projectId)
    .orderBy("amount", "desc")
    .execute();
  return rows.map((row) => [Number(row.amount), row.unallowable]);
}

databaseTest(
  "a card charge line on an Expressly Unallowable account makes its ledger row unallowable",
  async () => {
    const f = await allowabilityFixture();
    try {
      const chargeId = `${f.prefix}-charge`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .insertInto("charge")
          .values({
            id: chargeId,
            chargeId: `${f.prefix}-CH`,
            type: "Charge",
            status: "Draft",
            cardAccountId: f.account("card"),
            transactionDate: "2026-09-11",
            currencyCode: "USD",
            exchangeRate: 1,
            amount: 80,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("chargeLine")
          .values(
            (
              [
                ["entertainment", 50],
                ["travel", 30]
              ] as const
            ).map(([key, amount], sequence) => ({
              id: `${chargeId}-${sequence}`,
              chargeId,
              accountId: f.account(key),
              projectId: f.projectId,
              projectElementId: f.elementId,
              description: key,
              amount,
              sequence,
              companyId: f.companyId,
              createdBy: "system"
            }))
          )
          .execute();
      });

      await postChargeTransaction(f.db, {
        type: "post",
        chargeId,
        companyId: f.companyId,
        userId: "system"
      });

      expect(await ledgerFlags(f)).toEqual([
        [50, true],
        [30, false]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a reimbursement line on an Expressly Unallowable account makes its ledger row unallowable",
  async () => {
    const f = await allowabilityFixture();
    try {
      const reimbursementId = `${f.prefix}-reimbursement`;
      const employeeTypeId = `${f.prefix}-employee-type`;
      await f.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .insertInto("employeeType")
          .values({
            id: employeeTypeId,
            name: "Employee",
            companyId: f.companyId
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await trx
          .insertInto("employee")
          .values({
            id: "system",
            companyId: f.companyId,
            employeeTypeId,
            active: true
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx
          .updateTable("accountDefault")
          .set({
            employeeReimbursementsPayableAccount: f.account("reimb-payable")
          })
          .where("companyId", "=", f.companyId)
          .execute();
        await trx
          .insertInto("reimbursement")
          .values({
            id: reimbursementId,
            reimbursementId: `${f.prefix}-RB`,
            employeeId: "system",
            status: "Draft",
            reimbursementDate: "2026-09-11",
            currencyCode: "USD",
            exchangeRate: 1,
            amount: 100,
            companyId: f.companyId,
            createdBy: "system"
          })
          .execute();
        await trx
          .insertInto("reimbursementLine")
          .values(
            (
              [
                ["entertainment", 25],
                ["travel", 75]
              ] as const
            ).map(([key, amount], sequence) => ({
              id: `${reimbursementId}-${sequence}`,
              reimbursementId,
              accountId: f.account(key),
              projectId: f.projectId,
              projectElementId: f.elementId,
              description: key,
              amount,
              sequence,
              companyId: f.companyId,
              createdBy: "system"
            }))
          )
          .execute();
      });

      await postReimbursementTransaction(f.db, {
        type: "post",
        reimbursementId,
        companyId: f.companyId,
        userId: "system"
      });

      expect(await ledgerFlags(f)).toEqual([
        [75, false],
        [25, true]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);

databaseTest(
  "a G/L Account invoice line on an Expressly Unallowable account makes its ledger row unallowable",
  async () => {
    const f = await allowabilityFixture();
    try {
      const { locationId } = await f.addStockedItem("filler", {
        quantity: 1,
        unitCost: 1
      });
      const po = await f.addPurchaseOrder("a", { locationId, lines: [] });
      const invoice = await f.addPurchaseInvoice("a", {
        supplierId: po.supplierId,
        lines: [
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("entertainment"),
            quantity: 1,
            unitPrice: 60,
            locationId,
            charged: true
          },
          {
            invoiceLineType: "G/L Account",
            accountId: f.account("travel"),
            quantity: 1,
            unitPrice: 40,
            locationId,
            charged: true
          }
        ]
      });

      const posted = await invokePosting(
        handlesOf(f.ctx),
        "post-purchase-invoice",
        { invoiceId: invoice.invoiceId },
        postPurchaseInvoice
      );
      expect(posted.error).toBeNull();

      expect(await ledgerFlags(f)).toEqual([
        [60, true],
        [40, false]
      ]);
    } finally {
      await f.cleanup();
    }
  }
);
