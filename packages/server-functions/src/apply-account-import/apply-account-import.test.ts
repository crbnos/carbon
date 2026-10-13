// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import against a real database: re-pointing,
// reclasses, the RESTRICT delete guard, and that REFERENCE_POLICY classifies
// every foreign key to `account`. Skips without a local database.

import {
  ACCOUNT_DEFAULT_COLUMNS,
  type AccountImportRow,
  REFERENCE_POLICY
} from "@carbon/database/account-import";
import type { KyselyDatabase } from "@carbon/database/client";
import { type Insertable, type Kysely, sql } from "kysely";
import { afterEach, describe, expect } from "vitest";
import {
  connectLocalTestDatabase,
  databaseTest
} from "../local-database-test-fixture";
import { ServerFnContext } from "../server-fn-context";
import applyAccountImport from ".";

const USER = "system";

type Leaf = {
  number: string;
  name: string;
  class: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  accountType: string;
  group: "assets" | "equity" | "revenue";
};

const LEAVES: Leaf[] = [
  {
    number: "1010",
    name: "Cash",
    class: "Asset",
    accountType: "Bank",
    group: "assets"
  },
  {
    number: "1110",
    name: "Receivables",
    class: "Asset",
    accountType: "Accounts Receivable",
    group: "assets"
  },
  {
    number: "3400",
    name: "Migration Clearing",
    class: "Equity",
    accountType: "Equity - No Close",
    group: "equity"
  },
  {
    number: "3900",
    name: "Retained Earnings",
    class: "Equity",
    accountType: "Retained Earnings",
    group: "equity"
  },
  {
    number: "4010",
    name: "Sales",
    class: "Revenue",
    accountType: "Income",
    group: "revenue"
  },
  {
    number: "4050",
    name: "Shipping Revenue",
    class: "Revenue",
    accountType: "Income",
    group: "revenue"
  }
];

const GROUP_NAMES = {
  assets: "Current Assets",
  equity: "Equity",
  revenue: "Revenue"
} as const;

async function fixture() {
  const db = await connectLocalTestDatabase();
  const prefix = `coa-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const groupId = `${prefix}-group`;
  const provisionalId = `${prefix}-provisional`;
  const liveId = `${prefix}-live`;
  const account = (number: string) => `${prefix}-${number}`;

  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .insertInto("companyGroup")
      .values({ id: groupId, name: prefix, createdBy: USER })
      .execute();
    for (const [id, cutover] of [
      [provisionalId, null],
      [liveId, "2000-01-01"]
    ] as const) {
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
        .set({ accountingCutoverDate: cutover })
        .where("id", "=", id)
        .execute();
      await trx
        .insertInto("sequence")
        .values({
          table: "journalEntry",
          name: "Journals",
          prefix: "COA-",
          companyId: id
        })
        .execute();
      await trx
        .insertInto("accountingPeriod")
        .values({
          id: `${id}-period`,
          startDate: "2000-01-01",
          endDate: "2099-12-31",
          fiscalYear: 2099,
          periodNumber: 1,
          status: "Active",
          closeStatus: "Open",
          companyId: id,
          createdBy: USER
        })
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
        (Object.keys(GROUP_NAMES) as (keyof typeof GROUP_NAMES)[]).map((g) => ({
          id: `${prefix}-${g}`,
          name: GROUP_NAMES[g],
          isGroup: true,
          class:
            g === "assets"
              ? ("Asset" as const)
              : g === "equity"
                ? ("Equity" as const)
                : ("Revenue" as const),
          incomeBalance:
            g === "revenue"
              ? ("Income Statement" as const)
              : ("Balance Sheet" as const),
          parentId: g === "revenue" ? `${prefix}-is` : `${prefix}-bs`,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    await trx
      .insertInto("account")
      .values(
        LEAVES.map((l) => ({
          id: account(l.number),
          number: l.number,
          name: l.name,
          class: l.class,
          accountType: l.accountType as never,
          incomeBalance:
            l.class === "Revenue" || l.class === "Expense"
              ? ("Income Statement" as const)
              : ("Balance Sheet" as const),
          parentId: `${prefix}-${l.group}`,
          companyGroupId: groupId,
          createdBy: USER
        }))
      )
      .execute();
    for (const companyId of [provisionalId, liveId]) {
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
  });

  const ctx = (companyId: string) =>
    ServerFnContext.system({ db, companyId, userId: USER });

  /** One row per leaf, naming itself. */
  const template = (): AccountImportRow[] =>
    LEAVES.map((l, i) => ({
      line: i + 2,
      number: l.number,
      name: l.name,
      class: l.class,
      accountType: l.accountType,
      group: GROUP_NAMES[l.group],
      carbonAccounts: [l.number]
    }));

  async function journal(
    companyId: string,
    status: "Provisional" | "Posted" | "Superseded",
    accountId: string,
    amount: number
  ) {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
      const j = await trx
        .insertInto("journal")
        .values({
          journalEntryId: `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
          companyId,
          status,
          sourceType: "Manual",
          postingDate: "2026-01-15",
          accountingPeriodId:
            status === "Posted" ? `${companyId}-period` : null,
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
            companyId,
            createdBy: USER
          },
          {
            journalId: j.id,
            accountId: account("1010"),
            amount: -amount,
            journalLineReference: crypto.randomUUID(),
            companyId,
            createdBy: USER
          }
        ])
        .execute();
    });
  }

  async function cleanup() {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      for (const companyId of [provisionalId, liveId]) {
        await trx
          .deleteFrom("journalLine")
          .where("companyId", "=", companyId)
          .execute();
        await trx
          .deleteFrom("journal")
          .where("companyId", "=", companyId)
          .execute();
      }
      await trx
        .deleteFrom("accountDefault")
        .where("companyId", "in", [provisionalId, liveId])
        .execute();
      await trx
        .deleteFrom("account")
        .where("companyGroupId", "=", groupId)
        .execute();
      await trx
        .deleteFrom("company")
        .where("id", "in", [provisionalId, liveId])
        .execute();
      await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
    });
    await db.destroy();
  }

  return {
    db,
    prefix,
    groupId,
    provisionalId,
    liveId,
    account,
    ctx,
    template,
    journal,
    cleanup
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

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

  databaseTest("renames and swaps numbers in place", async () => {
    f = await fixture();
    const rows = f
      .template()
      .map((r) =>
        r.number === "1010"
          ? { ...r, number: "1110" }
          : r.number === "1110"
            ? { ...r, number: "1010" }
            : r
      );
    const result = await applyAccountImport(f.ctx(f.provisionalId), {
      rows,
      resolutions: { targets: {} }
    });
    expect(result.error).toBeNull();
    expect((await accountRow(f.db, f.account("1010")))?.number).toBe("1110");
    expect((await accountRow(f.db, f.account("1110")))?.number).toBe("1010");
    const defaults = await f.db
      .selectFrom("accountDefault")
      .select("receivablesAccount")
      .where("companyId", "=", f.provisionalId)
      .executeTakeFirstOrThrow();
    expect(defaults.receivablesAccount).toBe(f.account("1110"));
  });

  databaseTest(
    "a merge moves Provisional lines and deletes the source",
    async () => {
      f = await fixture();
      await f.journal(f.provisionalId, "Provisional", f.account("4050"), 25);
      const rows = f
        .template()
        .filter((r) => r.number !== "4050")
        .map((r) =>
          r.number === "4010" ? { ...r, carbonAccounts: ["4010", "4050"] } : r
        );
      const result = await applyAccountImport(f.ctx(f.provisionalId), {
        rows,
        resolutions: { targets: {} }
      });
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("4050"))).toBeUndefined();
      const onTarget = await f.db
        .selectFrom("journalLine")
        .select("amount")
        .where("accountId", "=", f.account("4010"))
        .where("companyId", "=", f.provisionalId)
        .execute();
      expect(onTarget.map((l) => Number(l.amount))).toEqual([25]);
    }
  );

  databaseTest(
    "a removed row with Provisional lines merges into its picked target",
    async () => {
      f = await fixture();
      await f.journal(f.provisionalId, "Provisional", f.account("4050"), 25);
      const rows = f.template().filter((r) => r.number !== "4050");
      const salesLine = rows.find((r) => r.number === "4010")!.line;
      const refused = await applyAccountImport(f.ctx(f.provisionalId), {
        rows,
        resolutions: { targets: {} }
      });
      expect(refused.error).not.toBeNull();
      const result = await applyAccountImport(f.ctx(f.provisionalId), {
        rows,
        resolutions: { targets: { [f.account("4050")]: salesLine } }
      });
      expect(result.error).toBeNull();
      expect(await accountRow(f.db, f.account("4050"))).toBeUndefined();
    }
  );

  databaseTest(
    "a Posted balance is reclassed and the source deactivated",
    async () => {
      f = await fixture();
      await f.journal(f.liveId, "Posted", f.account("4050"), 40);
      const rows = f
        .template()
        .filter((r) => r.number !== "4050")
        .map((r) =>
          r.number === "4010" ? { ...r, carbonAccounts: ["4010", "4050"] } : r
        );
      const result = await applyAccountImport(f.ctx(f.liveId), {
        rows,
        resolutions: { targets: {} }
      });
      expect(result.error).toBeNull();
      expect(result.data?.reclassJournalIds).toHaveLength(1);
      expect((await accountRow(f.db, f.account("4050")))?.active).toBe(false);
      const balance = await f.db
        .selectFrom("journalLine")
        .innerJoin("journal", "journal.id", "journalLine.journalId")
        .select(sql<number>`SUM("journalLine"."amount")`.as("amount"))
        .where("journalLine.accountId", "=", f.account("4050"))
        .where("journal.status", "=", "Posted")
        .executeTakeFirstOrThrow();
      expect(Number(balance.amount)).toBe(0);
    }
  );

  databaseTest(
    "Superseded lines deactivate the source with no reclass",
    async () => {
      f = await fixture();
      await f.journal(f.liveId, "Superseded", f.account("4050"), 40);
      const rows = f
        .template()
        .filter((r) => r.number !== "4050")
        .map((r) =>
          r.number === "4010" ? { ...r, carbonAccounts: ["4010", "4050"] } : r
        );
      const result = await applyAccountImport(f.ctx(f.liveId), {
        rows,
        resolutions: { targets: {} }
      });
      expect(result.error).toBeNull();
      expect(result.data?.reclassJournalIds).toEqual([]);
      expect((await accountRow(f.db, f.account("4050")))?.active).toBe(false);
    }
  );

  databaseTest(
    "a required role left without a target changes nothing",
    async () => {
      f = await fixture();
      const rows = f.template().filter((r) => r.number !== "4050");
      const result = await applyAccountImport(f.ctx(f.provisionalId), {
        rows,
        resolutions: { targets: {} }
      });
      expect(result.error).not.toBeNull();
      expect((await accountRow(f.db, f.account("4050")))?.active).toBe(true);
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
            ref !== "account.parentId"
        );
      expect(unclassified).toEqual([]);
    }
  );
});
