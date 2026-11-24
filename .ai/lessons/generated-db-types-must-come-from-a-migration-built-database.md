---
paths: []
triggers: []
promoted: null
---
# Generated DB types must come from a migration-built database, never a restored snapshot

**Context:** `crbn restore` ends with `pnpm db:types`. Those regenerated types were then swept into a commit by `git add -A`, putting 194 lines of unrelated churn into a webhooks/RLS PR.

**Problem:** A production snapshot carries whatever the source environment accumulated outside the migration stream, so types generated from it describe *that* database rather than the schema the migrations define. The diff added a `v_readable_id` relation absent from `main` — not a schema object at all, but a plpgsql local (`v_readable_id TEXT;` … `SELECT … INTO v_readable_id, v_company_id`) that ran somewhere in a plain-SQL context, where `SELECT … INTO` is CREATE-TABLE-AS. An accidental artifact table exists in the snapshot, and regenerating baked it into the repo's public type surface, alongside `procedureStep`→`procedureAttribute` FK-name churn.

**Rule:** Never commit `packages/database/src/types.ts` generated after a `crbn restore` — regenerate against a migration-built database first. `crbn restore` now warns about this. Stage generated types explicitly rather than with `git add -A`, and diff them before committing: any relation appearing that no migration defines is drift from the source environment, not a schema change. Separately, `SELECT … INTO <name>` in a SQL (non-plpgsql) context silently creates a table — a real hazard when copying plpgsql bodies into migrations.

**Applies to:** `packages/dev/src/commands/restore.ts`, `packages/database/src/types.ts`.
