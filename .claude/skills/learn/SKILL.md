---
name: learn
description: Record one mistake so no agent makes it again — store it as a conformance check if the code text shows it, else a line in the topic's rule, else a scoped lesson section in its .ai/lessons/<topic>.md file — then mark the worktree's logged failures as handled. Use when the user corrects you, when /fix finds an earlier agent's mistake, for each /self-review Must fix, when the same check fails twice, or when the Stop hook asks. Sweep mode turns the weekly signal report into store changes. Do not use to fix the mistake itself — use /fix.
---

# learn — store a mistake where the next agent meets it

Input: one mistake (what went wrong, the files, why no gate caught it).
Output: one committed change to the strongest store that fits, and a
`learned` mark in the signal inbox. `pnpm brief` then shows the entry to the
next agent before it edits those files.

**Announce at start:** "Using the learn skill — recording {the mistake}."

## Step 1: Name the mistake

Write three lines before you change anything:

1. What went wrong, as a "Do X, not Y" sentence.
2. The files it happened in (repo-relative paths).
3. Why no gate caught it: no check, a check with a gap, or the rule was not shown.

## Step 2: Search for an existing entry

```bash
pnpm brief <each file from Step 1>
rg -n "<key code token>" .claude/rules .ai/lessons packages/checks/src/conformance
```

| Found | Action |
|---|---|
| A check that should have fired | Fix the check's gap (Step 3a). |
| A rule or lesson that says it, but `pnpm brief` did not list it for the files | Widen its `paths:` or add a `triggers:` entry. Go to Step 4. |
| A rule or lesson that says it and was listed | Add the missing case to its `summary:` or its Rule line. Go to Step 4. |
| Nothing | Go to Step 3. |

## Step 3: Choose the store

| The mistake… | Store |
|---|---|
| shows in one file's code text (a call, an import, a pattern) | **a) Check** in `packages/checks/src/conformance/` |
| needs judgment, but belongs to one topic that has a rule | **b) Rule line** in that `.claude/rules/*.md` summary or body |
| fits neither | **c) Lesson** section in `.ai/lessons/<topic>.md` |

**a) Check.** Follow `packages/checks/AGENTS.md`. Give the check `triggers`
that every violation's file contains. Write a test that feeds it the exact
code with the mistake. Run it and watch it fail before the check exists.
Existing hits go in the baseline only with a human yes.

**b) Rule line.** Keep `paths:` unchanged. A `summary:` has at most 5 lines of
at most 160 characters each, so replace the weakest line if it is full.

**c) Lesson.** Pick the topic file from the table in `.ai/lessons/README.md`.
🛑 Never create a new topic file. If no topic fits, ask the human.
Add a `## ` section in the format shown there: a `scope` block with a unique
`id`, then Context, Problem, Rule and Applies to. Give it at least one path or
one trigger. Each trigger has at least 4 characters.

When a check or a rule line now states a whole lesson, delete that lesson's
section in the same commit. 🛑 Never delete a lesson that no stronger store
took over. That needs a human yes.

## Step 4: Prove it

```bash
pnpm brief <each file from Step 1>
# Expected: the new or changed entry is listed
pnpm --filter @carbon/checks exec vitest run src/brief/scopes.test.ts
# Expected: all tests pass
```

For a check, also run its test and the gate:

```bash
pnpm --filter @carbon/checks exec vitest run src/conformance/<check>.test.ts src/run.test.ts
# Expected: all tests pass
```

## Step 5: Mark and commit

```bash
pnpm --filter @carbon/checks learn:mark
```

Commit through `/check-and-commit`. The message says what the store now
catches, not "lesson learned".

## Sweep mode

Run it when the human asks, or on the weekly schedule.

1. Run `pnpm --filter @carbon/checks learn:sweep`. It writes `.ai/runs/<date>-learn-sweep.md`.
2. For each repeated check failure, ask why the briefing did not prevent it. Fix the trigger, the summary or the check through Steps 2–4.
3. For each unrecorded fix, run Steps 1–4 on that fix.
4. 🛑 Ask the human before you open a pull request with the result.

## Done when

- [ ] One store changed, and `pnpm brief` lists it for the files from Step 1
- [ ] `scopes.test.ts` passes, and the check's own test passes for a check
- [ ] `learn:mark` ran, and the change is committed

## Failure → action

| Symptom | Action |
|---|---|
| The mistake spans many topics | Record the most specific topic only. Report the rest to the human. |
| A new trigger fails the 25% reach test | Pick a rarer token, or use `{ text, minCount }`. |
| A new check flags existing code | STOP. Report the hits. The human decides on a fix or a baseline entry. |
