# Task Brief: PR #1132 Review Feedback — Extensibility Architecture Spec

**Branch:** `docs/extensibility-architecture-spec`
**Worktree:** `/tmp/wt-extensibility`
**Spec file:** `.ai/specs/2026-07-12-extensibility-architecture.md`

You are making targeted edits to the extensibility architecture spec at the worktree path above to address 7 unresolved CodeRabbit review comments. This is a documentation-only PR — no application code changes are needed.

## Setup

```bash
cd /tmp/wt-extensibility
git fetch origin
git merge origin/main
```

## Required Changes

Address all 7 issues below by editing `.ai/specs/2026-07-12-extensibility-architecture.md`:

---

### 1. Corpus-gate scope (Minor — Thread 1)
**Problem:** The TLDR implies every published extension participates in the corpus gate, but the v1 decision says only first-party extensions gate releases; community extensions are report-only. This is ambiguous.

**Fix:** In the main corpus-gate section (and anywhere else it's described), add an explicit statement that:
- First-party extensions: gate release pipeline (failing corpus tests block merge to main)
- Community/third-party extensions: report-only (corpus test failures generate a report but do not block releases)

Also update the TLDR if it overstates community extension gating.

---

### 2. Event-point versions in workflow triggers (Major — Thread 2)
**Problem:** Workflow and `waitForEvent` examples use unversioned event names like `inventory.receipt.posted`. If the payload schema evolves, existing workflows receive incompatible payloads.

**Fix:**
- Require all workflow trigger references to include a version suffix: `inventory.receipt.posted@1`
- Update ALL workflow examples in the spec to use `@<version>` suffixes
- Add a compatibility resolver rule: define what happens when a workflow references `event@1` but only `event@2` exists (e.g. the platform maintains backwards-compatible shims, or workflows must opt-in to upgrades explicitly)

---

### 3. Security and access control (Major — Thread 3)
**Problem:** The spec has no section on authorization — who can register hooks, what sandbox boundaries apply to extension code execution, and what database roles execute DDL for schema extensions.

**Fix:** Add a **Security & Access Control** section (or subsection under the relevant sections) covering:
- **Hook registration authorization:** Which identities can register hooks (e.g. platform admins only, or any authenticated user with a specific permission)? How are hooks authenticated at runtime?
- **Extension code sandbox:** How is extension code isolated? (e.g. runs in the same Node process, a worker, or a separate container?) What APIs are available vs. restricted?
- **Schema extension DDL authorization:** What Postgres role executes extension migrations? How is this role scoped to prevent privilege escalation?
- **Uninstall safety:** What prevents an extension from taking down the platform during schema removal?

---

### 4. Atomic post-commit event delivery (Major — Thread 4)
**Problem:** The spec mentions at-least-once delivery and `eventId` deduplication, but doesn't prevent the case where a DB commit succeeds but the Inngest event enqueue fails — leading to lost events.

**Fix:** Add a **transactional outbox** pattern to the event delivery section:
- Describe writing an outbox record in the same DB transaction as the domain write
- A background relay reads the outbox and dispatches to Inngest
- Define retry policy (e.g. exponential backoff, max retries)
- Define dead-letter handling (where do failed events go after max retries?)
- Clarify that `eventId` deduplication handles duplicates from the relay; it does not recover events that were never written to the outbox

---

### 5. Canonical table-name normalization (Major — Thread 5)
**Problem:** The manifest uses slug `coating-inspection` but the generated table name is `ext_coatingInspection_receiptLine`. The normalization rules are not specified — different implementations could produce different identifiers.

**Fix:** Add a canonical normalization spec for extension table names:
- Rule: kebab-case slug → camelCase identifier (e.g. `coating-inspection` → `coatingInspection`)
- Prefix: `ext_`
- Full pattern: `ext_<camelCaseSlug>_<tableName>`
- Length limit: PostgreSQL has a 63-byte identifier limit; specify how the system handles slugs + table names that would exceed this (truncation + hash suffix, or manifest validation error)
- Collision detection: what happens if two extensions generate the same table identifier? (manifest validation must reject)
- Update the example in the spec to be consistent (manifest slug must match the generated name derivation)

---

### 6. extensionInstall.customFields (Minor — Thread 6)
**Problem:** The `extensionInstall` schema includes a `customFields` JSONB column, which contradicts the spec's own principle of rejecting unstructured JSONB growth.

**Fix:** Either:
- **Remove** `customFields` from the schema if it has no clearly justified use, OR
- **Classify it explicitly** as legacy platform metadata with:
  - Defined ownership (who writes to it, who reads from it)
  - Schema constraints (JSON Schema or Zod validation at write time)
  - Lifecycle semantics (when is it deprecated/migrated?)

Do not leave it as an unexplained exception to the core principle.

---

### 7. Generated side-table audit columns (Major — Thread 7)
**Problem:** The generated extension side-table example only includes `createdAt`/`updatedAt`, but the acceptance criteria require audit columns on every generated table, and Carbon's DB conventions require `createdBy`/`updatedBy` user references.

**Fix:** Update the generated side-table example to include `createdBy`/`updatedBy` (user FK references), OR explicitly document a tested side-table exemption with clear rationale for why side tables don't need user references (and add an acceptance criterion verifying the exemption is intentional).

---

## Commit

After making all changes:

```bash
cd /tmp/wt-extensibility
git add .ai/specs/2026-07-12-extensibility-architecture.md
git commit -m "docs: address CodeRabbit review feedback on extensibility spec

- Clarify corpus-gate scope (first-party gates, community report-only)
- Add event-point version suffixes to all workflow trigger examples
- Add Security & Access Control section (hook auth, sandbox, DDL roles)
- Add transactional outbox pattern for atomic event delivery
- Define canonical table-name normalization rules
- Clarify extensionInstall.customFields exception or remove it
- Add createdBy/updatedBy to generated side-table example"
git push origin HEAD:docs/extensibility-architecture-spec
```

## Done Signal

When complete, output the git commit hash and confirm the push succeeded.
