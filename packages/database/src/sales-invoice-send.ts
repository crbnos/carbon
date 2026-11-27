// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client.ts";

export type SalesInvoiceSendLock<T> =
  | { locked: true; result: T }
  | { locked: false };

/**
 * Runs `send` while this caller holds the invoice's send lock, or returns
 * `{ locked: false }` without running it when another caller holds it.
 *
 * The daily recurring-billing job, invoice-automate and a person's Send or
 * Post share no other lock, so each can read an unsent invoice and send it:
 * the customer got the invoice twice. Under the lock, `send` must read
 * `sentAt` again (another sender can finish between a caller's first read
 * and the lock) and skip a sent invoice.
 *
 * The lock is a transaction-scoped advisory lock, not a column, so:
 * - A worker that dies mid-send (a deploy, a timeout) loses its connection,
 *   and with it the lock. The invoice still reads as unsent, so a retry or a
 *   Send sends it.
 * - Nothing about the invoice changes while a send is in flight: `sentAt`
 *   means the invoice was sent.
 *
 * The transaction writes nothing. `send` writes its stamps through its own
 * client, so they commit as soon as they are written and before the lock is
 * released: the next caller reads them. An email or Stripe call inside it is
 * not undone by a rollback, because there is nothing to roll back.
 *
 * `db` must be a Kysely client, not a transaction: the lock is held on one
 * connection of its pool for as long as `send` runs.
 */
export async function withSalesInvoiceSendLock<T>(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string },
  send: () => Promise<T>
): Promise<SalesInvoiceSendLock<T>> {
  return runUnderSendLock(db, args, send, "try");
}

/** How long a job waits for another sender before its step fails and is
 *  retried: longer than a send takes, shorter than a step may run. */
const SEND_LOCK_WAIT = "30s";

/**
 * `withSalesInvoiceSendLock` for a job: waits for another sender to finish
 * instead of returning at once. The job then reads `sentAt` under the lock and
 * skips an invoice the other sender sent, or sends one it did not (it failed,
 * or its worker died). Returning "not sent" at once instead left the job's
 * step done with nothing sent, and nothing sent the invoice after a failed
 * holder. A wait longer than SEND_LOCK_WAIT throws (lock_timeout), so the step
 * fails and Inngest retries it.
 */
export async function waitForSalesInvoiceSendLock<T>(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string },
  send: () => Promise<T>
): Promise<T> {
  const sent = await runUnderSendLock(db, args, send, "wait");
  if (!sent.locked) throw new Error("The send lock was not taken");
  return sent.result;
}

async function runUnderSendLock<T>(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; invoiceId: string },
  send: () => Promise<T>,
  mode: "try" | "wait"
): Promise<SalesInvoiceSendLock<T>> {
  const key = `salesInvoiceSend:${args.companyId}:${args.invoiceId}`;
  let sent: { locked: true; result: T } | undefined;
  try {
    return await db.transaction().execute(async (trx) => {
      if (mode === "wait") {
        await sql`SELECT set_config('lock_timeout', ${SEND_LOCK_WAIT}, true)`.execute(
          trx
        );
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
          trx
        );
      } else {
        const lock = await sql<{ locked: boolean }>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked
        `.execute(trx);
        if (!lock.rows[0]?.locked) return { locked: false } as const;
      }
      sent = { locked: true, result: await send() };
      return sent;
    });
  } catch (error) {
    // The send finished and stamped the invoice; only ending the
    // transaction failed. A lost connection releases the lock too, so the
    // send's outcome stands rather than reading as a failed send.
    if (sent) return sent;
    throw error;
  }
}
