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

/** A document is posted from Draft; Pending is a post in flight or one that died. */
const POSTABLE = ["Draft", "Pending"];

export function isPostableStatus(status: string | null | undefined): boolean {
  return POSTABLE.includes(status ?? "");
}

/**
 * Refuses to post a document that has already been posted, voided or settled.
 *
 * Called BEFORE the posting function's `try`: its failure handler puts the
 * document back to Draft, and a document refused for already being Posted must
 * not be — its ledger and journal rows stand, and as a Draft it could be edited
 * and posted a second time. A document that does not exist is left to the
 * function's own not-found handling.
 */
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
  if (document && !isPostableStatus(document.status)) {
    throw new ServerFnError(
      `Cannot post: it is already ${document.status}`,
      409
    );
  }
}
