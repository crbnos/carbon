// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A live-database USD company with EUR configured, the four revaluation
// account defaults, an accounting cutover of 2026-01-01 and an October 2026
// period — the smallest company a currency revaluation run can read.
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { Insertable } from "kysely";
import { sql } from "kysely";
import { connectLocalTestDatabase } from "./local-database";
import { FILLER_ACCOUNT_DEFAULTS } from "./post-reimbursement";

const USER = "system";

export type RevaluationFixtureAccount =
  | "misc"
  | "ar"
  | "ap"
  | "arRevaluation"
  | "apRevaluation"
  | "gain"
  | "loss"
  | "eurBank"
  | "siblingEurBank"
  | "cta"
  | "ctaOffset";

export async function currencyRevaluationFixture(): Promise<{
  db: Kysely<KyselyDatabase>;
  companyId: string;
  companyGroupId: string;
  periodId: string;
  accounts: Record<RevaluationFixtureAccount, string>;
  postJournal(args: {
    sourceType: "Manual" | "Currency Revaluation";
    postingDate: string;
    lines: { accountId: string; amount: number }[];
  }): Promise<string>;
  cleanup(): Promise<void>;
}> {
  const db = await connectLocalTestDatabase();
  const prefix = `fxrevfx-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
  const companyId = `${prefix}-company`;
  const groupId = `${prefix}-group`;
  const periodId = `${prefix}-period`;

  const accountSpecs: Record<
    RevaluationFixtureAccount,
    {
      class: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
      currency?: string;
    }
  > = {
    misc: { class: "Asset" },
    ar: { class: "Asset" },
    ap: { class: "Liability" },
    arRevaluation: { class: "Asset" },
    apRevaluation: { class: "Liability" },
    gain: { class: "Revenue" },
    loss: { class: "Expense" },
    eurBank: { class: "Asset", currency: "EUR" },
    // Flagged EUR in the shared chart, but this company never posts to it.
    siblingEurBank: { class: "Asset", currency: "EUR" },
    cta: { class: "Equity" },
    ctaOffset: { class: "Equity" }
  };
  const accounts = Object.fromEntries(
    Object.keys(accountSpecs).map((key) => [key, `${prefix}-acct-${key}`])
  ) as Record<RevaluationFixtureAccount, string>;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    await trx
      .insertInto("company")
      .values({
        id: companyId,
        name: prefix,
        companyGroupId: groupId,
        baseCurrencyCode: "USD",
        timezone: "America/New_York"
      })
      .execute();
    await trx
      .insertInto("currency")
      .values(
        ["USD", "EUR"].map((code) => ({
          code,
          decimalPlaces: 2,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("companySettings")
      .values({ id: companyId, accountingCutoverDate: "2026-01-01" })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({ accountingCutoverDate: "2026-01-01" })
      )
      .execute();
    await trx
      .insertInto("account")
      .values(
        Object.entries(accountSpecs).map(([key, spec]) => ({
          id: accounts[key as RevaluationFixtureAccount],
          name: `${prefix} ${key}`,
          class: spec.class,
          incomeBalance:
            spec.class === "Revenue" || spec.class === "Expense"
              ? ("Income Statement" as const)
              : ("Balance Sheet" as const),
          currencyCode: spec.currency ?? null,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("accountDefault")
      .values({
        companyId,
        ...Object.fromEntries(
          FILLER_ACCOUNT_DEFAULTS.map((column) => [column, accounts.misc])
        ),
        receivablesAccount: accounts.ar,
        payablesAccount: accounts.ap,
        employeeReimbursementsPayableAccount: accounts.ap,
        arRevaluationAccount: accounts.arRevaluation,
        apRevaluationAccount: accounts.apRevaluation,
        unrealizedExchangeGainAccount: accounts.gain,
        unrealizedExchangeLossAccount: accounts.loss
      } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
      .execute();
    // The run and CTA journals take their numbers from it.
    await trx
      .insertInto("sequence")
      .values({
        table: "journalEntry",
        name: "Journal Entry",
        prefix: "JE",
        next: 0,
        size: 6,
        step: 1,
        companyId
      })
      .execute();
    await trx
      .insertInto("accountingPeriod")
      .values({
        id: periodId,
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        companyId,
        createdBy: USER
      })
      .execute();
  });

  let journalCount = 0;
  return {
    db,
    companyId,
    companyGroupId: groupId,
    periodId,
    accounts,
    async postJournal({ sourceType, postingDate, lines }) {
      journalCount += 1;
      const journal = await db
        .insertInto("journal")
        .values({
          journalEntryId: `${prefix}-je-${journalCount}`,
          accountingPeriodId: periodId,
          companyId,
          description: `${prefix} ${sourceType}`,
          postingDate,
          sourceType,
          status: "Posted",
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("journalLine")
        .values(
          lines.map((line) => ({
            journalId: journal.id,
            accountId: line.accountId,
            amount: line.amount,
            description: `${prefix} line`,
            journalLineReference: crypto.randomUUID(),
            companyId
          }))
        )
        .execute();
      return journal.id;
    },
    async cleanup() {
      await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
        await trx
          .deleteFrom("currencyRevaluationRun")
          .where("companyId", "=", companyId)
          .execute();
        // Posted journals are immutable: step them back to Draft first.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        await trx
          .updateTable("journal")
          .set({ status: "Draft" })
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .updateTable("accountingPeriod")
          .set({ closeStatus: "Open", closedAt: null })
          .where("companyId", "=", companyId)
          .execute();
        await sql`SET LOCAL session_replication_role = origin`.execute(trx);
        await trx.deleteFrom("company").where("id", "=", companyId).execute();
        await trx
          .deleteFrom("companyGroup")
          .where("id", "=", groupId)
          .execute();
        await sql`DROP TABLE IF EXISTS ${sql.id(`searchIndex_${companyId}`)}`.execute(
          trx
        );
        await sql`DROP TABLE IF EXISTS ${sql.id(`auditLog_${companyId}`)}`.execute(
          trx
        );
      });
      await db.destroy();
    }
  };
}
