---
paths: []
triggers: ["journalEntries", "totalDebits", "tb-balanced", "journal_posted_immutable", "journalLine"]
promoted: null
---
# Journal debit/credit is derived from account class + amount sign, not the raw sign

**Context:** Seeding a Cash sale as a journal via SQL, I used Cash (Asset) `amount = +1000` and Sales (Revenue) `amount = -1000`, assuming `+ = debit, - = credit` (which the `journal` AGENTS.md states for the *stored* value). The `journalEntries` view then reported the entry as `totalDebits = 2000, totalCredits = 0` — unbalanced — and the period-close "Trial balance in balance" auto-check (`tb-balanced`) refused the close.

**Problem:** `journalEntries.totalDebits`/`totalCredits` are computed from **account class AND amount sign**: Asset/Expense `amount>0` OR Liability/Equity/Revenue `amount<0` → debit; the mirror → credit. So a *positive* amount on a Revenue account is a **credit**, not a debit. A correctly-balanced sale is Cash (Asset) `+1000` and Sales (Revenue) `+1000` — both positive. The raw `SUM(amount)` the balance RPCs use is a separate, class-agnostic signed sum; don't conflate the two.

**Rule:** When hand-seeding `journalLine` rows, set the sign to move the account toward its natural balance: `+` increases an Asset/Expense (debit) and increases a Liability/Equity/Revenue (credit). Verify against the `journalEntries` view (`totalDebits == totalCredits` per `journalEntryId`) before relying on the data — an unbalanced entry silently blocks period close. Posted `journal`/`journalLine` rows are immutable (`journal_posted_immutable` / `journalLine_posted_immutable`); to correct seeded mistakes you must disable those triggers on the local DB (superuser), never in a migration.

**Applies to:** any SQL journal fixtures; the `journalEntries` view; the `tb-balanced` close check in `computePeriodReadiness` (`accounting.service.ts`).
