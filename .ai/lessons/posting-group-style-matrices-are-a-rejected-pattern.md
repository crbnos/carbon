---
paths: [".ai/specs/*.md"]
triggers: ["postingGroup", "PostingGroup", "posting group"]
promoted: null
---
# Posting-group-style matrices are a rejected pattern

**Context:** Designing multi-jurisdiction tax determination; the spec anchored on the customerType × itemPostingGroup posting-group matrix as "Carbon precedent."

**Problem:** The posting-group matrix was deliberately REMOVED (`20260229000000_drop-posting-groups.sql`) because the indirection was confusing — but the 2023 creation migration still exists, so searches find it first and it masquerades as live precedent. Anchoring a new design on it resurrects a pattern the project already rejected.

**Rule:** Do not design N×M classification-matrix configuration (party-group × item-group → outcome). Prefer flat company defaults (`accountDefault`) plus direct per-entity assignment with per-child override (the Xero model). Before citing any schema "precedent," grep for a later `DROP`/rename migration.

**Applies to:** New config/settings design anywhere; accounting/tax/posting; `.ai/specs/`, `packages/database/supabase/migrations/`.
