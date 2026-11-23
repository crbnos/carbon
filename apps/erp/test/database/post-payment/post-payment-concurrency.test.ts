// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { sql } from "kysely";
import { databaseTest } from "../fixtures/local-database";
import { paymentFixture } from "../fixtures/payment";
import { postPaymentTransaction } from "../../../app/modules/invoicing/invoicing.service";

databaseTest(
  "independent concurrent invoice consumers cannot overspend one posted credit source",
  async () => {
    const f = await paymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const secondInvoiceId = await f.invoice();
      const sourceId = await f.payment({
        amount: 110,
        rate: 1,
        noApplication: true
      });
      await postPaymentTransaction(f.db, { ...f.args, paymentId: sourceId });
      const firstId = await f.payment({ amount: 0, rate: 1.5 });
      const secondId = await f.payment({
        amount: 0,
        rate: 1.5,
        invoiceId: secondInvoiceId
      });
      const attempts = await Promise.allSettled([
        postPaymentTransaction(left, { ...f.args, paymentId: firstId }),
        postPaymentTransaction(right, { ...f.args, paymentId: secondId })
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled").length
      ).toEqual(1);
      const rejected = attempts.find(
        (attempt) => attempt.status === "rejected"
      );
      if (rejected?.status !== "rejected") {
        throw new Error("Expected exhausted source rejection");
      }
      expect(/fund|exceed|insufficient/i.test(String(rejected.reason))).toEqual(
        true
      );
      const posted = await f.db
        .selectFrom("payment")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("id", "in", [firstId, secondId])
        .where("status", "=", "Posted")
        .execute();
      expect(posted.length).toEqual(1);
      const consumption = await f.db
        .selectFrom("invoiceSettlement as s")
        .innerJoin("payment as p", "p.id", "s.paymentId")
        .select(["s.sourceAmount", "s.appliedAmount", "s.fxGainLossAmount"])
        .where("s.companyId", "=", f.companyId)
        .where("s.sourcePaymentId", "=", sourceId)
        .where("p.status", "=", "Posted")
        .execute();
      expect(
        consumption.reduce((sum, row) => sum + Number(row.sourceAmount), 0)
      ).toEqual(110);
      expect(
        consumption.reduce(
          (sum, row) =>
            sum + Number(row.appliedAmount) + Number(row.fxGainLossAmount),
          0
        )
      ).toEqual(110);
      const paymentJournals = await f.db
        .selectFrom("journal")
        .select("id")
        .where("companyId", "=", f.companyId)
        .where("sourceType", "=", "Payment")
        .execute();
      expect(paymentJournals.length).toEqual(2);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);

databaseTest(
  "concurrent retries of one payment create exactly one journal and funding allocation",
  async () => {
    const f = await paymentFixture();
    const left = await f.connect();
    const right = await f.connect();
    try {
      const paymentId = await f.payment();
      const results = await Promise.all([
        postPaymentTransaction(left, { ...f.args, paymentId }),
        postPaymentTransaction(right, { ...f.args, paymentId })
      ]);
      expect(results[0].journalId).toEqual(results[1].journalId);
      expect(
        (
          await f.db
            .selectFrom("invoiceSettlement")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("paymentId", "=", paymentId)
            .execute()
        ).length
      ).toEqual(1);
      expect(
        (
          await f.db
            .selectFrom("journal")
            .select("id")
            .where("companyId", "=", f.companyId)
            .where("sourceType", "=", "Payment")
            .execute()
        ).length
      ).toEqual(1);
    } finally {
      await left.destroy();
      await right.destroy();
      await f.cleanup();
    }
  }
);


for (const type of ["post", "void"] as const) {
  databaseTest(`payment ${type} takes the activation lock before locking its document`, async () => {
    const f = await paymentFixture();
    const activation = await f.connect();
    const worker = await f.connect();
    const monitor = await f.connect();
    let running: Promise<unknown> | undefined;
    let holding: Promise<void> | undefined;
    let release!: () => void;
    let locked!: () => void;
    const lockedPromise = new Promise<void>((resolve) => {locked=resolve;});
    const releasePromise = new Promise<void>((resolve) => {release=resolve;});
    try {
      const paymentId = await f.payment();
      if (type === "void") await postPaymentTransaction(f.db,{...f.args,paymentId});
      const {rows:[workerPid]} = await sql<{pid:number}>`SELECT pg_backend_pid() AS pid`.execute(worker);
      holding = activation.transaction().execute(async (trx) => {
        await trx.selectFrom("companySettings").select("id").where("id","=",f.companyId).forUpdate().executeTakeFirstOrThrow();
        locked();
        await releasePromise;
        await sql`SELECT id FROM payment WHERE id=${paymentId} AND "companyId"=${f.companyId} FOR UPDATE NOWAIT`.execute(trx);
      });
      void holding.catch(() => {});
      await lockedPromise;
      running = postPaymentTransaction(worker,{...f.args,paymentId,type});
      // Prevent an early rejection from becoming unhandled while monitoring locks.
      void running.catch(() => {});
      const deadline = performance.now()+10000;
      let blocked = false;
      while (performance.now()<deadline) {
        const {rows:[state]} = await sql<{blocked:boolean}>`SELECT cardinality(pg_blocking_pids(${workerPid!.pid})) > 0 AS blocked`.execute(monitor);
        if (state?.blocked) {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      expect(blocked).toBe(true);
      release();
      await holding;
      await running;
      expect(await f.db.selectFrom("payment").select("status").where("id","=",paymentId).where("companyId","=",f.companyId).executeTakeFirstOrThrow()).toEqual({status:type === "post" ? "Posted":"Voided"});
      expect(await f.db.selectFrom("journal").select("id").where("companyId","=",f.companyId).where("sourceType","=","Payment").execute()).toHaveLength(type === "post" ? 1:2);
    } finally {
      release?.();
      await running?.catch(()=>{});
      await activation.destroy();await worker.destroy();await monitor.destroy();await f.cleanup();
    }
  });
}
