// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The journal of a legacy memo: the lines `post-memo` writes today, from the
// stored memo, with today's account defaults
// (.ai/specs/2026-10-08-accounting-cutover.md section 5a).
//
// Built by `rebuildMemoJournals` (post-memo/post-memo-transaction.ts), the
// builder the void of a memo dated before the cutover uses, with the status
// of a posting before the cutover: a memo with no reason account and an
// empty Sales Returns default gets a stand-in reason line, as
// `postMemoTransaction` writes it. A contract or rental credit memo books
// as a plain memo on the sales account: its contract and deferral legs came
// from positions and schedule rows that are not journal lines.

import type { KyselyTx } from "@carbon/database/client";
import { rebuildMemoJournals } from "../../post-memo/post-memo-transaction";
import { legacyMemos } from "./detect";
import { chunks, type LegacyDocumentJournal } from "./write";

export async function buildLegacyMemoJournals(
  trx: KyselyTx,
  { companyId, cutoverDate }: { companyId: string; cutoverDate: string }
): Promise<LegacyDocumentJournal[]> {
  const memos = await legacyMemos(trx, { companyId, cutoverDate });
  const journals: LegacyDocumentJournal[] = [];
  for (const batch of chunks(memos)) {
    const rebuilt = await rebuildMemoJournals(trx, batch, companyId, {
      postingStatus: "Provisional",
      contractCredit: "sales"
    });
    batch.forEach((memo, index) => {
      const { lines, dimensions } = rebuilt[index]!;
      journals.push({
        documentId: memo.id,
        description: `${memo.direction} Memo ${memo.memoId}`,
        postingDate: String(memo.postingDate),
        sourceType: memo.direction === "Credit" ? "Credit Memo" : "Debit Memo",
        lines: lines.map(({ companyId: _, ...line }) => ({
          ...line,
          dimensions: {},
          dimensionValues: dimensions
        }))
      });
    });
  }
  return journals;
}
