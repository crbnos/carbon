---
name: self-review
description: Critically review your own branch work before or just after opening the PR, producing Must fix / Risks / Suggested improvements plus a docs-freshness check. Use when finishing a branch, before opening or merging a PR, or to sanity-check a diff against main. Supports an opt-in strict "thermo-nuclear" mode for a deep maintainability and abstraction audit when explicitly requested.
---

# self-review — review your own work before the PR

Review the **full branch diff**, not just the last commit. Do not rubber-stamp
your own work because you wrote it.

**Announce at start:** "Using the self-review skill — reviewing the branch diff
against main."

## Step 1: Get the diff

- Open PR exists → `gh pr view` + `gh pr diff`.
- No PR → `git diff $(git merge-base origin/main HEAD)...HEAD` (plus
  `--name-only` for the file list).
- Already know the PR from this session → don't re-prove it; just get the diff.

## Step 2: Read all of it

Read the entire diff carefully. Do not skim. Re-read tricky hunks until you
understand why they changed. When a change looks subtle, risky, or surprising,
open the surrounding file and confirm the change makes sense in context.

Actively hunt for:

- bugs or logic mistakes; missing edge cases
- missing `companyId` scoping on new/modified queries
- unnecessary complexity; dead code; accidental churn
- leftover debug code, logging, TODOs, commented-out code, stray files
- naming that could be clearer; patterns inconsistent with neighbors
- missing or weak tests (would this test catch a revert of the fix?)
- risky changes not obvious from the diff (signature changes, shared helpers)
- PR title/body/scope not matching the actual change
- things that work but feel brittle or hard to maintain

Call out **missing** work, not just flaws in what's present.

## Step 3: Docs freshness

For every package or module directory the diff touches:

1. Sibling `AGENTS.md` exists? Does the diff change anything it references
   (function, table, export, import path)? → flag the exact stale line.
2. New package/module without an `AGENTS.md`? → flag it (create via
   `/create-agents-md`).
3. New pattern, convention, or pitfall worth keeping? → flag it for
   `.ai/lessons.md`. Spec implemented? → flag the spec for `implemented/` per
   `.ai/specs/AGENTS.md`.

## Step 4: Output

Four sections, specific, with `file:line` references — a finding you cannot tie
to a file and line gets cut, not padded. If unsure whether something is a real
bug, include it as a risk/question rather than dropping it.

- **Must fix**
- **Risks / questions**
- **Suggested improvements**
- **Docs freshness**

End with a compact TLDR listing every item again, grouped by section. Present
findings to the user — they decide what to act on; do not auto-fix.

## Strict mode (thermo-nuclear)

Run **only when explicitly requested** ("thermo-nuclear", "harsh", "deep code
quality", "extremely strict"). Raises the bar from "correct and shippable" to
"simplest, most maintainable structure possible".

Hunt for behavior-preserving restructurings that make whole branches, helpers,
modes, or layers disappear. Prefer deleting complexity over rearranging it.
Non-negotiable standards on top of the base review:

1. **File growth** — a PR pushing a file past ~1k lines without strong reason is
   a smell; prefer extracting modules first.
2. **No spaghetti growth** — new ad-hoc conditionals and one-off special cases
   bolted onto unrelated flows belong in a dedicated abstraction.
3. **Clean the design, don't just accept working code** — same behavior with
   meaningfully cleaner structure is worth pushing for.
4. **Direct over magical** — flag thin wrappers, identity abstractions, and
   pass-through helpers that add indirection without clarity.
5. **Type/boundary cleanliness** — question needless optionality, `any`,
   `unknown`, cast-heavy code, and silent fallbacks papering over invariants.
6. **Canonical layer + reuse** — feature logic leaking into shared paths, or a
   bespoke helper duplicating an existing canonical one, is a blocker.
7. **Atomicity + orchestration** — flag needlessly sequential flows and related
   updates that can leave state half-applied.

Treat each violation as a presumptive blocker unless clearly justified. Be
direct and demanding without being rude.
