---
paths: ["packages/database/supabase/migrations/*.sql", "ci/src/migrations.ts"]
triggers: ["CREATE OR REPLACE VIEW"]
promoted: null
---
# Backdated migration timestamps break remote deploys

**Context:** CI `supabase db push --include-all` failed on all remotes with `column pi.balance does not exist` while applying `20260616061244`, which recreated the `purchaseInvoices` view.

**Problem:** A migration merged with a timestamp OLDER than already-deployed migrations gets applied out of order on remotes: the remote had already run `20260630095023` (drops `purchaseInvoice.balance`), so the backdated view recreation referenced a dropped column. Worse, the newer `20260630*` batch had forked its view body from a pre-fix definition, silently reverting the backdated migration's fix (`supplierShippingCost` multiply vs divide) — the backdated migration was both broken AND dead code.

**Rule:** Never merge a migration whose timestamp is older than the newest migration already on `main`/deployed. Before writing a view/RPC recreation, fork from the NEWEST definition of that view (grep all migrations, take the last). When rescuing a failed backdated migration, strip the superseded parts and re-land the still-wanted change in a fresh forward-dated migration; don't rename already-partially-applied files (re-applies them).

**Applies to:** `packages/database/supabase/migrations/`, `ci/src/migrations.ts`, any long-lived branch adding migrations.
