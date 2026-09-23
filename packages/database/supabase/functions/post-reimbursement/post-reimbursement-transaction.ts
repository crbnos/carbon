import { type Kysely, sql } from "kysely";
import type { DB } from "../lib/database.ts";
import { datetime } from "../lib/datetime.ts";
import { postReimbursement } from "./post-reimbursement-post.ts";
import { voidReimbursement } from "./post-reimbursement-void.ts";

export type PostReimbursementArgs = {
  type: "post" | "void";
  reimbursementId: string;
  companyId: string;
  userId: string;
};

export function postReimbursementTransaction(
  db: Kysely<DB>,
  args: PostReimbursementArgs,
): Promise<{ journalId: string | null }> {
  const { type, reimbursementId, companyId, userId } = args;
  return db.transaction().execute(async (trx) => {
    // This is deliberately the first database read, and it is scoped to
    // `companyId` — a reimbursement id from another tenant is simply not found.
    // The line mutation trigger takes the same parent lock, so every snapshot
    // below is stable.
    const reimbursement = await trx.selectFrom("reimbursement")
      .select([
        "id",
        "reimbursementId",
        "employeeId",
        "status",
        "amount",
        "currencyCode",
        "exchangeRate",
        "payableAccountId",
        "journalId",
        sql<string>`"reimbursementDate"::text`.as("reimbursementDate"),
        sql<string | null>`"postingDate"::text`.as("postingDate"),
      ])
      .where("id", "=", reimbursementId)
      .where("companyId", "=", companyId)
      .forUpdate()
      .executeTakeFirst();
    if (!reimbursement) throw new Error("Reimbursement not found");

    // Re-posting a Posted row and re-voiding a Voided row both return the
    // stored journal id without writing a second journal.
    if (type === "post" && reimbursement.status === "Posted") {
      return { journalId: reimbursement.journalId };
    }
    if (type === "void" && reimbursement.status === "Voided") {
      return { journalId: reimbursement.journalId };
    }
    const expectedStatus = type === "post" ? "Draft" : "Posted";
    if (reimbursement.status !== expectedStatus) {
      throw new Error(
        `Cannot ${type} reimbursement in status ${reimbursement.status}`,
      );
    }

    const settings = await trx.selectFrom("companySettings").select(
      "accountingEnabled",
    ).where("id", "=", companyId).executeTakeFirst();
    if (!settings) {
      throw new Error("Reimbursement company settings not found");
    }

    const company = await trx.selectFrom("company").select([
      "companyGroupId",
      "baseCurrencyCode",
      "timezone",
    ]).where("id", "=", companyId).executeTakeFirst();
    if (!company?.companyGroupId) {
      throw new Error("Reimbursement company configuration not found");
    }

    const timestamp = datetime.timestamp();
    const today = datetime.today(company.timezone).toString();
    const context = {
      trx,
      reimbursement,
      company,
      accountingEnabled: settings.accountingEnabled,
      companyId,
      userId,
      timestamp,
      today,
    };

    return type === "post"
      ? await postReimbursement(context)
      : await voidReimbursement(context);
  });
}
