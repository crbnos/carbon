// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./client.ts";

// Deliveries of one item against one purchase order on one day that still get
// a generated number. Past it a line is left for the receiver to number.
const MAX_SAME_DAY = 20;

/** `PO000123-20261116`: the purchase order and the day (`YYYY-MM-DD`) received. */
export function receiptBatchNumberBase(
  purchaseOrderReadableId: string,
  receivedOn: string
): string {
  return `${purchaseOrderReadableId}-${receivedOn.replaceAll("-", "")}`;
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

  // An entity written before `itemId` existed names its item in
  // `sourceDocumentId` only.
  const itemOf = sql<string>`coalesce("itemId", "sourceDocumentId")`;
  const taken = await trx
    .selectFrom("trackedEntity")
    .select([itemOf.as("itemId"), "readableId"])
    .where("companyId", "=", companyId)
    .where("readableId", "in", receiptBatchNumberCandidates(base))
    .where(itemOf, "in", [...new Set(lines.map((line) => line.itemId))])
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

/**
 * Keeps each batch a Draft receipt is creating (one with no stock movements)
 * at its line's received quantity, settling the status as `update_receipt_line_batch_tracking` does.
 * A batch numbered before the quantity was entered (a generated one) would
 * otherwise keep the quantity it was numbered with, and labels print it.
 */
export async function syncReceiptBatchQuantities(
  trx: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    receiptId: string;
    lines: { id: string; receivedQuantity: number }[];
  }
): Promise<void> {
  const { companyId, receiptId, lines } = args;
  if (lines.length === 0) return;
  await sql`
    UPDATE "trackedEntity" te
    SET "quantity" = v.quantity,
        "status" = CASE
          WHEN v.quantity <= 0 AND te."status" NOT IN ('Scrapped', 'Rejected')
            THEN 'Consumed'
          WHEN v.quantity > 0 AND te."status" = 'Consumed' THEN 'On Hold'
          ELSE te."status"
        END::"trackedEntityStatus"
    FROM unnest(
      ${lines.map((line) => line.id)}::text[],
      ${lines.map((line) => line.receivedQuantity)}::numeric[]
    ) AS v(line_id, quantity)
    WHERE te."companyId" = ${companyId}
      AND te."attributes" @> ${JSON.stringify({ Receipt: receiptId })}::jsonb
      AND te."attributes" ->> 'Receipt Line' = v.line_id
      -- Only batches the receipt is creating: a returned or transferred batch
      -- is existing stock whose quantity the receipt does not own.
      AND NOT EXISTS (
        SELECT 1 FROM "itemLedger" il
        WHERE il."trackedEntityId" = te.id AND il."companyId" = te."companyId"
      )
  `.execute(trx);
}
