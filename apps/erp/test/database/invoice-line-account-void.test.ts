// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A void of an invoice whose line changed account, against the live
// database: the void reverses the change with the posting, and a void that
// starts while a change is writing waits for it, rather than reversing only
// the lines it read before the change committed.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";
import { sql } from "kysely";
import { expect } from "vitest";
import {
  changeInvoiceLineAccount,
  postPurchaseInvoice,
  postSalesInvoice
} from "../../app/modules/invoicing/invoicing.service";
import { invokePosting } from "../../app/modules/shared/shared.service";
import {
  alwaysPostFixture,
  type Fixture,
  postServiceInvoice,
  postSuppliesInvoice,
  seed,
  USER
} from "./fixtures/always-post";
import { handlesOf, systemServiceOf } from "./fixtures/handles";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

// The service invoice posts 100 to Sales, the supplies invoice 60 to Supplies.
const SIDES = [
  { side: "sales", from: "sales", control: "receivables", amount: 100 },
  { side: "purchase", from: "supplies", control: "payables", amount: 60 }
] as const;

type Side = (typeof SIDES)[number]["side"];

/** A posted invoice of `side`, its line, and a second account of the line's
 *  class to move it to. */
async function postedInvoice(f: Fixture, side: Side) {
  const invoiceId =
    side === "sales" ? await postServiceInvoice(f) : await postSuppliesInvoice(f);
  const line =
    side === "sales"
      ? await f.db
          .selectFrom("salesInvoiceLine")
          .select("id")
          .where("invoiceId", "=", invoiceId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow()
      : await f.db
          .selectFrom("purchaseInvoiceLine")
          .select("id")
          .where("invoiceId", "=", invoiceId)
          .where("companyId", "=", f.companyId)
          .executeTakeFirstOrThrow();
  const to = `${f.prefix}-moved-to`;
  await seed(f, (trx) =>
    trx
      .insertInto("account")
      .values({
        id: to,
        name: "moved-to",
        class: side === "sales" ? "Revenue" : "Expense",
        incomeBalance: "Income Statement",
        companyGroupId: f.groupId,
        createdBy: USER
      })
      .execute()
  );
  return { invoiceId, lineId: line.id, to };
}

function voidInvoice(f: Fixture, side: Side, invoiceId: string) {
  return side === "sales"
    ? invokePosting(
        handlesOf(f.ctx),
        "post-sales-invoice",
        { type: "void", invoiceId },
        postSalesInvoice
      )
    : invokePosting(
        handlesOf(f.ctx),
        "post-purchase-invoice",
        { type: "void", invoiceId },
        postPurchaseInvoice
      );
}

/** The invoice's journal lines summed per account, as stored. */
async function netByAccount(f: Fixture, invoiceId: string) {
  const lines = await f.db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Invoice")
    .where("documentId", "=", invoiceId)
    .execute();
  const net: Record<string, number> = {};
  for (const line of lines) {
    const key = line.accountId ?? "none";
    // + 0 turns a -0 into 0.
    net[key] = round((net[key] ?? 0) + Number(line.amount)) + 0;
  }
  return net;
}

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function backendPid(db: Kysely<KyselyDatabase>) {
  const { rows } = await sql<{
    pid: number;
  }>`SELECT pg_backend_pid() AS pid`.execute(db);
  return rows[0]!.pid;
}

async function waitForBlockedConnection(
  db: Kysely<KyselyDatabase>,
  blockerPid: number,
  waitingPid: number
) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    const { rows } = await sql<{ blocked: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
          AND pid = ${waitingPid}
      ) AS blocked
    `.execute(db);
    if (rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database connection to wait for the held lock");
}

for (const { side, from, control, amount } of SIDES) {
  databaseTest(
    `a ${side} invoice void reverses a line account change with the posting`,
    async () => {
      const f = await alwaysPostFixture();
      try {
        const { invoiceId, lineId, to } = await postedInvoice(f, side);
        await changeInvoiceLineAccount(f.service, {
          side,
          invoiceId,
          lineId,
          accountId: to
        });
        expect(await netByAccount(f, invoiceId)).toEqual({
          [f.account(from)]: 0,
          [to]: amount,
          [f.account(control)]: amount
        });

        expect((await voidInvoice(f, side, invoiceId)).error).toBeNull();
        expect(await netByAccount(f, invoiceId)).toEqual({
          [f.account(from)]: 0,
          [to]: 0,
          [f.account(control)]: 0
        });
      } finally {
        await f.cleanup();
      }
    }
  );

  databaseTest(
    `a ${side} invoice void that starts while a line account change writes waits for it and reverses it`,
    async () => {
      const f = await alwaysPostFixture();
      const changer = await connectLocalTestDatabase();
      const holder = await connectLocalTestDatabase();
      const monitor = await connectLocalTestDatabase();
      const held = signal();
      const release = signal();
      let holding: Promise<void> | undefined;
      let changing: ReturnType<typeof changeInvoiceLineAccount> | undefined;
      let voiding: ReturnType<typeof voidInvoice> | undefined;
      try {
        const { invoiceId, lineId, to } = await postedInvoice(f, side);
        const holderPid = await backendPid(holder);
        const changerPid = await backendPid(changer);
        const voidPid = await backendPid(f.db);

        // The journal entry sequence, held: the change stops there, after it
        // has locked the invoice.
        holding = holder.transaction().execute(async (trx) => {
          await trx
            .selectFrom("sequence")
            .select("table")
            .where("table", "=", "journalEntry")
            .where("companyId", "=", f.companyId)
            .forUpdate()
            .execute();
          held.resolve();
          await release.promise;
        });
        void holding.catch(() => {});
        await Promise.race([held.promise, holding]);

        changing = changeInvoiceLineAccount(
          systemServiceOf(
            { db: changer, companyId: f.companyId, userId: USER },
            f.groupId
          ),
          { side, invoiceId, lineId, accountId: to }
        );
        void changing.catch(() => {});
        await waitForBlockedConnection(monitor, holderPid, changerPid);

        voiding = voidInvoice(f, side, invoiceId);
        void voiding.catch(() => {});
        // The void waits on the invoice the change holds.
        await waitForBlockedConnection(monitor, changerPid, voidPid);

        release.resolve();
        await holding;
        expect(await changing).toMatchObject({ toAccountId: to });
        expect((await voiding).error).toBeNull();
        expect(await netByAccount(f, invoiceId)).toEqual({
          [f.account(from)]: 0,
          [to]: 0,
          [f.account(control)]: 0
        });
      } finally {
        release.resolve();
        await holding?.catch(() => {});
        await changing?.catch(() => {});
        await voiding?.catch(() => {});
        await changer.destroy();
        await holder.destroy();
        await monitor.destroy();
        await f.cleanup();
      }
    }
  );
}

async function journalCount(f: Fixture, invoiceId: string) {
  const { count } = await f.db
    .selectFrom("journalLine")
    .select((eb) => eb.fn.count<string>("journalId").distinct().as("count"))
    .where("companyId", "=", f.companyId)
    .where("documentType", "=", "Invoice")
    .where("documentId", "=", invoiceId)
    .executeTakeFirstOrThrow();
  return Number(count);
}

for (const { side, from, control } of SIDES) {
  databaseTest(`a second void of a ${side} invoice is refused`, async () => {
    const f = await alwaysPostFixture();
    try {
      const { invoiceId } = await postedInvoice(f, side);
      expect((await voidInvoice(f, side, invoiceId)).error).toBeNull();

      expect((await voidInvoice(f, side, invoiceId)).error).not.toBeNull();
      expect(await journalCount(f, invoiceId)).toBe(2);
      expect(await netByAccount(f, invoiceId)).toEqual({
        [f.account(from)]: 0,
        [f.account(control)]: 0
      });
    } finally {
      await f.cleanup();
    }
  });
}
