// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { journalPostingStatus } from "@carbon/database/journal-posting-status";
import { datetime } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { NotFoundError } from "../errors";
import { postChargeJournal } from "./post-charge-post";
import { voidCharge } from "./post-charge-void";

export type PostChargeArgs = {
  type: "post" | "void";
  chargeId: string;
  companyId: string;
  userId: string;
};

export function postChargeTransaction(
  db: Kysely<KyselyDatabase>,
  args: PostChargeArgs
): Promise<{ journalId: string | null }> {
  const { type, chargeId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read. The line mutation trigger
    // takes the same parent lock, so every snapshot below is stable.
    const charge = await trx
      .selectFrom("charge")
      .select([
        "id",
        "chargeId",
        "type",
        "status",
        "amount",
        "cardAccountId",
        "offsetAccountId",
        "currencyCode",
        "exchangeRate",
        "journalId",
        sql<string>`"transactionDate"::text`.as("transactionDate"),
        sql<string | null>`"postingDate"::text`.as("postingDate")
      ])
      .where("id", "=", chargeId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!charge) throw new NotFoundError("Charge not found");

    if (type === "post" && charge.status === "Posted") {
      return { journalId: charge.journalId };
    }
    if (type === "void" && charge.status === "Voided") {
      return { journalId: charge.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (charge.status !== expectedStatus) {
      throw new Error(`Cannot ${type} charge in status ${charge.status}`);
    }

    // Every posting writes a journal: Provisional before the company's
    // accounting cutover, Posted after it. FOR SHARE holds the status until
    // commit.
    const postingStatus = await journalPostingStatus(trx, companyId);

    const company = await trx
      .selectFrom("company")
      .select(["companyGroupId", "baseCurrencyCode", "timezone"])
      .where("id", "=", companyId)
      .executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Charge company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      charge,
      company,
      postingStatus,
      companyId,
      userId,
      timestamp,
      today
    };

    return type === "post"
      ? await postChargeJournal(context)
      : await voidCharge(context);
  });
}
