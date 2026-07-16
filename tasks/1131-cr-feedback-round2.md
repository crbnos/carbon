# Task Brief: PR #1132 — CodeRabbit Round-2 Feedback (4 items)

## Context

PR #1132 ("docs: Carbon extensibility architecture spec", closes #1131) has received a second CodeRabbit review (run `9460a62a`, submitted 2026-07-12T13:59:49Z) with 4 new actionable comments on `.ai/specs/2026-07-12-extensibility-architecture.md`.

The worktree is at `/tmp/wt-extensibility` on branch `docs/extensibility-architecture-spec` (already pulled to HEAD `4a74e729a`).

Your job: apply all 4 changes to the spec, commit, and push.

---

## Changes Required

### 1. Outbox commit-order delivery — line 123 area (Major)

**Problem:** The spec implies strict commit-order delivery for the transactional outbox based on `ORDER BY (status, createdAt)`. Wall-clock `createdAt` is not a commit sequence number, so the ordering claim is incorrect.

**Fix:** Update the outbox relay description to:
- Remove any claim of strict commit-order delivery
- State explicitly that dispatch ordering is **best-effort** (relay polls by `(status, createdAt)` but wall-clock timestamp ≠ commit sequence)
- Document the actual guarantee: **at-least-once delivery with deduplication via `eventId`**, without strict commit-order
- Add a note: if strict per-aggregate ordering becomes a requirement, a sequence-number approach (per-aggregate monotonic counter) is the path forward, but is not in scope for this spec

### 2. Slug validation — line 191-195 area (Minor — quick win)

**Problem:** The manifest slug regex `^[a-z][a-z0-9-]*$` accepts trailing hyphens (`foo-`) and consecutive hyphens (`foo--bar`).

**Fix:** Tighten the regex to:
```
^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$
```
This rejects trailing hyphens and consecutive hyphens by requiring at least one alphanumeric character after every hyphen. Update the normalization rule, any examples that would fail the new rule, and the inline description text.

### 3. Schema-extension DDL authorization — line 289-302 area (Major)

**Problem:** The spec uses `ext_*` naming convention as the privilege boundary, but naming alone provides no PostgreSQL privilege isolation. Any role can touch any table with the right prefix name.

**Fix:** Replace the `ext_*` naming-only approach with a proper PostgreSQL privilege model:
- Each extension gets a **dedicated schema**: `ext_<slug>` (e.g., `ext_coating_inspection`)
- Define two roles per extension:
  - **Migrator role** (`ext_<slug>_migrator`): CONNECT + CREATE/ALTER/DROP on schema `ext_<slug>` only — used during migration runs
  - **Runtime role** (`ext_<slug>_runtime`): SELECT/INSERT/UPDATE/DELETE on extension tables in `ext_<slug>` only — used by application runtime
- Core schema (`public`) and other extension schemas are off-limits to both roles
- The migration generator (spec section on `carbon ext generate`) scaffolds these roles and schema-scoped grants automatically
- Update the spec text and any examples/DDL snippets to reflect per-schema isolation rather than `ext_*` naming

### 4. Archive FK cascade — line 304-310 area (Major)

**Problem:** The uninstall/archive procedure renames tables and revokes access, but the `ON DELETE CASCADE` foreign key to the core relation remains active. If a core row is later deleted, the archived extension data is silently destroyed, contradicting the "reversible, non-destructive restoration" guarantee.

**Fix:** Update the archive procedure to explicitly:
1. At archive time: **drop or convert the FK** from `ON DELETE CASCADE` to `ON DELETE SET NULL` (preferred) or `ON DELETE RESTRICT`
2. Document that restoration must re-establish the FK constraint **only if the referenced core row still exists**, otherwise the side table row is orphaned and the admin must reconcile
3. If the spec mentions copying data into a detached archive structure as an alternative, that is also acceptable — but whichever approach is chosen must be described clearly with the FK lifecycle spelled out

---

## Verification

After editing:
- The spec must be internally consistent — all 4 changes should align with the rest of the spec's design principles
- No formatting regressions (the spec uses standard Markdown; preserve heading levels, code blocks, etc.)
- Run a quick sanity check: `wc -l .ai/specs/2026-07-12-extensibility-architecture.md` (should be roughly 760+ lines after additions)

## Commit & Push

```bash
cd /tmp/wt-extensibility
git add .ai/specs/2026-07-12-extensibility-architecture.md
git commit -m "docs: address CodeRabbit round-2 feedback on extensibility spec

- Fix outbox ordering guarantee: document as best-effort, not commit-ordered
- Tighten slug regex to reject trailing/consecutive hyphens
- Replace ext_* naming with per-extension schema + migrator/runtime role model
- Fix archive FK: convert ON DELETE CASCADE to SET NULL at archive time"
git push origin docs/extensibility-architecture-spec
```

After push, report: commit hash, line count of the updated spec, and a brief summary of each change made.
