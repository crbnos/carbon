import { type Kysely, sql } from "kysely";
import type { DB } from "../lib/database.ts";
import { datetime } from "../lib/datetime.ts";
import { postCharge } from "./post-charge-post.ts";
import { voidCharge } from "./post-charge-void.ts";

export type PostChargeArgs = {
  type: "post" | "void";
  chargeId: string;
  companyId: string;
  userId: string;
};

export function postChargeTransaction(
  db: Kysely<DB>,
  args: PostChargeArgs,
): Promise<{ journalId: string | null }> {
  const { type, chargeId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read. The line mutation trigger
    // takes the same parent lock, so every snapshot below is stable.
    const charge = await trx.selectFrom("charge")
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
        sql<string | null>`"postingDate"::text`.as("postingDate"),
      ])
      .where("id", "=", chargeId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!charge) throw new Error("Charge not found");

    if (type === "post" && charge.status === "Posted") {
      return { journalId: charge.journalId };
    }
    if (type === "void" && charge.status === "Voided") {
      return { journalId: charge.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (charge.status !== expectedStatus) {
      throw new Error(
        `Cannot ${type} charge in status ${charge.status}`,
      );
    }

    const settings = await trx.selectFrom("companySettings").select(
      "accountingEnabled",
    ).where("id", "=", companyId).executeTakeFirst();
    if (!settings) {
      throw new Error("Charge company settings not found");
    }

    const company = await trx.selectFrom("company").select([
      "companyGroupId",
      "baseCurrencyCode",
      "timezone",
    ]).where("id", "=", companyId).executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Charge company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      charge,
      company,
      accountingEnabled: settings.accountingEnabled,
      companyId,
      userId,
      timestamp,
      today,
    };

    return type === "post"
      ? await postCharge(context)
      : await voidCharge(context);
  });
}
