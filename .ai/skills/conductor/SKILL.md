---
name: conductor
description: Supervised loop conductor — drive a single work item (a bug, a usability tweak, a small feature) through a doer→gate→judge→keep-or-revert→ledger cycle to a gated PR, while the human watches. Use when asked to "conduct", "loop on", or build/fix one tightly-scoped item with explicit acceptance criteria. Backed by @carbon/harness and the @carbon/checks gates. Supervised only — never autonomous/overnight, never auto-merged. For multi-phase features prefer /feature.
---

# conductor — supervised doer→gate→judge loop

Iterate on one work item until its acceptance criteria are met and provable,
with the human watching and giving final approval. Ship a **gated PR** — never
merge. Architecture context: `.ai/docs/loop-system.md`; the deterministic
helpers live in `packages/harness` (see its `AGENTS.md`).

**Announce at start:** "Using the conductor skill — supervised loop on
{work item}."

## Step 0: Isolated worktree off origin/main — always first

```bash
git fetch origin main
crbn new loop/<id> --base origin/main --yes   # prints the worktree path
```

Do all loop work in that worktree, on branch `loop/<id>`. **Never run on
`main`, and never stack on another feature branch.**

## Step 1: Bind the work item

The binding is a `.loop.md` file with frontmatter `id`, `kind`
(`bug|feature|usability|copy`), `title`, `risk`, optional `issue`, and an
`acceptance` list (field reference: `packages/harness/AGENTS.md`). If given a
binding path, read it; otherwise write one from the request to
`.ai/runs/<id>/binding.loop.md` (gitignored runtime). Validate the shape:

```bash
pnpm --filter @carbon/harness exec tsx -e "import {parseBinding} from '@carbon/harness'; import {readFileSync} from 'node:fs'; console.log(JSON.stringify(parseBinding(readFileSync('<path>','utf8'))))"
```

**Each acceptance criterion is the definition of done** — you are not finished
until every one is satisfied and provable.

## Step 2: The cycle (repeat until acceptance met or the human stops)

### 2.1 Doer

Make the **smallest change toward the weakest-covered acceptance criterion**.
Never batch unrelated changes. Domain rules:

- **UI work**: FIRST find the nearest existing screen/component and copy its
  layout/components/approach — cite the precedent path. Never design from concepts.
- **ERP-domain logic** (accounting, RMA, costing, valuation, tax…): FIRST run
  `/research` — never invent domain logic.
- **Schema changes**: `pnpm run generate:types` after the migration, BEFORE
  typechecking (stale types make typecheck a false green).
- **Module code**: one `{module}.service.ts` + one `{module}.models.ts`.

### 2.2 Gate

Run in order; every applicable gate must be green:

a. **Floor gates** — format first, then the harness gate suite (lint +
   `@carbon/checks` conformance + clobber detection), then scoped typechecks:

   ```bash
   pnpm exec biome check --write --no-errors-on-unmatched <changed paths>
   pnpm --filter @carbon/harness gates
   pnpm exec turbo run typecheck --filter=<pkg>   # per touched package, never whole-repo
   ```

b. **Behavior gate — mandatory for ANY user-facing change.** Choose the
   **simplest sufficient proof**:

   1. **Unit/integration test (red→green)** — preferred whenever the behavior is
      testable without a running stack: logic, transformations, rendering,
      conditional visibility, service behavior. Fast, CI-portable, lives on as a
      regression guard.
   2. **Agent-browser visual verification** — required when the proof is
      inherently visual (layout, spacing, overflow, animation): boot with
      `crbn up`, `/auth`, drive the screen per `/test`, capture BEFORE and
      AFTER screenshots.
   3. **CLI/script proof** — for non-UI changes (migrations, endpoints): a
      command demonstrating correct output.

   Never pick a heavier method when a lighter one gives the same confidence —
   but at least one proof must pass. **If visual proof is needed and the stack
   cannot boot, the loop is BLOCKED** — surface to the human; do not open a
   "done" PR with verification pending.

c. **Correctness (bug fixes)** — reproduce→fix→same-path: the test (or recorded
   browser playbook) that failed on the bug must pass after the fix.

Any gate fails → fix it or revert this iteration's change.

### 2.3 Judge — a separate subagent, never yourself

Dispatch a review subagent to check the diff against the acceptance criteria
and design rules. Do not grade your own homework, and do not accept a holistic
"looks good":

- **Decompose** each acceptance criterion + applicable design rule into atomic
  yes/no questions (one verifiable property each: "Is the precedent component
  actually reused, not re-implemented?", "Are audit fields + `companyId` set on
  every new write?").
- Each answer needs a **one-line justification citing a specific diff hunk or
  artifact** (file:line, test name, screenshot). A "yes" without a citation is a fail.
- **Enumerate failure modes explicitly** — regressions, missed edge cases,
  placeholder values, broken multi-tenancy.
- Approve only if every question passes. Any "no" → that question becomes the
  next iteration's weakest-covered target.
- Keep genuinely subjective criteria (copy clarity, polish) holistic — don't
  force atomic checks onto matters of taste.

### 2.4 Decide + ledger

Keep the change iff **every gate is green (including the behavior proof) AND
the judge approves**; otherwise revert it. Append one entry per iteration:

```bash
pnpm --filter @carbon/harness exec tsx -e "import {appendLedger} from '@carbon/harness'; appendLedger('.ai/runs/<id>/ledger.jsonl', {iteration: <n>, change: '<summary>', gates: {<gate>: <bool>}, decision: '<keep|revert>', reason: '<why>', at: new Date().toISOString()})"
```

(The harness has no clock — you supply `at`.)

### 2.5 Terminate?

All criteria met and provable → Step 3. No progress across iterations
(plateau) or the human stops → stop and report honestly.

## Step 3: Post-build freshness audit

Before opening the PR:

1. List touched package/module dirs:
   `git diff --name-only origin/main...HEAD | grep -E '^(packages|apps/erp/app/modules)/' | cut -d/ -f1-2 | sort -u`
   (modules: cut to depth 5 for `apps/erp/app/modules/{name}`).
2. For each with an `AGENTS.md`, fix any reference your changes made stale —
   small scoped edits in the same branch.
3. New pitfall discovered? Append it to `.ai/lessons.md`
   (`Context → Problem → Rule → Applies to`).

## Step 4: Finish — land a gated PR

1. Final pass: run `/check-and-commit` on the branch state (biome + gates), so
   the PR goes up clean.
2. Open the PR with `gh pr create` — **never merge**. The body must include:
   - the design rationale (precedent copied; research cited),
   - per acceptance criterion: **which gate proves it and how** (test name,
     before/after screenshots, or CLI output),
   - a ledger summary (iterations, kept/reverted and why).
3. Loop artifacts (`.ai/runs/<id>/` — binding, ledger, screenshots) are
   gitignored runtime and never committed to the product tree; the harness's
   `openPr` hosts screenshots for embedding.
4. Surface every design decision for the human to approve or improve — design
   is never shipped silently.

## Guardrails — non-negotiable

- A user-facing change without sufficient proof is never done.
- Never auto-merge; never run on `main`; never background or fan out — this is
  the supervised loop.
- If blocked, say BLOCKED and why. Never report "done, verification pending".

## Growing this

- New floor gate: append `{ id, cmd }` to `FLOOR_GATES` in
  `packages/harness/src/gates.ts` (ask first — it raises the bar for all builds).
- New binding field: extend the frontmatter + `parseBinding` in
  `packages/harness/src/binding.ts`.
