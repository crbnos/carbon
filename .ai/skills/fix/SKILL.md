---
name: fix
description: End-to-end bug-fix pipeline that diagnoses, implements, and proves the fix. It orchestrates /root-cause, /debugging-difficult-bugs, /test, and /check-and-commit, and performs the fix itself — the minimal code change from the proven cause plus a mandatory red→green regression test and scoped validation gates. At start it picks an autonomy mode (approval-before-each-phase vs fully autonomous) and a phase set (root-cause + fix are mandatory; runtime instrumentation is conditional on confidence, test is optional, commit runs only on explicit ask), auto-detected from the request and confirmed with the user when unclear. Keeps a structured run record at .ai/runs/{date}-{slug}.md. Use when fixing a bug, test failure, or unexpected behavior ("fix this bug", "why does X fail"). Do not use for building new features (use /feature). For a single watched item with explicit acceptance criteria, prefer /conductor.
---
<!-- Workflow pattern inspired by Open Mercato (MIT License)
     https://github.com/open-mercato/open-mercato
     Copyright (c) 2025-2026 Open Mercato contributors -->

# fix — end-to-end bug-fix pipeline

Runs the bug-fix lifecycle: diagnose → (instrument) → implement the minimal fix
with a red→green regression test → (verify) → (commit). This skill orchestrates
the surrounding phases **and performs the fix itself**. The diagnosis and
verification phases delegate to their own skills; the fix implementation
(Phase 3) is done inline here — that is the core of this skill.

**Announce at start:** "Using the fix skill — {autonomy mode}, phases:
{selected}."

## The phases

| #   | Phase              | Skill / owner               | Artifact                                 | Mandatory?               | Hard stop                                         |
| --- | ------------------ | --------------------------- | ---------------------------------------- | ------------------------ | ------------------------------------------------- |
| 1   | Root cause         | `/root-cause`               | root-cause brief                         | **always**               | 🛑 three-strikes architectural → surface to human |
| 2   | Runtime instrument | `/debugging-difficult-bugs` | log-backed cause                         | conditional              | none                                              |
| 3   | Fix                | **this skill (inline)**     | ready change + red→green regression test | **always**               | 🛑 BLOCKED (2 failed fix attempts) → surface      |
| 4   | Browser verify     | `/test`                     | pass/fail + playbook                     | optional                 | user-facing flow must pass                        |
| 5   | Commit             | `/check-and-commit`         | conventional commit                      | **only on explicit ask** | gates must be green                               |

Root cause and Fix are non-negotiable — the iron rule is _no fix without a
proven cause_, and the fix is the point. Everything else is opt-in.

## Step 0: Choose autonomy mode + phase set — always first

Write the run record (below) as you make these choices, then announce them.

### 0a. Autonomy mode

Detect from the request; ask only if neither is clear.

| Mode                   | Signals                                                      | Behavior                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approval-per-phase** | "ask me", "step by step", "check with me", "gate each phase" | Pause before each phase, state what it will do in one line, wait for go.                                                                                                                                    |
| **Fully autonomous**   | "autonomously", "just fix it", "don't ask", "end to end"     | Run unattended; auto-decide the conditional branches (instrument? test?) and record each choice. **The two 🛑 hard stops still surface** — architectural three-strikes and BLOCKED are not auto-resolvable. |

Default when ambiguous: **ask** — one question, the two options above.

### 0b. Phase set

Root-cause and fix always run **on a fresh start**; a resumed run may begin past
them when a prior artifact already satisfies the phase (see Entering
mid-pipeline). The rest are decided as follows — note some branches resolve
_after_ root-cause, not upfront:

- **Runtime instrument (`/debugging-difficult-bugs`)** — a **runtime branch, decided
  after phase 1**: run root-cause first, read its Confidence line. Include when
  root-cause returns **MEDIUM/LOW** _and_ the bug involves runtime state,
  ordering, caching, concurrency, streaming, or manual/UI reproduction. Skip when
  root-cause is **HIGH** or a stack trace / deterministic failing test already
  proves the cause.
- **Test (`/test`)** — include when the fix is user-facing or the proof is
  inherently visual (layout, spacing, animation). Skip for a pure-logic fix
  already covered by the Phase 3 red→green regression test — log the skip
  ("browser test skipped — regression test covers it").
- **Commit (`/check-and-commit`)** — runs **only if the user explicitly asked to
  commit** (e.g. "fix and commit"). Otherwise the pipeline ends at fix (+ test)
  with a READY summary and stops; offer to commit, don't do it unprompted.

## Step 0c: Open the run record — the standardization artifact

Create `.ai/runs/{date}-{slug}.md` before the **first selected phase** (phase 1
on a fresh run; Fix or Test on a resumed run — see Entering mid-pipeline). One
canonical log of what was diagnosed, decided, and proven — so the same bug
handled by different engineers produces comparable results.

```markdown
# Bugfix run: {title}

- Date: {date} <!-- ask the user or use the injected currentDate; skills have no clock -->
- Mode: approval-per-phase | fully-autonomous
- Request: {the bug report, verbatim}
- Phase plan: root-cause [run] · instrument [run|skip — resolved after root-cause] · fix [run] · test [run|skip — why] · commit [run|skip — explicit ask?]

## Decisions <!-- autonomous branch choices + any surfaced hard stop -->

- {branch/gate}: {decision} — {rationale} — {timestamp}

## Phase log

- root-cause: {confidence + brief summary}
- {phase}: {outcome + artifact path}

## Outcome

- {READY / committed SHA / PR link / BLOCKED + why}
```

Update it at each phase transition, when the instrument branch resolves, and on
any hard stop. Runtime lives in `.ai/runs/` (gitignored) — never in the product tree.

## Running the phases

Run the **selected** phases in order; skip the deselected ones. Announce each
transition in one line ("Phase 3: fix — cause confirmed HIGH, writing the test").

- **Approval mode:** before each phase, pause for the user's go.
- **Autonomous mode:** proceed between phases and auto-decide the instrument/test
  branches, recording each. But **stop and surface** at the two 🛑 hard stops —
  they need human judgment, not an auto-resolution.

The instrument decision is made live: after `/root-cause` outputs its brief, read
the Confidence line and branch per 0b before continuing.

## Phase 3 in detail — implementing the fix

This is the mandatory core. Input: the proven root-cause brief. Output: the
smallest correct fix plus a regression test, all gates green. Execute the brief,
prove it, and stop.

### 3.1 Prerequisites

1. **Read the brief.** No proven cause → you are not in Phase 3 yet; go back to
   Phase 1 (`/root-cause`). Never fix a guess.
2. Read `.ai/lessons.md` for the affected area.
3. Read the affected module/package `AGENTS.md`.
4. Read `BACKWARD_COMPATIBILITY.md` if the brief lists any BC impact.
5. If working a GitHub issue: `gh issue edit <number> --add-assignee carbon-agent --add-label "agent:working"`.

### 3.2 Plan the change

List before touching code: files to modify (from the brief), files to create
(tests, migrations), callers to update (if a signature changes — grep for every
call site). If the brief says 2 files and your list says 8 → STOP and re-scope
with the human.

### 3.3 Write the failing test FIRST

Mandatory for every fix. Write a regression test that reproduces the bug, then
run it and **watch it fail** before changing any production code:

```bash
pnpm --filter <pkg> exec vitest run <path/to/test>
# Expected: FAIL, for the reason the brief describes (not a typo/import error)
```

A test that passes immediately proves nothing — it isn't testing the bug. Test
locations: `apps/erp/app/modules/{module}/__tests__/` or
`packages/{pkg}/src/__tests__/` (or next to the source, matching siblings). Copy
setup patterns from a sibling test file.

If the bug is only provable in the browser (layout, visual state), the failing
proof is a `/test` run + BEFORE screenshot instead — say so explicitly, and make
sure Phase 4 (Browser verify) is in the phase set.

### 3.4 Implement

- **One concern.** Fix the bug. No refactoring, no cleanup, no "while I'm here".
- **Match surrounding patterns** — grep for similar code and copy its idiom.
- **companyId scoping** on every new or modified tenant-data query. Never skip.
- **Module discipline**: one `{module}.service.ts`, one `{module}.models.ts`.
- **Imports**: `~/*` app code, `@carbon/*` workspace packages.
- **Schema changes**: follow `.ai/rules/workflow-database-migration.md`; then
  `pnpm run generate:types` BEFORE typechecking.
- **Minimal blast radius**: fewest files, fewest lines, still complete.

### 3.5 Validate (scoped gates, in order)

```bash
# 1. Types (only if schema changed)
pnpm run generate:types

# 2. Format + lint the files you touched
pnpm exec biome check --write <changed paths>

# 3. Typecheck each touched package — NEVER whole-repo (it OOMs)
pnpm exec turbo run typecheck --filter=<pkg>

# 4. Tests for each touched package — your new test must now PASS
pnpm --filter <pkg> test
```

Gate failed? Read the error. Caused by your change → fix and re-run. Clearly
pre-existing and unrelated → note it in the output, don't chase it. **Two failed
fix attempts on the same gate → STOP, report BLOCKED** (🛑 hard stop — surfaces
to the human even in autonomous mode).

### 3.6 Self-review

| Check | Question |
|-------|----------|
| Scope | Did I change only what the brief called for? |
| Red→green | Did I watch the test fail before the fix and pass after? |
| companyId | Every new/modified query scoped? |
| Callers | Every caller of a changed signature updated? |
| BC | Any FROZEN surface touched? STABLE without deprecation? |
| Patterns | Does the code read like its neighbors? |
| Leftovers | No debug logging, commented-out code, or stray files in the diff? |

### 3.7 Fix output

```markdown
## Fix Summary
**Status:** READY | BLOCKED <if BLOCKED: what and why>
**Root-cause brief:** <path/link>
**Files changed:** <path — what>
**Regression test:** <path — failed before fix (output), passes after (output)>
**Gates:** generate:types PASS|SKIP · biome PASS · typecheck(<pkgs>) PASS · test(<pkgs>) PASS
**BC assessment:** NONE | <surfaces and how they comply>
**Summary:** <2–3 sentences>
```

Then continue to Phase 4/5 per the phase set, or stop at READY and offer to
commit.

## Entering mid-pipeline

Start at the first selected phase whose input is missing:

| You already have               | Start at                                             |
| ------------------------------ | ---------------------------------------------------- |
| Nothing                        | Root cause                                           |
| A proven root-cause brief      | Fix (or Instrument if cause is MEDIUM/LOW + runtime) |
| An implemented fix, unverified | Test (or Commit if user asked)                       |

## Hard rules

- On a fresh run, root-cause and the fix both run — never skip diagnosis, never
  fix a guess. A resumed run may start past them only when a prior artifact (a
  proven brief, an implemented fix) already satisfies that phase (see Entering
  mid-pipeline).
- **No commit, no push, no PR from Phase 3 itself.** Committing happens only in
  Phase 5 via `/check-and-commit`, and only on an explicit commit request;
  otherwise stop at READY and offer.
- The two 🛑 hard stops surface to the human **even in autonomous mode** —
  three-strikes-architectural (root-cause) and BLOCKED (fix). Record them; don't
  paper over them.
- Never present a guess as a finding — if root-cause can't reach a confident
  cause and no runtime path helps, stop and say so.
- **No scope creep** — related bugs get one line in the output, not a fix.
- Skipping a phase is a logged decision with a reason, not a silent omission.

Red flags — thinking any of these means the process is off the rails; STOP:

- "the fix is obvious, I'll write the test after" (a test written after passes
  immediately and proves nothing — 3.3 comes first)
- "while I'm here, I'll clean this up too"
- "the test is hard to write, I'll just verify manually" (report BLOCKED instead)
- "the brief is probably right" (if the code you read doesn't confirm the cause,
  go back to `/root-cause`)

## Alternative: the conductor

For a single tightly-scoped bug with explicit acceptance criteria that you want
to watch iterate to a gated PR, prefer `/conductor` — a supervised
doer→gate→judge loop instead of this pipeline.
