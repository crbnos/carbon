---
paths:
  - "apps/**"
  - "packages/**"
  - ".ai/skills/**"
---

# Harness-Engineering Core Principles

Active working principles distilled from the harness-engineering methodology. These are not reference material — they change how every task is approached.

## Just-in-Time Context Loading

**Load only what the task needs.** The Task Router + closest module `AGENTS.md` form the active working set. Don't preload unrelated subsystem docs.

Wrong:
- Reading `.ai/rules/*` for modules you won't touch
- Loading domain docs (accounting, MES) when fixing a UI bug
- Importing convention files "just in case"

Right:
- Check the Task Router for the task type
- Load only the listed guides
- JIT-load module-specific rules when you reach that layer

This prevents context bloat and keeps the signal clear.

## Precedent-First Construction

**Before writing new code, find the closest existing implementation.** Carbon has 100+ modules with established patterns — most work is adaptation, not invention.

Protocol:
1. Identify the task type (form, service, migration, component)
2. Find the closest precedent (grep for similar components/screens)
3. Copy the structure, adapt the logic
4. Cite the precedent path in your plan/commit

When no precedent exists, you have permission to create a new pattern — but document it as such and be prepared to defend the choice.

Precedent searches:
- UI components: `grep -r "packages/react/src" apps/erp/app/components`
- Forms: grep for `ValidatedForm` + validator pattern
- Services: check the module's `.service.ts` first
- Migrations: find similar schema changes in `packages/database/supabase/migrations/`

## Evidence Matching

**Match proof strength to claim type.** "It works" needs evidence; which evidence depends on the claim:

| Claim | Proof Method |
|-------|-------------|
| "Changes behavior" | Unit test showing before/after (red→green) |
| "Fixes visual bug" | Browser screenshot (before/after) or visual review |
| "Migration works" | `generate:types` succeeds + query against new schema |
| "No regression" | Run existing test suite for touched packages |
| "API contract unchanged" | TS typecheck passes on dependent packages |
| "Performance improved" | Benchmark or profiler output |

Never claim "done" without showing the matching evidence. Evidence mismatch → not done.

## Proof-With-Work Pattern

**Every checkpoint includes its proof script.** A doer session that leaves no reproducible evidence is incomplete.

When shipping a bug fix or feature:
- Include the test that proves it works (or the runbook for manual verification)
- Browser changes: include the navigation steps to reach the changed UI
- API changes: include curl commands or test client usage

This makes every change independently verifiable.

## Infrastructure Learning Loop

**Corrections become permanent safeguards.** When you encounter a bug/mistake:

1. **Fix the immediate issue** — get the build/stable state back first
2. **Diagnose root cause** — missing test? unclear rule? false assumption?
3. **Assess recurrence** — if 2+ occurrences → add to `.ai/lessons.md`
4. **Propose infrastructure** — could a lint rule, type check, or gate catch this?
5. **Document the rule** — if a human would benefit, add/update a rule

Examples of corrections that became infrastructure:
- Missing `companyId` scoping → added rule + expect all services to scope queries
- Composite FK breaks PostgREST embed → added lesson + documented the pattern
- Stale generated types → made `generate:types` a required step before typecheck

This turns one-off fixes into permanent improvements.

## Authority Boundaries (What to Ask First)

These decisions require explicit human approval — never decide autonomously:

- **Scope reduction** — dropping features, simplifying acceptance criteria
- **Architecture changes** — new patterns, state management, data flow changes
- **Public contracts** — API signatures, database schema, RPC parameters, exported types
- **Production dependencies** — new packages in `dependencies` (dev deps are okay)
- **Auth/RBAC/multi-tenancy** — permission checks, RLS policies, `companyId` handling
- **Production-critical schema** — financial data, audit trails, business-critical workflows
- **Cross-module changes** — touching 3+ modules not covered by existing spec

When blocked on any of these, surface the decision with your recommendation rather than guessing.
