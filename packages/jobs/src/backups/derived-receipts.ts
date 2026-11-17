// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";

/**
 * Recomputes `receipt.inspectionStatus` and `receipt.rejectedAtInspection` for
 * every receipt of the company that has inspection lots, after a load. The
 * refresh normally runs from an interceptor on `inspection`, which a load with
 * triggers off never fires, and an inspection has no foreign key to its
 * receipt, so with triggers on a lot can load before its receipt. A backup
 * taken before `rejectedAtInspection` existed carries no value for it at all.
 * Idempotent.
 */
export async function refreshReceiptInspectionStatuses(
  trx: Kysely<KyselyDatabase>,
  companyId: string
): Promise<void> {
  await sql`
    SELECT public.refresh_receipt_inspection_status(r."id")
    FROM "receipt" r
    WHERE r."companyId" = ${companyId}
      AND EXISTS (
        SELECT 1 FROM "inspection" i
        WHERE i."sourceDocument" = 'Receipt'
          AND i."sourceDocumentId" = r."id"
          AND i."companyId" = ${companyId}
      )
    ORDER BY r."id"
  `.execute(trx);
}
