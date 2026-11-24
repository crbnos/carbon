---
paths: ["packages/ee/src/accounting/**"]
triggers: ["toDebitSignedAmount", "toPostingDateString"]
promoted: null
---
# Carbon journal amounts are natural-balance-signed, not debit-signed

- **Context:** Wiring Rillet journal posting sync; first live push of a real
  `Purchase Receipt` journal failed UNBALANCED_JOURNAL (+300/+300).
- **Problem:** The accounting sync engine (preflight balance check, netting,
  consolidation, all provider journal mappers) assumed `journalLine.amount`
  is debit-signed (positive = debit, negative = credit, sum = 0). Carbon's
  post-* edge functions actually sign by the account's NATURAL balance
  (`credit("liability", x)` stores +x — packages/database/src/ledger.ts), so real
  journals balance as debits == credits, not signed-sum-zero. Also:
  Kysely/pg returns DATE columns as JS Date objects — `postingDate.slice`
  crashes; and disabled-config skip results without `localId` make the
  drain report the misleading "No sync result returned for entity".
- **Rule:** Convert to debit-signed at the fetch edge with
  `toDebitSignedAmount(account.class, amount)` (join account.class in the
  journal-line query), normalize dates with `toPostingDateString`, and
  always set `localId`/`remoteId` on every SyncResult, including early
  skips. Never trust the debit-signed assumption against live journal data
  without checking the edge functions' credit()/debit() helpers.
- **Applies to:** packages/ee/src/accounting (journal syncers, posting
  preflight, consolidation), any new accounting provider's journal mapper.
