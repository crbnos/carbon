---
name: root-cause
description: Read-only root-cause analysis for any bug, test failure, or unexpected behavior — before proposing or writing any fix. Produces a brief with the root cause, files to change, approach, and risks. No edits, no commits, no state-changing commands. Use before /fix or /conductor whenever the cause isn't already proven. If static reading can't reach a confident cause, it hands off to /debugging-difficult-bugs for runtime instrumentation.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# root-cause — read-only bug analysis

You are performing **read-only** analysis: no file edits, no branches, no
commands that mutate state. Output is a brief that a human or `/fix` acts on.

The iron rule: **no fix without a root cause.** A fix proposed before the cause
is understood is a guess, and guesses create new bugs. Symptom patches are
failure even when they make the error disappear.

**Announce at start:** "Using the root-cause skill — read-only analysis of this
bug."

## Step 0: Load context

1. The bug report — full description, repro steps, linked threads/issues.
2. `.ai/lessons.md` — known pitfalls in the affected area.
3. Root `AGENTS.md` Task Router → the matching `.ai/rules/` guides.
4. The affected module/package `AGENTS.md`.

## Step 1: Establish the facts

1. **Read the error completely** — full stack trace, message, HTTP status, file
   and line numbers. The error text often contains the answer.
2. **Reproduce or trace.** State the exact repro steps. If you cannot reproduce
   even mentally, gather more data — do not guess.
3. **Check recent changes**: `git log --oneline -20 -- <affected paths>` and the
   branch diff. Most bugs live in what changed last.
4. **Trace the data flow** from entry point to origin: route → loader/action →
   service function → query → response. Note every transformation. Follow the
   bad value **backward** to where it is first wrong — fix at the source, not
   where the symptom surfaces (see `references/root-cause-tracing.md`).
5. **Check the schema**: read the *newest* relevant migrations (order by
   timestamp) and generated types. Column names and constraints must match what
   the code assumes.

## Step 2: Carbon-specific failure modes

Check each of these before inventing exotic theories:

| Check | What to look for |
|-------|------------------|
| companyId scoping | A query missing `companyId` filtering → cross-tenant leak or empty results |
| Stale generated types | Code references columns from a new migration but `pnpm run generate:types` wasn't run — typecheck greens lie |
| RLS policy gaps | New table/column without policies; check the table's migrations |
| Permission strings | `requirePermissions()` / `permissions.can()` scopes are string literals — invisible to typecheck; grep the whole repo after any scope rename |
| Service signature drift | Caller args don't match the service function's current signature |
| Migration ordering | A migration backdated older than deployed ones applies out of order on remotes (see `.ai/lessons.md`) |
| Form submission | `ValidatedForm` only submits on a native submit with a `submitter`; react-aria number/date fields commit hidden inputs on **blur** (see `/test` for details) |
| Import staleness | Import from a moved path with no re-export bridge |

## Step 3: One hypothesis at a time

1. Form a **single** specific hypothesis: "X in file Y causes the bug because Z."
2. Verify it against the code you can read. If the code contradicts it, discard
   it — don't force-fit.
3. Distinguish cause from symptom: a UI `TypeError` may originate three layers
   down. Keep tracing until you reach the origin.
4. **Three-strikes rule:** if 3 hypotheses have failed, the problem is likely
   architectural (shared state, coupling, a wrong pattern) — STOP, write up what
   you ruled out, and surface the architectural question to the human instead of
   producing hypothesis #4.

## Step 4: Confidence

| Level | Meaning |
|-------|---------|
| HIGH | Cause identified with code evidence; fix path obvious |
| MEDIUM | Strong code-supported hypothesis; runtime confirmation would help |
| LOW | Multiple plausible causes or the bug appears runtime/environment-dependent |

If MEDIUM or LOW **and** the bug involves runtime state, ordering, caching,
concurrency, or manual reproduction → recommend `/debugging-difficult-bugs`
(temporary JSONL instrumentation) as the next step instead of guessing. Never
present a guess as a finding.

## Step 5: Output the brief

Produce exactly this structure (~400 words max):

```markdown
## Root-Cause Brief

**Bug:** <one line>
**Summary:** <2–3 sentences: symptom and observable impact>
**Root cause:** <why it happens, citing file:line>
**Confidence:** HIGH | MEDIUM | LOW
<if not HIGH: what is uncertain and what would resolve it — e.g. "instrument via /debugging-difficult-bugs">

**Files to change:**
- `path/to/file.ts` — <what and why>

**Approach:**
1. <step>

**Risks:**
- <e.g. "signature change affects 3 callers">

**BC impact:** <NONE | FROZEN/STABLE surfaces touched, per BACKWARD_COMPATIBILITY.md>
```

## Guardrails

- **Read-only.** No edits, no `git` writes, no migrations, no DB commands.
- **No speculative fixes.** "Try this and see" is not a finding.
- **Stay scoped.** Analyze the reported bug only; note unrelated discoveries in
  one line at the end, don't chase them.
- **Cite evidence.** Every claim references a file, line, migration, or policy.

Red flags — thinking any of these means you're guessing, not analyzing; STOP:

- "it's probably X, let me suggest the fix" (no verified cause → no fix)
- "I'll propose two possible fixes and let them pick" (that's two guesses)
- "one more hypothesis" after three have failed (that's an architecture
  question now — surface it)
- "the error message is misleading, ignore it" (read it again; it usually isn't)

## References (read when the situation matches)

- `references/root-cause-tracing.md` — tracing a bad value backward through the
  call stack to its origin
- `references/defense-in-depth.md` — layering validation after the cause is found
- `references/condition-based-waiting.md` (+ `condition-based-waiting-example.ts`)
  — replacing arbitrary timeouts with condition polling in flaky async tests
- `references/find-polluter.sh` — bisecting which earlier test pollutes a
  failing test
