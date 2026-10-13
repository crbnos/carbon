// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Shared reads and writes of the contract movement ledger
// (`customerContractLedgerEntry`). Every writer — invoice posting and its
// VOID, a contract credit memo, the recognition run's synthesizer — takes the
// company's position lock, reads each touched line's position (Σ of its
// entries) and applies its movements to it through `applyContractMovement`
// (`@carbon/database/contract-position`). Plan:
// `.ai/plans/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part IV (D3–D7)

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  type ContractPosition,
  EMPTY_POSITION
} from "@carbon/database/contract-position";
import { accountTypeFromClass, credit, debit } from "@carbon/database/ledger";
import { equals } from "@carbon/database/precision";
import { sql } from "kysely";

/**
 * Serializes every writer of one company's contract positions. A movement is
 * computed from the position as read, so two writers interleaving on one line
 * would both draw on the same pool. Transaction-scoped: released at commit.
 */
export async function lockContractPositions(
  trx: KyselyTx,
  companyId: string
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`contract-position:${companyId}`}))`.execute(
    trx
  );
}

/** Each line's position — the sum of its ledger entries — in one grouped
 *  read. A line with no entries is the empty position. */
export async function loadContractPositions(
  db: Kysely<KyselyDatabase> | KyselyTx,
  companyId: string,
  lineIds: string[]
): Promise<Map<string, ContractPosition>> {
  const positions = new Map<string, ContractPosition>();
  const ids = [...new Set(lineIds)];
  for (const id of ids) positions.set(id, { ...EMPTY_POSITION });
  if (ids.length === 0) return positions;
  const rows = await db
    .selectFrom("customerContractLedgerEntry")
    .select([
      "customerContractLineId",
      sql<number>`COALESCE(SUM("deferredAmount"), 0)`.as("deferredAmount"),
      sql<number>`COALESCE(SUM("deferredBase"), 0)`.as("deferredBase"),
      sql<number>`COALESCE(SUM("assetAmount"), 0)`.as("assetAmount"),
      sql<number>`COALESCE(SUM("assetBase"), 0)`.as("assetBase")
    ])
    .where("companyId", "=", companyId)
    .where("customerContractLineId", "in", ids)
    .groupBy("customerContractLineId")
    .execute();
  for (const row of rows) {
    positions.set(row.customerContractLineId, {
      deferredAmount: Number(row.deferredAmount),
      deferredBase: Number(row.deferredBase),
      assetAmount: Number(row.assetAmount),
      assetBase: Number(row.assetBase)
    });
  }
  return positions;
}

export function samePosition(a: ContractPosition, b: ContractPosition) {
  return (
    equals(a.deferredAmount, b.deferredAmount) &&
    equals(a.deferredBase, b.deferredBase) &&
    equals(a.assetAmount, b.assetAmount) &&
    equals(a.assetBase, b.assetBase)
  );
}

/** A signed credit (negative = debit) as the stored natural-balance amount of
 *  an account of `accountClass`. */
export function signedCreditAmount(accountClass: string, amount: number) {
  const type = accountTypeFromClass(accountClass);
  return amount >= 0 ? credit(type, amount) : debit(type, -amount);
}
