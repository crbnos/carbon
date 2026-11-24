---
paths: ["packages/database/src/seed-data.ts", "packages/database/src/seed-dev.ts"]
triggers: ["periodCloseTaskDefinition", "seedCompany", "seed-data"]
promoted: null
---
# Changing `seed.data.ts` only reaches NEW companies — existing companies need a reconciling migration

**Context:** The period-close checklist changed (dropped "Close the period", reclassified two Auto/Manual tasks to Action). Those edits went into `packages/database/supabase/functions/lib/seed.data.ts` (+ `seed-company` / `seed-dev`), which only run on **company creation**. Existing companies — seeded by the original migration's `INSERT … FROM company` — kept the old task set, so the fixes never reached them.

**Problem:** Seed data (`seed.data.ts` + `seed-company`) and migration-time seeds (`INSERT … FROM company`) are two different populate paths. Editing the former fixes new companies; existing companies are frozen at whatever the migration inserted. The two silently drift.

**Rule:** When you change seeded per-company template rows (`periodCloseTaskDefinition`, `paymentTerm`, `accountDefault`, …) in `seed.data.ts`, also write an idempotent **reconciling migration** for existing companies (`INSERT … FROM company … ON CONFLICT DO UPDATE`, plus deletes for removed rows), guarded on the `system` user for the `createdBy` FK. Validate it in a rolled-back psql txn that simulates the old state. Deleting instance rows to force re-instantiation is fine when no real data depends on them (confirm first).

**Applies to:** any change to `packages/database/src/seed-data.ts` per-company templates; `seedCompany` (`apps/erp/app/modules/settings/settings.service.ts`), `seed-dev.ts`.
