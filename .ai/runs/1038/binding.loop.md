---
id: "1038"
kind: feature
title: Gapless journal numbering + legal invoice series
risk: high
issue: 1038
acceptance:
  - No gap on failure — posting rollback reverts the sequence increment; next post gets the same number the failed attempt would have.
  - Concurrency same-company — atomic single-statement allocation kills the SELECT-then-UPDATE duplicate race.
  - Sequence lockdown — immutability trigger rejects format edits, next-rewind, and delete on used legal sequences for every role incl service role.
  - Draft lifecycle — new manual JE/payment/memo/invoice drafts carry NULL number + Draft-{id6} placeholder; posting assigns in-transaction; CHECK forbids number-less non-Draft rows.
  - History untouched — existing numbers byte-for-byte stable; gaplessFrom stamped on the six accounting sequences.
  - Legal series — legalSeries table + atomic per-series allocator + immutability trigger; one active default per company+country+type.
  - RPC guard — get_next_sequence RPC RAISEs on the six accounting sequences; operational sequences unchanged.
---

# Grooming context

Full design: `.ai/specs/2026-07-04-gapless-numbering-legal-series.md`. All Open Questions resolved [x].

Environment constraint: this loop worktree has NO database/Supabase and cannot run `generate:types` or apply migrations. Therefore:
- The migration (raw SQL) is the primary provable artifact — validated by the @carbon/checks conformance gate + review.
- Edge-function (Deno) changes are deliverable (not in the app turbo typecheck graph) but their runtime behavior is UNVERIFIABLE here (no stack) → PR flagged needs-verification.
- App-layer series CRUD service/route/UI reference the new legalSeries table + columns; they CANNOT typecheck until types are regenerated against the applied migration on a machine with a DB. Deferred as documented follow-up (surfaced on the PR), not built red.

Out-of-scope / owned by coordinating specs (record as disputed, do not iterate against):
- Audit-log appearance of sequence edits + JE export + isBackdated flag → record-integrity spec #1047 owns audit.config.ts and the export.
- legalSeries selection / ATCUD / hash-chaining / format rendering / document wiring → e-invoicing spec #1054.
