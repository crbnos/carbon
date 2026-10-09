// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The prior system's trial balance and Migration Clearing
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 3, steps 4
// and 5): the Draft opening journal the wizard keeps, everything the opening
// journal is built from, and Migration Clearing per control account.

import { sql } from "kysely";
import { nanoid } from "nanoid";
import {
  dayBeforeCutover,
  type MigrationClearingAccount,
  type MigrationClearingRow,
  migrationClearingByAccount,
  type OpenItem,
  type TrialBalanceLine
} from "../accounting-cutover";
import { configuredDefaultAccount } from "../journal-posting-status";
import { debitSigned, isAccountClass } from "../ledger";
import { round } from "../precision";
import { getNextSequence } from "../sequence";
import { getCutoverFixedAssets } from "./fixed-assets";
import { inventoryFor, inventoryValueByAccount } from "./inventory";
import { type DraftItem, finishItems, openItemsFor } from "./open-items";
import {
  addTo,
  type CutoverArgs,
  type CutoverCompany,
  type CutoverDb,
  getAccounts,
  getCompany,
  loadCutoverContext,
  OPENING_BALANCE_SOURCE,
  refuseAfterCutover,
  requireClass,
  withTransaction
} from "./shared";

const OPENING_TRIAL_BALANCE_DESCRIPTION = "Opening trial balance";

async function getDraftOpeningJournal(db: CutoverDb, companyId: string) {
  return db
    .selectFrom("journal")
    .select(["id", "journalEntryId", "postingDate"])
    .where("companyId", "=", companyId)
    .where("status", "=", "Draft")
    .where("sourceType", "=", OPENING_BALANCE_SOURCE)
    .orderBy("createdAt")
    .executeTakeFirst();
}

/**
 * The prior system's trial balance: the lines of the company's Draft
 * opening balance journal, as debit and credit per account.
 */
export async function getOpeningTrialBalance(
  db: CutoverDb,
  { companyId }: { companyId: string }
): Promise<{ journalId: string | null; lines: TrialBalanceLine[] }> {
  return openingTrialBalanceFor(db, await getCompany(db, companyId));
}

async function openingTrialBalanceFor(
  db: CutoverDb,
  company: CutoverCompany
): Promise<{ journalId: string | null; lines: TrialBalanceLine[] }> {
  const companyId = company.id;
  const journal = await getDraftOpeningJournal(db, companyId);
  if (!journal) return { journalId: null, lines: [] };
  const rows = await db
    .selectFrom("journalLine")
    .select(["accountId", "amount"])
    .where("companyId", "=", companyId)
    .where("journalId", "=", journal.id)
    .execute();
  const accounts = await getAccounts(
    db,
    company.companyGroupId,
    rows.map((row) => row.accountId).filter((id): id is string => !!id)
  );
  const debitByAccount = new Map<string, number>();
  for (const row of rows) {
    if (!row.accountId) continue;
    const accountClass = requireClass(accounts, row.accountId);
    addTo(
      debitByAccount,
      row.accountId,
      debitSigned(accountClass, Number(row.amount))
    );
  }
  return {
    journalId: journal.id,
    lines: [...debitByAccount].map(([accountId, debitValue]) => ({
      accountId,
      accountClass: requireClass(accounts, accountId),
      debit: debitValue > 0 ? round(debitValue) : 0,
      credit: debitValue < 0 ? round(-debitValue) : 0
    }))
  };
}

export type CutoverOpeningInputs = {
  /** Open items, inventory per account and fixed assets per class account. */
  items: OpenItem[];
  trialBalance: TrialBalanceLine[];
  /** Accounts whose opening balance comes from Carbon, not the trial balance. */
  controlAccountIds: Set<string>;
  migrationClearingAccountId: string | null;
  /**
   * The Migration Clearing default with its class, for
   * `buildOpeningJournalLines`; null while the default is empty or names an
   * account with no class.
   */
  migrationClearingAccount: MigrationClearingAccount | null;
};

/**
 * Everything the opening journal and Migration Clearing are built from. The
 * control accounts are the defaults that carry open items, every fixed asset
 * class's asset and accumulated depreciation accounts, and every account an
 * item lands on.
 */
export async function getCutoverOpeningInputs(
  db: CutoverDb,
  args: CutoverArgs
): Promise<CutoverOpeningInputs> {
  const context = await loadCutoverContext(db, args);
  const { companyId, company, defaults } = context;
  const [openItems, inventory, fixedAssets, classes, trialBalance] =
    await Promise.all([
      openItemsFor(db, context),
      inventoryFor(db, context),
      getCutoverFixedAssets(db, args),
      db
        .selectFrom("fixedAssetClass")
        .select(["assetAccountId", "accumulatedDepreciationAccountId"])
        .where("companyId", "=", companyId)
        .execute(),
      openingTrialBalanceFor(db, company)
    ]);

  const costByAccount = new Map<string, number>();
  const depreciationByAccount = new Map<string, number>();
  for (const asset of fixedAssets) {
    addTo(costByAccount, asset.assetAccountId, asset.cost);
    addTo(
      depreciationByAccount,
      asset.accumulatedDepreciationAccountId,
      asset.accumulatedDepreciation
    );
  }
  const drafts: DraftItem[] = [
    // Inventory per account, valued as the opening journal values it.
    ...inventoryValueByAccount(inventory).map(
      ({ accountId, value }): DraftItem => ({
        openItemType: "Inventory",
        accountId,
        basis: "debit",
        original: value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Inventory"
      })
    ),
    ...[...costByAccount].map(
      ([accountId, value]): DraftItem => ({
        openItemType: "Fixed Asset Cost",
        accountId,
        basis: "debit",
        original: value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Fixed Asset Cost"
      })
    ),
    ...[...depreciationByAccount].map(
      ([accountId, value]): DraftItem => ({
        openItemType: "Accumulated Depreciation",
        accountId,
        basis: "debit",
        // A credit balance.
        original: -value,
        settled: 0,
        documentType: null,
        documentId: null,
        documentLineReference: null,
        description: "Accumulated Depreciation"
      })
    )
  ];
  const items = [
    ...openItems,
    ...(await finishItems(db, company.companyGroupId, drafts))
  ];

  const controlAccountIds = new Set<string>(
    [
      defaults.receivablesAccount,
      defaults.payablesAccount,
      defaults.intercompanyReceivablesAccount,
      defaults.intercompanyPayablesAccount,
      configuredDefaultAccount(
        defaults,
        "employeeReimbursementsPayableAccount"
      ),
      defaults.prepaymentAccount,
      defaults.goodsReceivedNotInvoicedAccount,
      defaults.workInProgressAccount,
      defaults.rawMaterialsAccount,
      defaults.finishedGoodsAccount,
      defaults.deferredRevenueAccount,
      defaults.netInvestmentInLeasesAccount,
      ...classes.flatMap((row) => [
        row.assetAccountId,
        row.accumulatedDepreciationAccountId
      ]),
      ...items.map((item) => item.accountId)
    ].filter((id): id is string => Boolean(id))
  );

  const migrationClearingAccountId = defaults.migrationClearingAccount;
  let migrationClearingAccount: MigrationClearingAccount | null = null;
  if (migrationClearingAccountId) {
    const accounts = await getAccounts(db, company.companyGroupId, [
      migrationClearingAccountId
    ]);
    const accountClass =
      accounts.get(migrationClearingAccountId)?.class ?? null;
    if (isAccountClass(accountClass)) {
      migrationClearingAccount = {
        accountId: migrationClearingAccountId,
        accountClass
      };
    }
  }

  return {
    items,
    trialBalance: trialBalance.lines,
    controlAccountIds,
    migrationClearingAccountId,
    migrationClearingAccount
  };
}

/**
 * Migration Clearing per control account: what the trial balance asserts,
 * what Carbon's open items, inventory and fixed assets hold, and the
 * difference. The enable needs `total` to be zero within
 * `MIGRATION_CLEARING_TOLERANCE`.
 */
export async function getMigrationClearing(
  db: CutoverDb,
  args: CutoverArgs
): Promise<
  { rows: MigrationClearingRow[]; total: number } & CutoverOpeningInputs
> {
  const inputs = await getCutoverOpeningInputs(db, args);
  const { rows, total } = migrationClearingByAccount(
    inputs.items,
    inputs.trialBalance,
    inputs.controlAccountIds
  );
  return { rows, total, ...inputs };
}

/**
 * Keeps one Draft opening balance journal, dated the day before the cutover
 * with no accounting period, and replaces its lines with `lines`. Each line
 * becomes a natural-balance-signed amount on its account.
 */
export async function saveOpeningTrialBalance(
  db: CutoverDb,
  {
    companyId,
    cutoverDate,
    userId,
    lines
  }: CutoverArgs & {
    userId: string;
    lines: { accountId: string; debit: number; credit: number }[];
  }
): Promise<{ journalId: string }> {
  return withTransaction(db, async (trx) => {
    await refuseAfterCutover(trx, companyId);
    const company = await getCompany(trx, companyId);
    const accounts = await getAccounts(
      trx,
      company.companyGroupId,
      lines.map((line) => line.accountId)
    );
    const amountByAccount = new Map<string, number>();
    for (const line of lines) {
      if (!accounts.has(line.accountId)) {
        throw new Error(`Account ${line.accountId} not found`);
      }
      const accountClass = requireClass(accounts, line.accountId);
      addTo(
        amountByAccount,
        line.accountId,
        debitSigned(
          accountClass,
          Number(line.debit ?? 0) - Number(line.credit ?? 0)
        )
      );
    }

    const postingDate = dayBeforeCutover(cutoverDate);
    const existing = await getDraftOpeningJournal(trx, companyId);
    let journalId: string;
    if (existing) {
      journalId = existing.id;
      await trx
        .updateTable("journal")
        .set({
          postingDate,
          accountingPeriodId: null,
          updatedBy: userId,
          updatedAt: sql`now()`
        })
        .where("id", "=", journalId)
        .where("companyId", "=", companyId)
        .execute();
      await trx
        .deleteFrom("journalLine")
        .where("journalId", "=", journalId)
        .where("companyId", "=", companyId)
        .execute();
    } else {
      const journalEntryId = await getNextSequence(
        trx,
        "journalEntry",
        companyId
      );
      const journal = await trx
        .insertInto("journal")
        .values({
          journalEntryId,
          description: OPENING_TRIAL_BALANCE_DESCRIPTION,
          postingDate,
          status: "Draft",
          sourceType: OPENING_BALANCE_SOURCE,
          accountingPeriodId: null,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      journalId = journal.id;
    }

    const inserts = [...amountByAccount]
      .map(([accountId, amount]) => ({ accountId, amount: round(amount) }))
      .filter((line) => line.amount !== 0)
      .map((line) => ({
        journalId,
        accountId: line.accountId,
        amount: line.amount,
        description: OPENING_TRIAL_BALANCE_DESCRIPTION,
        quantity: 0,
        journalLineReference: nanoid(),
        companyId,
        createdBy: userId
      }));
    if (inserts.length > 0) {
      await trx.insertInto("journalLine").values(inserts).execute();
    }
    return { journalId };
  });
}
