// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Customer part numbers (`customerPartToItem`). Mirrors the New Customer Part
// drawer on a part's Sales tab: `customerPartValidator` and
// `upsertItemCustomerPart`. A customer has one part number per item (the
// unique key is customerId + itemId), so a row for a pair that already has
// one updates it. Only parts have customer part numbers. The table has no
// audit columns.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import { type Kysely, sql } from "kysely";
import { inChunks } from "./chunks";
import {
  cell,
  type ImportRecord,
  type ImportSummary,
  type ItemCandidate,
  loadItemIndex,
  resolveItem
} from "./existing-item";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

// Only a part's Sales tab has customer part numbers.
export const CUSTOMER_PART_ITEM_TYPES = ["Part"] as const;

export const customerPartKey = (customerId: string, itemId: string) =>
  `${customerId}::${itemId}`;

export type CustomerPartRow = {
  customerId: string;
  itemId: string;
  customerPartId: string;
  customerPartRevision: string;
};

export type CustomerPartRowDecision =
  | { action: "upsert"; row: CustomerPartRow }
  | { action: "error"; reason: string };

export function classifyCustomerPartRow(params: {
  record: ImportRecord;
  itemIndex: Map<string, ItemCandidate[]>;
  // (customer, item) pairs already written by an earlier row of the file.
  seenKeys: Set<string>;
}): CustomerPartRowDecision {
  const { record, itemIndex, seenKeys } = params;
  const error = (reason: string): CustomerPartRowDecision => ({
    action: "error",
    reason
  });

  const item = resolveItem(itemIndex, record, CUSTOMER_PART_ITEM_TYPES);
  if ("error" in item) return error(item.error);

  const customerId = cell(record.customerId);
  if (!customerId) return error("Missing required Customer");

  const customerPartId = cell(record.customerPartId);
  if (!customerPartId) return error("Missing required Customer Part Number");

  if (seenKeys.has(customerPartKey(customerId, item.itemId))) {
    return error(
      `Duplicate customer part number for ${item.readableId} rev ${item.revision} and this customer in file`
    );
  }

  return {
    action: "upsert",
    row: {
      customerId,
      itemId: item.itemId,
      customerPartId,
      // The column's default; the drawer leaves it blank.
      customerPartRevision: cell(record.customerPartRevision)
    }
  };
}

export async function importCustomerParts(
  db: Kysely<KyselyDatabase>,
  args: {
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    summary: ImportSummary;
  }
): Promise<void> {
  const { rows, companyId, summary } = args;

  const itemIndex = await loadItemIndex(
    db,
    companyId,
    rows.map(([, record]) => record)
  );

  const seenKeys = new Set<string>();
  const upserts: CustomerPartRow[] = [];
  for (const [row, record] of rows) {
    const decision = classifyCustomerPartRow({ record, itemIndex, seenKeys });
    if (decision.action === "error") {
      summary.errors.push({ row, reason: decision.reason });
      continue;
    }
    seenKeys.add(customerPartKey(decision.row.customerId, decision.row.itemId));
    upserts.push(decision.row);
  }

  logger.info({
    function: "import-customer-parts",
    totalRecords: rows.length,
    upserts: upserts.length
  });

  if (upserts.length === 0) return;

  const existing = await db
    .selectFrom("customerPartToItem")
    .select(["customerId", "itemId"])
    .where("companyId", "=", companyId)
    .where("itemId", "in", [...new Set(upserts.map((u) => u.itemId))])
    .where("customerId", "in", [...new Set(upserts.map((u) => u.customerId))])
    .execute();
  const existingKeys = new Set(
    existing.map((e) => customerPartKey(e.customerId, e.itemId))
  );

  await inTransaction(db, async (trx) => {
    await inChunks(upserts, (chunk) =>
      trx
        .insertInto("customerPartToItem")
        .values(chunk.map((row) => ({ ...row, companyId })))
        .onConflict((oc) =>
          oc.columns(["customerId", "itemId"]).doUpdateSet({
            customerPartId: sql`excluded."customerPartId"`,
            customerPartRevision: sql`excluded."customerPartRevision"`
          })
        )
        .execute()
    );
    for (const row of upserts) {
      if (existingKeys.has(customerPartKey(row.customerId, row.itemId))) {
        summary.updated += 1;
      } else {
        summary.inserted += 1;
      }
    }
  });
}
