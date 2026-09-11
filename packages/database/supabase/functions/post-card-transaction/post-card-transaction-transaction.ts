import type { Kysely } from "kysely";
import type { DB } from "../lib/database.ts";
import { datetime } from "../lib/datetime.ts";
import { postCardTransaction } from "./post-card-transaction-post.ts";
import { voidCardTransaction } from "./post-card-transaction-void.ts";

export type PostCardTransactionArgs = {
  type: "post" | "void";
  cardTransactionId: string;
  companyId: string;
  userId: string;
};

export function postCardTransactionTransaction(
  db: Kysely<DB>,
  args: PostCardTransactionArgs,
): Promise<{ journalId: string | null }> {
  const { type, cardTransactionId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read. The line mutation trigger
    // takes the same parent lock, so every snapshot below is stable.
    const cardTransaction = await trx.selectFrom("cardTransaction").selectAll()
      .where("id", "=", cardTransactionId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!cardTransaction) throw new Error("Card transaction not found");

    if (type === "post" && cardTransaction.status === "Posted") {
      return { journalId: cardTransaction.journalId };
    }
    if (type === "void" && cardTransaction.status === "Voided") {
      return { journalId: cardTransaction.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (cardTransaction.status !== expectedStatus) {
      throw new Error(
        `Cannot ${type} card transaction in status ${cardTransaction.status}`,
      );
    }

    const settings = await trx.selectFrom("companySettings").select(
      "accountingEnabled",
    ).where("id", "=", companyId).executeTakeFirst();
    if (!settings) {
      throw new Error("Card transaction company settings not found");
    }

    const company = await trx.selectFrom("company").select([
      "companyGroupId",
      "baseCurrencyCode",
      "timezone",
    ]).where("id", "=", companyId).executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Card transaction company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      cardTransaction,
      company,
      accountingEnabled: settings.accountingEnabled,
      companyId,
      userId,
      timestamp,
      today,
    };

    return type === "post"
      ? await postCardTransaction(context)
      : await voidCardTransaction(context);
  });
}
