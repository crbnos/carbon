---
paths: []
triggers: []
promoted: null
---
# A globally-unique primary key means a fixed id literal collides across companies

**Context:** The onboarding demo dataset hard-coded UUID literals as `externalLink.id` in two places so the public share URLs (`/share/quote/:id`, `/share/supplier-quote/:id`) would be stable for documentation screenshots. Seeding the first company worked; the second one onto the same database died with `duplicate key value violates unique constraint "externalLinks_pkey"`.

**Problem:** Almost every Carbon table has the composite PK `("id","companyId")`, which makes a repeated `id` harmless across tenants — so a fixed literal *looks* safe by analogy. But a handful of tables are keyed on `id` alone: `externalLink` (`PRIMARY KEY ("id")`, `20241030005037_external-links.sql`) and `period` (`PRIMARY KEY ("id")`, no `companyId` column at all). For those, a literal is a database-wide singleton. The failure only appears on the *second* company, so it passes every single-company test and first surfaces in production or in a shared dev database.

**Rule:** Never write a literal primary key in seed/fixture code — let the column's `id()`/`xid()` default mint it and read the value back (`insertId`). Before assuming a repeated id is tenant-safe, check the actual `PRIMARY KEY` in the migration, not the table-template convention. For a global table with no unique key to conflict against (`period`), a read-then-insert also needs `pg_advisory_xact_lock` or a unique index — two companies seeding concurrently will otherwise both insert, and the duplicates are visible to every tenant.

**Applies to:** `packages/database/src/datasets/tiers/**`; any SQL/TS fixture that writes `externalLink`, `period`, or another `PRIMARY KEY ("id")` table; `.claude/rules/onboarding-company-templates.md`.
