// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { equals, round } from "@carbon/utils";

/** The fields of a run line's schedule row that decide what it posts. */
export type RunJournalScheduleRow = {
  debitAccountId: string;
  creditAccountId: string;
  amount: number | string | null;
};

/** One account of the journal a Draft run would post, on its net side. */
export type RunJournalAccountRow = {
  accountId: string;
  debit: number;
  credit: number;
};

/**
 * What posting a run would write, by account. Each schedule row debits its
 * `debitAccountId` and credits its `creditAccountId`; a negative amount swaps
 * the sides at its absolute value, as `buildRecognitionJournals` posts it.
 * An account's debits and credits net to one side. Debits come first, then
 * credits, each ordered by account id; accounts that net to zero are left out.
 */
export function summarizeRunJournal(
  lines: ReadonlyArray<{ schedule: RunJournalScheduleRow | null }>
): RunJournalAccountRow[] {
  // Net debit per account: debits add, credits subtract.
  const net = new Map<string, number>();
  const post = (accountId: string, amount: number) =>
    net.set(accountId, (net.get(accountId) ?? 0) + amount);

  for (const { schedule } of lines) {
    if (!schedule) continue;
    const amount = Number(schedule.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    // A positive amount debits the debit account; a negative one credits it.
    post(schedule.debitAccountId, amount);
    post(schedule.creditAccountId, -amount);
  }

  const rows: RunJournalAccountRow[] = [];
  for (const [accountId, value] of net) {
    const amount = round(value);
    if (equals(amount, 0)) continue;
    rows.push(
      amount > 0
        ? { accountId, debit: amount, credit: 0 }
        : { accountId, debit: 0, credit: -amount }
    );
  }

  return rows.sort((a, b) => {
    const aDebit = a.debit > 0;
    const bDebit = b.debit > 0;
    if (aDebit !== bDebit) return aDebit ? -1 : 1;
    return a.accountId.localeCompare(b.accountId);
  });
}
