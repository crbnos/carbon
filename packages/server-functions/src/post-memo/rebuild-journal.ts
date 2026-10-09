// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// A memo's journal built again from its stored row
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md sections 5a and 6).
// The void of a memo dated before the cutover negates it, so it nets the
// opening line; the enable writes it for the memos posted with no journal.

import type { KyselyDatabase } from "@carbon/database/client";
import type { AutomaticJournalStatus } from "@carbon/database/journal-posting-status";
import { buildMemoJournal } from "@carbon/database/posting";
import type { Transaction } from "kysely";
import { nanoid } from "nanoid";
import { InvalidInputError, NotFoundError } from "../errors";
import { assertNoMigrationClearing } from "../lib/cutover-void";
import {
  loadPartyDimensions,
  partyDimensionValuesFrom
} from "../lib/party-dimensions";
import {
  isContractOrRentalCredit,
  type MemoJournalLineWithRole,
  type MemoRow,
  plainMemoReasonAccount,
  supplierReturnCarriedCosts,
  withReasonRole
} from "./memo-accounts";

export const MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR =
  "This credit memo is from before your accounting cutover and credits a contract or a rental agreement. Invoice the customer for the amount instead.";

/** A memo's journal built again: its lines, each with the stand-in role its
 *  posting gives it, and the party dimensions every line carries. */
export type RebuiltMemoJournal = {
  lines: MemoJournalLineWithRole[];
  dimensions: { dimensionId: string; valueId: string }[];
};

/**
 * The journals of many memos of one company, built again with
 * `buildMemoJournal` in a fixed number of reads: the control leg on today's
 * receivables or payables default, which is where the opening journal opened
 * the memo, and the reason leg on the memo's own reason account.
 *
 * `postingStatus` is the status the journal posts with, and it decides what
 * a customer credit memo that credits a contract or a rental agreement does:
 * - `Posted` (the void of a memo dated before the cutover) refuses it with
 *   `MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR`: its legs came from contract
 *   positions and deferral rows that the enable has moved on.
 * - `Provisional` (the enable's legacy memos) books it as a plain memo on
 *   the sales account.
 */
export async function rebuildMemoJournals(
  trx: Transaction<KyselyDatabase>,
  memos: MemoRow[],
  companyId: string,
  options: { postingStatus: AutomaticJournalStatus }
): Promise<RebuiltMemoJournal[]> {
  if (memos.length === 0) return [];
  const { postingStatus } = options;
  for (const memo of memos) {
    if (Boolean(memo.customerId) === Boolean(memo.supplierId)) {
      throw new Error("Memo must have exactly one customer or supplier");
    }
    if (
      postingStatus === "Posted" &&
      memo.customerId &&
      isContractOrRentalCredit(memo)
    ) {
      throw new InvalidInputError(MEMO_CREDIT_VOID_BEFORE_CUTOVER_ERROR);
    }
  }
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) {
    throw new Error("Memo currency configuration is missing");
  }
  const companyGroupId = company.companyGroupId;
  const customerIds = [
    ...new Set(memos.flatMap((memo) => memo.customerId ?? []))
  ];
  const supplierIds = [
    ...new Set(memos.flatMap((memo) => memo.supplierId ?? []))
  ];
  const customers = customerIds.length
    ? await trx
        .selectFrom("customer")
        .select(["id", "customerTypeId as typeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", customerIds)
        .execute()
    : [];
  const suppliers = supplierIds.length
    ? await trx
        .selectFrom("supplier")
        .select(["id", "supplierTypeId as typeId"])
        .where("companyId", "=", companyId)
        .where("id", "in", supplierIds)
        .execute()
    : [];
  const typeByParty = new Map(
    [...customers, ...suppliers].map((row) => [row.id, row.typeId])
  );
  const defaults = await trx
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) {
    throw new Error("Accounting defaults are required before posting");
  }

  const plans = memos.map((memo) => {
    const isAR = Boolean(memo.customerId);
    const partyId = (isAR ? memo.customerId : memo.supplierId)!;
    if (!typeByParty.has(partyId)) {
      throw new NotFoundError("Memo counterparty not found in this company");
    }
    const controlAccountId = isAR
      ? defaults.receivablesAccount
      : defaults.payablesAccount;
    // A contract or rental credit books a plain memo on the sales account.
    // Otherwise the memo keeps the reason account it posted to, unless that
    // was a stand-in; then the default it stood in for.
    const reason =
      isAR && isContractOrRentalCredit(memo)
        ? { accountId: defaults.salesAccount, accountDefaultRole: null }
        : memo.reasonAccount
          ? { accountId: memo.reasonAccount, accountDefaultRole: null }
          : plainMemoReasonAccount(memo, defaults, isAR, postingStatus);
    if (!controlAccountId || !reason.accountId) {
      throw new Error("Memo control and reason account defaults are required");
    }
    return {
      memo,
      isAR,
      partyId,
      controlAccountId,
      reasonAccountId: reason.accountId,
      reasonAccountDefaultRole: reason.accountDefaultRole
    };
  });
  const reasonAccounts = await trx
    .selectFrom("account")
    .select(["id", "class"])
    .where("id", "in", [...new Set(plans.map((plan) => plan.reasonAccountId))])
    .where("companyGroupId", "=", companyGroupId)
    .execute();
  const classByAccount = new Map(
    reasonAccounts.map((row) => [row.id, row.class])
  );
  const carriedCosts = await supplierReturnCarriedCosts(trx, memos, companyId);
  const dimensions = await loadPartyDimensions(trx, companyGroupId);

  return plans.map((plan) => {
    const { memo, isAR, partyId } = plan;
    const reasonClass = classByAccount.get(plan.reasonAccountId);
    if (!reasonClass) {
      throw new Error(
        "Memo accounts must be active posting accounts in this company group with the correct control class"
      );
    }
    const { lines } = buildMemoJournal({
      memoId: memo.id,
      companyId,
      isAR,
      direction: memo.direction,
      amount: Number(memo.amount),
      exchangeRate: Number(memo.exchangeRate),
      journalLineReference: nanoid(),
      controlAccountId: plan.controlAccountId,
      reasonAccountId: plan.reasonAccountId,
      reasonAccountClass: reasonClass,
      reasonAmountBase: carriedCosts.get(memo.id),
      varianceAccountId: defaults.purchaseVarianceAccount,
      reasonDescription: memo.purchaseReturnOrderId
        ? "Goods Received Not Invoiced"
        : undefined
    });
    assertNoMigrationClearing(lines, defaults.migrationClearingAccount);
    return {
      lines: withReasonRole(
        lines,
        plan.reasonAccountId,
        plan.reasonAccountDefaultRole
      ),
      dimensions: partyDimensionValuesFrom(dimensions, {
        isAR,
        partyId,
        typeId: typeByParty.get(partyId) ?? null
      })
    };
  });
}

/** The journal of a memo dated before the cutover, built again for its void. */
export async function rebuildMemoJournal(
  trx: Transaction<KyselyDatabase>,
  memo: MemoRow,
  postingStatus: AutomaticJournalStatus
): Promise<RebuiltMemoJournal> {
  const [rebuilt] = await rebuildMemoJournals(trx, [memo], memo.companyId, {
    postingStatus
  });
  return rebuilt!;
}
