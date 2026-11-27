// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  waitForSalesInvoiceSendLock,
  withSalesInvoiceSendLock
} from "@carbon/database/sales-invoice-send";
import { expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "./fixtures/local-database";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// The daily job, invoice-automate and a person's Send each run on their own
// connection: two connections, or the lock is never contended.
databaseTest(
  "a second sender is refused while the first holds the invoice's send lock",
  async () => {
    const first = await connectLocalTestDatabase();
    const second = await connectLocalTestDatabase();
    const invoice = {
      companyId: `send-lock-${crypto.randomUUID()}`,
      invoiceId: "inv-1"
    };
    const inside = signal();
    const finish = signal();
    try {
      const holding = withSalesInvoiceSendLock(first, invoice, async () => {
        inside.resolve();
        await finish.promise;
        return "sent";
      });
      await inside.promise;

      let ranAgain = false;
      expect(
        await withSalesInvoiceSendLock(second, invoice, async () => {
          ranAgain = true;
          return "sent again";
        })
      ).toEqual({ locked: false });
      expect(ranAgain).toBe(false);

      // Another invoice of the company is not held up.
      expect(
        await withSalesInvoiceSendLock(
          second,
          { ...invoice, invoiceId: "inv-2" },
          async () => "other"
        )
      ).toEqual({ locked: true, result: "other" });

      finish.resolve();
      expect(await holding).toEqual({ locked: true, result: "sent" });

      // Released with the first sender's transaction.
      expect(
        await withSalesInvoiceSendLock(second, invoice, async () => "next")
      ).toEqual({ locked: true, result: "next" });
    } finally {
      finish.resolve();
      await first.destroy();
      await second.destroy();
    }
  }
);

databaseTest(
  "a job's sender waits for the first sender and then runs",
  async () => {
    const first = await connectLocalTestDatabase();
    const second = await connectLocalTestDatabase();
    const invoice = {
      companyId: `send-lock-${crypto.randomUUID()}`,
      invoiceId: "inv-1"
    };
    const inside = signal();
    const finish = signal();
    const order: string[] = [];
    try {
      const holding = withSalesInvoiceSendLock(first, invoice, async () => {
        inside.resolve();
        await finish.promise;
        order.push("first");
        return "sent";
      });
      await inside.promise;

      // Under the lock the job reads sentAt again, so it skips an invoice
      // the first sender sent and sends one it did not.
      const waiting = waitForSalesInvoiceSendLock(second, invoice, async () => {
        order.push("second");
        return "checked";
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(order).toEqual([]);

      finish.resolve();
      expect(await holding).toEqual({ locked: true, result: "sent" });
      expect(await waiting).toBe("checked");
      expect(order).toEqual(["first", "second"]);
    } finally {
      finish.resolve();
      await first.destroy();
      await second.destroy();
    }
  }
);
