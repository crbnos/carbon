import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { databaseTest, paymentFixture } from "./payment-test-fixture.ts";
import { postPaymentTransaction } from "./post-payment-transaction.ts";
import { postMemoTransaction } from "../post-memo/post-memo-transaction.ts";

type Fixture = Awaited<ReturnType<typeof paymentFixture>>;
async function party(f: Fixture, isAR: boolean) {
  if (isAR) {
    await f.db.updateTable("accountDefault").set({
      salesDiscountAccount: f.account("discount"),
    }).where("companyId", "=", f.companyId).execute();
    return { id: f.customerId, control: f.account("control") };
  }
  const supplier = await f.db.insertInto("supplier").values({
    name: "Refund supplier",
    companyId: f.companyId,
  }).returning("id").executeTakeFirstOrThrow();
  const control = f.account("payable");
  await f.db.insertInto("account").values({
    id: control,
    name: "AP",
    class: "Liability",
    incomeBalance: "Balance Sheet",
    companyGroupId: f.groupId,
    createdBy: "system",
  }).execute();
  await f.db.updateTable("accountDefault").set({
    payablesAccount: control,
    supplierPaymentDiscountAccount: f.account("discount"),
    supplierWriteOffAccount: f.account("sales"),
  }).where("companyId", "=", f.companyId).execute();
  return { id: supplier.id, control };
}
async function memo(
  f: Fixture,
  isAR: boolean,
  partyId: string,
  amount: number,
  rate: number,
) {
  const id = crypto.randomUUID();
  await f.db.insertInto("memo").values({
    id,
    memoId: id,
    companyId: f.companyId,
    customerId: isAR ? partyId : null,
    supplierId: isAR ? null : partyId,
    direction: isAR ? "Credit" : "Debit",
    memoDate: "2026-09-07",
    currencyCode: "EUR",
    exchangeRate: rate,
    amount,
    createdBy: "system",
  }).execute();
  await postMemoTransaction(f.db, { ...f.args, memoId: id });
  return id;
}
for (const isAR of [true, false]) {
  databaseTest(
    `${
      isAR ? "AR" : "AP"
    } memo refund uses original carrying and cash FX, blocks memo void, then reverses`,
    async () => {
      const f = await paymentFixture();
      try {
        const p = await party(f, isAR);
        const memoId = await memo(f, isAR, p.id, 55, 1.1);
        const paymentId = await f.payment({
          amount: 55,
          rate: 1.25,
          noApplication: true,
        });
        await f.db.updateTable("payment").set({
          paymentType: isAR ? "Disbursement" : "Receipt",
          customerId: isAR ? p.id : null,
          supplierId: isAR ? null : p.id,
        }).where("id", "=", paymentId).where("companyId", "=", f.companyId)
          .execute();
        await f.db.insertInto("invoiceSettlement").values({
          paymentId,
          targetMemoId: memoId,
          sourceAmount: 55,
          appliedAmount: 50,
          sourceExchangeRate: 1.25,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system",
        }).execute();
        const changedControl = isAR
          ? f.account("bank")
          : f.account("changed-payable");
        if (!isAR) {
          await f.db.insertInto("account").values({
            id: changedControl,
            name: "New AP default",
            class: "Liability",
            incomeBalance: "Balance Sheet",
            companyGroupId: f.groupId,
            createdBy: "system",
          }).execute();
        }
        await f.db.updateTable("accountDefault").set(
          isAR
            ? { receivablesAccount: changedControl }
            : { payablesAccount: changedControl },
        ).where("companyId", "=", f.companyId).execute();
        const posted = await postPaymentTransaction(f.db, {
          ...f.args,
          paymentId,
        });
        const settlement = await f.db.selectFrom("invoiceSettlement").select([
          "sourceAmount",
          "appliedAmount",
          "fxGainLossAmount",
          "targetMemoId",
          "sourcePaymentId",
        ]).where("paymentId", "=", paymentId).executeTakeFirstOrThrow();
        assertEquals(settlement, {
          sourceAmount: 55,
          appliedAmount: 50,
          fxGainLossAmount: isAR ? 6 : -6,
          targetMemoId: memoId,
          sourcePaymentId: null,
        });
        const lines = await f.db.selectFrom("journalLine").select([
          "accountId",
          "amount",
        ]).where("journalId", "=", posted.journalId!).execute();
        assertEquals(
          lines.find((line) => line.accountId === p.control)?.amount,
          50,
        );
        assertEquals(
          lines.find((line) => line.accountId === f.account("bank"))?.amount,
          isAR ? -44 : 44,
        );
        const excessive = await f.payment({
          amount: 55,
          rate: 1.25,
          noApplication: true,
        });
        await f.db.updateTable("payment").set({
          paymentType: isAR ? "Disbursement" : "Receipt",
          customerId: isAR ? p.id : null,
          supplierId: isAR ? null : p.id,
        }).where("id", "=", excessive).where("companyId", "=", f.companyId)
          .execute();
        await f.db.insertInto("invoiceSettlement").values({
          paymentId: excessive,
          targetMemoId: memoId,
          sourceAmount: 55,
          appliedAmount: 50,
          sourceExchangeRate: 1.25,
          targetExchangeRate: 1.1,
          appliedDate: "2026-09-07",
          companyId: f.companyId,
          createdBy: "system",
        }).execute();
        await assertRejects(
          () =>
            postPaymentTransaction(f.db, { ...f.args, paymentId: excessive }),
          Error,
        );
        assertEquals(
          (await f.db.selectFrom("payment").select("status").where(
            "id",
            "=",
            excessive,
          ).executeTakeFirstOrThrow()).status,
          "Draft",
        );
        await assertRejects(
          () => postMemoTransaction(f.db, { ...f.args, type: "void", memoId }),
          Error,
          "consumed memo",
        );
        const reversed = await postPaymentTransaction(f.db, {
          ...f.args,
          type: "void",
          paymentId,
        });
        const reversal = await f.db.selectFrom("journalLine").select([
          "accountId",
          "amount",
        ]).where("journalId", "=", reversed.journalId!).execute();
        assertEquals(
          reversal.find((line) => line.accountId === p.control)?.amount,
          -50,
        );
        await postMemoTransaction(f.db, { ...f.args, type: "void", memoId });
      } finally {
        await f.cleanup();
      }
    },
  );
}

for (const isAR of [true, false]) {
  databaseTest(
    `${
      isAR ? "AR" : "AP"
    } final memo document cent posts when its carrying remainder is zero`,
    async () => {
      const f = await paymentFixture();
      try {
        const p = await party(f, isAR);
        const memoId = await memo(f, isAR, p.id, 160.01, 16000);
        let invoiceId: string;
        if (isAR) {
          invoiceId = await f.invoice({ amount: 0.010000625, rate: 16000 });
        } else {
          invoiceId = crypto.randomUUID();
          const interaction = await f.db.insertInto("supplierInteraction")
            .values({ supplierId: p.id, companyId: f.companyId }).returning(
              "id",
            ).executeTakeFirstOrThrow();
          await f.db.insertInto("purchaseInvoice").values({
            id: invoiceId,
            invoiceId,
            supplierId: p.id,
            supplierInteractionId: interaction.id,
            currencyCode: "EUR",
            exchangeRate: 16000,
            status: "Open",
            companyId: f.companyId,
            createdBy: "system",
          }).execute();
          await f.db.insertInto("purchaseInvoiceLine").values({
            invoiceId,
            invoiceLineType: "G/L Account",
            quantity: .16001,
            supplierUnitPrice: 1000,
            exchangeRate: 16000,
            accountId: f.account("loss"),
            companyId: f.companyId,
            createdBy: "system",
          }).execute();
          const period = await f.db.selectFrom("accountingPeriod").select("id")
            .where("companyId", "=", f.companyId).executeTakeFirstOrThrow();
          const journal = await f.db.insertInto("journal").values({
            journalEntryId: invoiceId,
            accountingPeriodId: period.id,
            companyId: f.companyId,
            sourceType: "Purchase Invoice",
            status: "Posted",
            postingDate: "2026-09-07",
            createdBy: "system",
          }).returning("id").executeTakeFirstOrThrow();
          await f.db.insertInto("journalLine").values(
            [{ accountId: p.control, description: "Accounts Payable" }, {
              accountId: f.account("loss"),
              description: "Invoice offset",
            }].map((line) => ({
              ...line,
              amount: .01,
              quantity: 1,
              journalId: journal.id,
              documentId: invoiceId,
              documentType: "Invoice" as const,
              journalLineReference: invoiceId,
              companyId: f.companyId,
            })),
          ).execute();
        }
        for (const [sourceAmount, appliedAmount] of [[160, .01], [.01, 0]]) {
          const paymentId = await f.payment({
            amount: 0,
            rate: 16000,
            noApplication: true,
          });
          if (!isAR) {
            await f.db.updateTable("payment").set({
              paymentType: "Disbursement",
              customerId: null,
              supplierId: p.id,
            }).where("id", "=", paymentId).where("companyId", "=", f.companyId)
              .execute();
          }
          await f.db.insertInto("invoiceSettlement").values({
            memoId,
            appliedViaPaymentId: paymentId,
            targetSalesInvoiceId: isAR ? invoiceId : null,
            targetPurchaseInvoiceId: isAR ? null : invoiceId,
            sourceAmount,
            appliedAmount,
            sourceExchangeRate: 16000,
            targetExchangeRate: 16000,
            appliedDate: "2026-09-07",
            companyId: f.companyId,
            createdBy: "system",
          }).execute();
          await postPaymentTransaction(f.db, { ...f.args, paymentId });
        }
        const rows = await f.db.selectFrom("invoiceSettlement").select([
          "sourceAmount",
          "appliedAmount",
        ]).where("memoId", "=", memoId).execute();
        assertEquals(
          rows.reduce((sum, row) => sum + Number(row.sourceAmount), 0),
          160.01,
        );
        assertEquals(
          rows.reduce((sum, row) => sum + Number(row.appliedAmount), 0),
          .01,
        );
      } finally {
        await f.cleanup();
      }
    },
  );
}
