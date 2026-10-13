// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import against a real database: updates in place,
// merges of Provisional records and posted documents, deletes, the refusal
// after activation, and
// that REFERENCE_POLICY classifies every foreign key to `account`. Skips
// without a local database.

import {
  ACCOUNT_DEFAULT_COLUMNS,
  assetClassKey,
  type ChartImportRow,
  type DefaultImportRow,
  FIXED_ASSET_CLASS_COLUMNS,
  REFERENCE_POLICY
} from "@carbon/database/account-import";
import type { KyselyDatabase } from "@carbon/database/client";
import { type Insertable, type Kysely, sql, type Transaction } from "kysely";
import { afterEach, describe, expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import applyAccountImport from ".";

const USER = "system";

const LEAVES = [
  ["1010", "Cash", "Asset", "Bank", "assets"],
  ["1110", "Receivables", "Asset", "Accounts Receivable", "assets"],
  ["1900", "Petty Cash", "Asset", "Cash", "assets"],
  ["3400", "Migration Clearing", "Equity", "Equity - No Close", "equity"],
  ["3900", "Retained Earnings", "Equity", "Retained Earnings", "equity"],
  ["4010", "Sales", "Revenue", "Income", "revenue"],
  ["4050", "Shipping Revenue", "Revenue", "Income", "revenue"]
] as const;

const GROUPS = {
  assets: ["Current Assets", "Asset", "Balance Sheet", "bs"],
  equity: ["Equity", "Equity", "Balance Sheet", "bs"],
  revenue: ["Revenue", "Revenue", "Income Statement", "is"]
} as const;

async function fixture({ cutover = false } = {}) {
  const db = await connectLocalTestDatabase();
  const prefix = `coa-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const groupId = `${prefix}-group`;
  const companies = [`${prefix}-one`, `${prefix}-two`];
  const account = (number: string) => `${prefix}-${number}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    for (const [i, id] of companies.entries()) {
      await trx
        .insertInto("company")
        .values({
          id,
          name: id,
          companyGroupId: groupId,
          baseCurrencyCode: "USD",
          timezone: "America/New_York"
        })
        .execute();
      await trx
        .insertInto("companySettings")
        .values({ id })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
      await trx
        .updateTable("companySettings")
        .set({
          accountingCutoverDate: cutover && i === 1 ? "2000-01-01" : null
        })
        .where("id", "=", id)
        .execute();
    }
    await trx
      .insertInto("account")
      .values([
        {
          id: `${prefix}-bs`,
          name: `${prefix} Balance Sheet`,
          isGroup: true,
          isSystem: true,
          incomeBalance: "Balance Sheet",
          companyGroupId: groupId,
          createdBy: USER
        },
        {
          id: `${prefix}-is`,
          name: `${prefix} Income Statement`,
          isGroup: true,
          isSystem: true,
          incomeBalance: "Income Statement",
          companyGroupId: groupId,
          createdBy: USER
        }
      ])
      .execute();
    await trx
      .insertInto("account")
      .values(
        Object.entries(GROUPS).map(([k, [name, cls, incomeBalance, root]]) => ({
          id: `${prefix}-${k}`,
          name,
          isGroup: true,
          class: cls,
          incomeBalance,
          parentId: `${prefix}-${root}`,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("account")
      .values(
        LEAVES.map(([number, name, cls, type, group]) => ({
          id: account(number),
          number,
          name,
          class: cls,
          accountType: type,
          incomeBalance:
            cls === "Revenue"
              ? ("Income Statement" as const)
              : ("Balance Sheet" as const),
          parentId: `${prefix}-${group}`,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    for (const companyId of companies) {
      await trx
        .insertInto("accountDefault")
        .values({
          companyId,
          ...Object.fromEntries(
            ACCOUNT_DEFAULT_COLUMNS.map((column) => [column, account("1010")])
          ),
          receivablesAccount: account("1110"),
          migrationClearingAccount: account("3400"),
          retainedEarningsAccount: account("3900"),
          salesAccount: account("4010"),
          salesShippingRevenueAccount: account("4050")
        } as unknown as Insertable<KyselyDatabase["accountDefault"]>)
        .execute();
    }
    await trx
      .insertInto("fixedAssetClass")
      .values({
        id: `${prefix}-buildings`,
        name: "Buildings",
        depreciationMethod: "Straight Line",
        usefulLifeMonths: 120,
        residualValuePercent: 0,
        ...Object.fromEntries(
          FIXED_ASSET_CLASS_COLUMNS.map((column) => [column, account("1010")])
        ),
        companyId: companies[0]!,
        createdBy: USER
      } as unknown as Insertable<KyselyDatabase["fixedAssetClass"]>)
      .execute();
  });

  const ctx = ServerFnContext.system({
    db,
    companyId: companies[0]!,
    userId: USER
  });

  async function provisionalLine(accountId: string, amount: number) {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      const j = await trx
        .insertInto("journal")
        .values({
          journalEntryId: `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
          companyId: companies[0]!,
          status: "Provisional",
          sourceType: "Manual",
          postingDate: "2026-01-15",
          createdBy: USER
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("journalLine")
        .values([
          {
            journalId: j.id,
            accountId,
            amount,
            journalLineReference: crypto.randomUUID(),
            companyId: companies[0]!,
            createdBy: USER
          },
          {
            journalId: j.id,
            accountId: account("1010"),
            amount: -amount,
            journalLineReference: crypto.randomUUID(),
            companyId: companies[0]!,
            createdBy: USER
          }
        ])
        .execute();
    });
  }

  /** A posted payment, charge and reimbursement on one account. */
  async function postedDocuments(accountId: string) {
    const supplierId = `${prefix}-supplier`;
    // An employee to reimburse. Its type's group interceptors need the
    // company's root group, which the scratch company does not have.
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .insertInto("employeeType")
        .values({
          id: `${prefix}-type`,
          name: `${prefix} Type`,
          companyId: companies[0]!
        })
        .execute();
      await trx
        .insertInto("employee")
        .values({
          id: USER,
          employeeTypeId: `${prefix}-type`,
          companyId: companies[0]!
        })
        .execute();
    });
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      await trx
        .insertInto("supplier")
        .values({
          id: supplierId,
          name: `${prefix} Supplier`,
          readableId: `${prefix}-S`,
          companyId: companies[0]!,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("payment")
        .values({
          id: `${prefix}-payment`,
          paymentId: `${prefix}-PAY`,
          paymentType: "Disbursement",
          paymentDate: "2026-01-15",
          currencyCode: "USD",
          totalAmount: 10,
          bankAccount: accountId,
          supplierId,
          status: "Posted",
          companyId: companies[0]!,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("charge")
        .values({
          id: `${prefix}-charge`,
          chargeId: `${prefix}-CHG`,
          cardAccountId: accountId,
          transactionDate: "2026-01-15",
          currencyCode: "USD",
          amount: 10,
          companyId: companies[0]!,
          createdBy: USER
        })
        .execute();
      await trx
        .insertInto("reimbursement")
        .values({
          id: `${prefix}-reimbursement`,
          reimbursementId: `${prefix}-RMB`,
          employeeId: USER,
          payableAccountId: accountId,
          reimbursementDate: "2026-01-15",
          currencyCode: "USD",
          amount: 10,
          companyId: companies[0]!,
          createdBy: USER
        })
        .execute();
      // Charges and reimbursements are created Draft; their guards let them
      // post.
      const posted = {
        status: "Posted",
        postingDate: "2026-01-15",
        postedAt: "2026-01-15T00:00:00Z",
        postedBy: USER
      } as const;
      await trx
        .updateTable("charge")
        .set(posted)
        .where("id", "=", `${prefix}-charge`)
        .where("companyId", "=", companies[0]!)
        .execute();
      await trx
        .updateTable("reimbursement")
        .set(posted)
        .where("id", "=", `${prefix}-reimbursement`)
        .where("companyId", "=", companies[0]!)
        .execute();
    });
  }

  async function cleanup() {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      await trx
        .deleteFrom("journalLine")
        .where("companyId", "in", companies)
        .execute();
      await trx
        .deleteFrom("journal")
        .where("companyId", "in", companies)
        .execute();
      await trx
        .deleteFrom("fixedAssetClass")
        .where("companyId", "in", companies)
        .execute();
      await trx
        .deleteFrom("accountDefault")
        .where("companyId", "in", companies)
        .execute();
      await trx
        .deleteFrom("account")
        .where("companyGroupId", "=", groupId)
        .execute();
      // Every other row of the scratch companies (the supplier's side rows).
      const { rows: tables } = await sql<{ table: string }>`
        SELECT c.table_name AS "table" FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'companyId'
          AND t.table_type = 'BASE TABLE' AND c.table_name <> 'company'`.execute(
        trx
      );
      for (const { table } of tables) {
        await sql`DELETE FROM ${sql.table(table)}
          WHERE "companyId" IN (${sql.join(companies)})`.execute(trx);
      }
      await trx.deleteFrom("company").where("id", "in", companies).execute();
      await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
    });
    await db.destroy();
  }

  return {
    db,
    companies,
    account,
    ctx,
    provisionalLine,
    postedDocuments,
    cleanup
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Trx = Transaction<KyselyDatabase>;

/** The customer's chart. */
function customerChart(
  rows: [string, string, ChartImportRow["class"], string][] = [
    ["10000", "Checking", "Asset", "Current Assets"],
    ["11000", "Accounts Receivable", "Asset", "Current Assets"],
    ["30000", "Opening Balance Equity", "Equity", "Equity"],
    ["39000", "Retained Earnings", "Equity", "Equity"],
    ["40000", "Product Sales", "Revenue", "Revenue"],
    ["40500", "Freight", "Revenue", "Revenue"]
  ]
): ChartImportRow[] {
  return rows.map(([number, name, cls, group], i) => ({
    line: i + 2,
    number,
    name,
    class: cls,
    accountType: null,
    group
  }));
}

/** Every default and class account; unnamed ones go to `fallback`. */
function defaultsFile(
  numbers: Record<string, string>,
  fallback: string
): DefaultImportRow[] {
  const keys = [
    ...ACCOUNT_DEFAULT_COLUMNS,
    ...FIXED_ASSET_CLASS_COLUMNS.map((c) => assetClassKey("Buildings", c))
  ];
  return keys.map((key, i) => ({
    line: i + 2,
    key,
    number: numbers[key] ?? fallback
  }));
}

const STANDARD = {
  receivablesAccount: "11000",
  migrationClearingAccount: "30000",
  retainedEarningsAccount: "39000",
  salesAccount: "40000",
  salesShippingRevenueAccount: "40500"
};

async function accountRow(db: Kysely<KyselyDatabase>, id: string) {
  return db
    .selectFrom("account")
    .select(["id", "number", "name", "active"])
    .where("id", "=", id)
    .executeTakeFirst();
}

describe("apply-account-import", () => {
  let f: Fixture | undefined;
  afterEach(async () => {
    await f?.cleanup();
    f = undefined;
  });

  databaseTest(
    "updates the accounts behind the defaults and deletes the rest",
    async () => {
      f = await fixture();
      const result = await applyAccountImport(f.ctx, {
        chart: customerChart(),
        defaults: defaultsFile(STANDARD, "10000"),
        resolutions: { targets: {} }
      });
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("1010"))).toMatchObject({
        number: "10000",
        name: "Checking"
      });
      expect(await accountRow(f.db, f.account("4050"))).toMatchObject({
        number: "40500",
        name: "Freight"
      });
      expect(await accountRow(f.db, f.account("1900"))).toBeUndefined();
      const defaults = await f.db
        .selectFrom("accountDefault")
        .select(["companyId", "receivablesAccount"])
        .where("companyId", "in", f.companies)
        .execute();
      expect(defaults.map((d) => d.receivablesAccount)).toEqual([
        f.account("1110"),
        f.account("1110")
      ]);
    }
  );

  databaseTest("two accounts may swap numbers", async () => {
    f = await fixture();
    const chart = customerChart([
      ["1110", "Cash", "Asset", "Current Assets"],
      ["1010", "Receivables", "Asset", "Current Assets"],
      ["3400", "Migration Clearing", "Equity", "Equity"],
      ["3900", "Retained Earnings", "Equity", "Equity"],
      ["4010", "Sales", "Revenue", "Revenue"],
      ["4050", "Shipping Revenue", "Revenue", "Revenue"]
    ]);
    const result = await applyAccountImport(f.ctx, {
      chart,
      defaults: defaultsFile(
        {
          receivablesAccount: "1010",
          migrationClearingAccount: "3400",
          retainedEarningsAccount: "3900",
          salesAccount: "4010",
          salesShippingRevenueAccount: "4050"
        },
        "1110"
      ),
      resolutions: { targets: {} }
    });
    expect(result.error).toBeNull();
    expect((await accountRow(f.db, f.account("1010")))?.number).toBe("1110");
    expect((await accountRow(f.db, f.account("1110")))?.number).toBe("1010");
  });

  databaseTest(
    "a merge moves Provisional lines and deletes the source",
    async () => {
      f = await fixture();
      await f.provisionalLine(f.account("4050"), 25);
      const chart = customerChart().filter((r) => r.number !== "40500");
      const result = await applyAccountImport(f.ctx, {
        chart,
        defaults: defaultsFile(
          { ...STANDARD, salesShippingRevenueAccount: "40000" },
          "10000"
        ),
        resolutions: { targets: {} }
      });
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("4050"))).toBeUndefined();
      const lines = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("accountId", "=", f.account("4010"))
        .execute();
      expect(lines.map((l) => Number(l.amount))).toEqual([25]);
    }
  );

  databaseTest(
    "an account still in use needs a target, then merges into it",
    async () => {
      f = await fixture();
      await f.provisionalLine(f.account("1900"), 10);
      const chart = customerChart();
      const input = {
        chart,
        defaults: defaultsFile(STANDARD, "10000"),
        resolutions: { targets: {} as Record<string, number> }
      };
      const refused = await applyAccountImport(f.ctx, input);
      expect(refused.error?.message).toContain(
        "0 error(s) and 1 account(s) that need a replacement"
      );
      expect(await accountRow(f.db, f.account("1900"))).toBeDefined();

      input.resolutions.targets[f.account("1900")] = chart[0]!.line;
      const result = await applyAccountImport(f.ctx, input);
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("1900"))).toBeUndefined();
    }
  );

  databaseTest(
    "a merge moves posted documents and their Provisional lines",
    async () => {
      f = await fixture();
      await f.postedDocuments(f.account("1900"));
      await f.provisionalLine(f.account("1900"), 10);
      const chart = customerChart();
      const input = {
        chart,
        defaults: defaultsFile(STANDARD, "10000"),
        resolutions: { targets: {} as Record<string, number> }
      };
      // Posted documents are movable: the plan asks for a replacement and
      // reports no error (before, they made the account history).
      const refused = await applyAccountImport(f.ctx, input);
      expect(refused.error?.message).toContain(
        "0 error(s) and 1 account(s) that need a replacement"
      );

      input.resolutions.targets[f.account("1900")] = chart[0]!.line;
      const result = await applyAccountImport(f.ctx, input);
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("1900"))).toBeUndefined();
      const payment = await f.db
        .selectFrom("payment")
        .select(["bankAccount", "status"])
        .where("companyId", "=", f.companies[0]!)
        .executeTakeFirstOrThrow();
      expect(payment).toEqual({
        bankAccount: f.account("1010"),
        status: "Posted"
      });
      const charge = await f.db
        .selectFrom("charge")
        .select(["cardAccountId", "status"])
        .where("companyId", "=", f.companies[0]!)
        .executeTakeFirstOrThrow();
      expect(charge).toEqual({
        cardAccountId: f.account("1010"),
        status: "Posted"
      });
      const reimbursement = await f.db
        .selectFrom("reimbursement")
        .select(["payableAccountId", "status"])
        .where("companyId", "=", f.companies[0]!)
        .executeTakeFirstOrThrow();
      expect(reimbursement).toEqual({
        payableAccountId: f.account("1010"),
        status: "Posted"
      });
    }
  );

  databaseTest(
    "the posted-document guards accept only the import's account change",
    async () => {
      f = await fixture();
      await f.postedDocuments(f.account("1900"));
      const { db, companies, account } = f;
      /** Runs one update in a transaction, with or without the import flag. */
      const attempt = (
        update: (trx: Trx) => Promise<unknown>,
        { flag = true, cutover = false } = {}
      ) =>
        db.transaction().execute(async (trx) => {
          if (cutover) {
            await trx
              .updateTable("companySettings")
              .set({ accountingCutoverDate: "2026-01-01" })
              .where("id", "=", companies[0]!)
              .execute();
          }
          if (flag) {
            await sql`SELECT set_config('app.account_import', 'true', true)`.execute(
              trx
            );
          }
          await update(trx);
          // Roll back: each attempt starts from the posted documents.
          throw new Error("rolled back");
        });
      const moveCharge = (trx: Trx) =>
        trx
          .updateTable("charge")
          .set({ cardAccountId: account("1010") })
          .where("companyId", "=", companies[0]!)
          .execute();
      const moveReimbursement = (trx: Trx) =>
        trx
          .updateTable("reimbursement")
          .set({ payableAccountId: account("1010") })
          .where("companyId", "=", companies[0]!)
          .execute();

      // With the flag, the account change passes the guard.
      await expect(attempt(moveCharge)).rejects.toThrow("rolled back");
      await expect(attempt(moveReimbursement)).rejects.toThrow("rolled back");
      // Without it, or once the company has a cutover, it does not.
      await expect(attempt(moveCharge, { flag: false })).rejects.toThrow(
        /cannot transition/
      );
      await expect(attempt(moveReimbursement, { flag: false })).rejects.toThrow(
        /cannot transition/
      );
      await expect(attempt(moveCharge, { cutover: true })).rejects.toThrow(
        /cannot transition/
      );
      // The flag never lets another column change.
      await expect(
        attempt((trx) =>
          trx
            .updateTable("charge")
            .set({ amount: 99 })
            .where("companyId", "=", companies[0]!)
            .execute()
        )
      ).rejects.toThrow(/cannot transition/);
    }
  );

  databaseTest("sets the fixed asset class accounts", async () => {
    f = await fixture();
    const result = await applyAccountImport(f.ctx, {
      chart: customerChart(),
      defaults: defaultsFile(
        {
          ...STANDARD,
          [assetClassKey("Buildings", "assetAccountId")]: "11000"
        },
        "10000"
      ),
      resolutions: { targets: {} }
    });
    expect(result.error).toBeNull();
    const fac = await f.db
      .selectFrom("fixedAssetClass")
      .select(["assetAccountId", "writeOffAccountId"])
      .where("companyId", "=", f.companies[0]!)
      .executeTakeFirstOrThrow();
    expect(fac.assetAccountId).toBe(f.account("1110"));
    expect(fac.writeOffAccountId).toBe(f.account("1010"));
  });

  databaseTest(
    "refuses once a company of the group has activated accounting",
    async () => {
      f = await fixture({ cutover: true });
      const result = await applyAccountImport(f.ctx, {
        chart: customerChart(),
        defaults: defaultsFile(STANDARD, "10000"),
        resolutions: { targets: {} }
      });
      expect(result.error?.message).toContain("Accounting is already set up");
      expect((await accountRow(f.db, f.account("1010")))?.number).toBe("1010");
    }
  );

  databaseTest(
    "REFERENCE_POLICY classifies every foreign key to account",
    async () => {
      f = await fixture();
      const { rows } = await sql<{ table: string; column: string }>`
      SELECT c.conrelid::regclass::text AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = '"account"'::regclass`.execute(
        f.db
      );
      const classified = new Set(
        REFERENCE_POLICY.map((r) => `${r.table}.${r.column}`)
      );
      const unclassified = rows
        .map((r) => `${r.table.replaceAll('"', "")}.${r.column}`)
        .filter(
          (ref) =>
            !classified.has(ref) &&
            !ref.startsWith("accountDefault.") &&
            !ref.startsWith("fixedAssetClass.") &&
            ref !== "account.parentId"
        );
      expect(unclassified).toEqual([]);
    }
  );
});
