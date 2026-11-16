// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client.ts";

// Deliveries of one item against one purchase order on one day that still get
// a generated number. Past it a line is left for the receiver to number.
const MAX_SAME_DAY = 20;

/** `PO000123-20261116`: the purchase order and the day it was received. */
export function receiptBatchNumberBase(
  purchaseOrderReadableId: string,
  receivedOn: { year: number; month: number; day: number }
): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${purchaseOrderReadableId}-${pad(receivedOn.year, 4)}${pad(receivedOn.month)}${pad(receivedOn.day)}`;
}

export function receiptBatchNumberCandidates(base: string): string[] {
  return Array.from({ length: MAX_SAME_DAY }, (_, i) =>
    i === 0 ? base : `${base}-${i + 1}`
  );
}

/**
 * Each line's batch number: the base, or the base with the first free `-n`
 * when the item already has a batch by that number (an earlier delivery the
 * same day, or another line of the same item). Batch numbers are unique per
 * item, so different items on one delivery share the base.
 */
export function planReceiptBatchNumbers(
  base: string,
  lines: { id: string; itemId: string }[],
  taken: { itemId: string | null; readableId: string | null }[]
): Map<string, string> {
  const key = (itemId: string, readableId: string) =>
    `${itemId}\u0000${readableId}`;
  const used = new Set(
    taken.flatMap((t) =>
      t.itemId && t.readableId ? [key(t.itemId, t.readableId)] : []
    )
  );
  const candidates = receiptBatchNumberCandidates(base);
  const numbers = new Map<string, string>();
  for (const line of lines) {
    const free = candidates.find((c) => !used.has(key(line.itemId, c)));
    if (!free) continue;
    used.add(key(line.itemId, free));
    numbers.set(line.id, free);
  }
  return numbers;
}

/**
 * Gives the batch-tracked lines of a new purchase order receipt their
 * generated batch numbers. Run it in the transaction that inserts the lines,
 * so a retried create never leaves numbered batches behind on its own.
 */
export async function assignReceiptBatchNumbers(
  trx: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    receiptId: string;
    purchaseOrderId: string;
    base: string;
    lines: { id: string; itemId: string; receivedQuantity: number }[];
  }
): Promise<void> {
  const { companyId, receiptId, purchaseOrderId, base, lines } = args;
  if (lines.length === 0) return;

  // Two receipts of one purchase order created at once would read the same
  // free numbers: take them one at a time.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`receipt-batch-numbers:${purchaseOrderId}`}))`.execute(
    trx
  );

  const taken = await trx
    .selectFrom("trackedEntity")
    .select(["itemId", "readableId"])
    .where("companyId", "=", companyId)
    .where("readableId", "in", receiptBatchNumberCandidates(base))
    .where("itemId", "in", [...new Set(lines.map((line) => line.itemId))])
    .execute();

  const numbers = planReceiptBatchNumbers(base, lines, taken);
  const numbered = lines.filter((line) => numbers.has(line.id));
  if (numbered.length === 0) return;

  // The same function the receiver's edits go through, so a generated batch
  // is shaped (attributes, status, expiry) exactly like a typed one.
  await sql`
    SELECT public.update_receipt_line_batch_tracking(
      v.line_id, ${receiptId}, v.batch_number, v.quantity
    )
    FROM unnest(
      ${numbered.map((line) => line.id)}::text[],
      ${numbered.map((line) => numbers.get(line.id)!)}::text[],
      ${numbered.map((line) => line.receivedQuantity)}::numeric[]
    ) AS v(line_id, batch_number, quantity)
  `.execute(trx);
}
