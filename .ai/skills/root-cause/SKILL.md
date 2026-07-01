<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

---
name: root-cause
description: Read-only root-cause analysis for bugs. Produces a brief with root cause, files to change, approach, and risks. No edits, no commits. Use before /fix or conductor.
---

# root-cause — read-only bug analysis

You are performing a **read-only** root-cause analysis. You will not edit any files, create branches, or run commands that mutate state. Your output is a brief that a human or the `/fix` skill will act on.

**Announce at start:** "I'm using the root-cause skill to analyze this bug."

## 0. Load context

Before investigating, load these in order:

1. **Issue / bug report** — read the full description, repro steps, and any linked threads.
2. **`.ai/lessons.md`** — check for known pitfalls related to the affected area.
3. **AGENTS.md Task Router** — match the bug's domain to the relevant guides in `.ai/rules/` and module `AGENTS.md` files.
4. **Module AGENTS.md** — read the `AGENTS.md` in the affected module/package directory for local architecture, imports, and conventions.

## 1. Reproduce mentally

Trace the bug from symptom to origin without running code:

1. **Read the error** — full stack trace, error message, HTTP status. Note file paths and line numbers.
2. **Identify the entry point** — which route, loader, action, or event handler is involved?
3. **Trace the data flow** — follow the call chain: route → service function → database query → response. Note every transformation.
4. **Check the schema** — read the relevant migration(s) and types. Verify column names, types, and constraints match what the code expects.

## 2. Carbon-specific checks

Run through these common Carbon failure modes:

| Check | What to look for |
|-------|-----------------|
| **companyId scoping** | Every query that reads or writes tenant data MUST filter by `companyId`. Missing scoping = cross-tenant data leak or empty results. |
| **RLS policy gaps** | New tables or columns without corresponding RLS policies. Check `packages/database/supabase/migrations/` for the table's policies. |
| **Stale generated types** | Code referencing columns/tables added in a recent migration but `pnpm run generate:types` was not run afterward. |
| **Permission scope mismatch** | `requirePermissions()` or `permissions.can()` using a string that doesn't match the DB scope. See `BACKWARD_COMPATIBILITY.md` — scopes are FROZEN. |
| **Service function signature drift** | Caller passing args that don't match the service function's current signature (params added/removed/reordered). |
| **Multi-tenancy in new code** | New tables missing `companyId` column, composite PK `("id", "companyId")`, or `id('prefix')` default. |
| **Import path staleness** | Code importing from a path that was moved without a re-export bridge. |

## 3. Narrow the root cause

- **Single hypothesis.** Form one specific theory: "The bug is caused by X in file Y because Z."
- **Verify against the code.** Read the suspected file(s) and confirm the theory holds. If it doesn't, form a new hypothesis — don't force-fit.
- **Distinguish root cause from symptom.** A `TypeError` in the UI might be caused by a missing RLS policy three layers down. Keep tracing until you reach the origin.

## 4. Assess confidence

Rate your confidence:

| Level | Meaning |
|-------|---------|
| **HIGH** | Root cause identified with clear evidence in the code. The fix path is obvious. |
| **MEDIUM** | Strong hypothesis supported by code reading, but runtime confirmation would help. |
| **LOW** | Multiple plausible causes, insufficient code evidence, or the bug may be environmental. |

**If LOW_CONFIDENCE, say so explicitly.** Do not present a guess as a finding.

## 5. Output the brief

Produce exactly this structure (~400 words max):

```markdown
## Root-Cause Brief

**Bug:** <one-line summary>

**Summary:** <2-3 sentences explaining the symptom and its observable impact>

**Root cause:** <precise explanation of why the bug occurs, referencing specific
files and line numbers>

**Confidence:** HIGH | MEDIUM | LOW
<if LOW: explain what's uncertain and what would resolve it>

**Files to change:**
- `path/to/file.ts` — <what needs to change and why>
- `path/to/other.ts` — <what needs to change and why>

**Approach:**
1. <step 1>
2. <step 2>
3. <step 3>

**Risks:**
- <risk 1 — e.g., "changing this service signature affects 3 callers">
- <risk 2 — e.g., "migration touches a production-critical table">

**BC impact:** <NONE | list any FROZEN/STABLE surfaces touched, per BACKWARD_COMPATIBILITY.md>
```

## Guardrails

- **Read-only.** No file edits, no `git` writes, no branch creation, no commits, no pushes.
- **No speculative fixes.** Don't suggest "try this and see if it works." Identify the cause or say you can't.
- **Stay scoped.** Analyze the reported bug. Don't expand into unrelated issues you notice.
- **Cite evidence.** Every claim in the brief must reference a specific file, line, migration, or policy.
