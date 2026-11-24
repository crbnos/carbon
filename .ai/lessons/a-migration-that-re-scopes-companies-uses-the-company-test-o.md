---
paths: []
triggers: []
promoted: null
---
# A migration that re-scopes companies uses the company test of the migration it follows

**Context:** `20261008211304_reset-accounting.sql` deletes the journals of every company except the demo-template companies. It finds those as the companies that hold a `JE-SEED-%` journal, which only tier 09 of the dataset seed writes. `20261009004448_accounting-cutover.sql` (section 7) then gives the spared companies a cutover, because their history is already in Carbon.

**Problem:** The second migration first chose its companies by `accountingEnabled = true`. Only the dev CLI ever set that flag. A template applied through onboarding or Settings → Demo Data has it false. So those companies kept their Posted seed journals, but got no cutover. Their seeded Posted Opening Balance then blocked the enable wizard for good. Commit 38602af774 changed the test to the reset's `JE-SEED-%` test.

**Rule:** If migration B acts on the companies that migration A chose, B copies A's predicate. Do not use a flag that "should" mean the same thing. Before you write the `WHERE`, read A's predicate. Then grep every writer of any flag you plan to use instead.

**Applies to:** `packages/database/supabase/migrations/20261008211304_reset-accounting.sql`; `packages/database/supabase/migrations/20261009004448_accounting-cutover.sql`; any data migration that follows another data migration.
