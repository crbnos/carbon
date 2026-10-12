// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { ServerFnError } from "../errors";

type PostableTable =
  | "receipt"
  | "shipment"
  | "purchaseInvoice"
  | "salesInvoice";

/** Call BEFORE the posting function's `try`: its failure handler resets the
 *  document to Draft, which must not happen to one that is already posted. */
export async function assertPostable(
  db: Kysely<KyselyDatabase>,
  table: PostableTable,
  id: string,
  companyId: string
): Promise<void> {
  const document = await db
    .selectFrom(table)
    .select(["status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (document && !["Draft", "Pending"].includes(document.status ?? "")) {
    throw new ServerFnError(
      `Cannot post: it is already ${document.status}`,
      409
    );
  }
}
