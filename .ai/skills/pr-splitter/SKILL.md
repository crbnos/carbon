---
name: pr-splitter
description: Split a large, messy, or hard-to-review pull request into smaller reviewable PRs (stacked or parallel) without losing any of the original work — snapshot the branch, extract changes non-interactively, verify each PR independently, and track drift as review feedback lands. Use when a PR is too big to review, mixes refactors with behavior changes, or needs incremental delivery. Requires committed work on a branch — commit or stash first.
---

# pr-splitter — break a big PR into reviewable pieces

The original branch is source material, never a casualty: snapshot it, build
smaller PRs from it deliberately, and keep a local ledger of what went where.

**Announce at start:** "Using the pr-splitter skill — splitting {branch} into
smaller PRs."

Never use interactive git commands (`git restore -p`, `git add -i`,
`git rebase -i`) — they hang in this environment. Every extraction below is
non-interactive.

## Step 1: Snapshot before touching anything

```bash
git status --porcelain        # must be empty; if not, STOP — commit or stash first
BASE=$(git merge-base origin/main HEAD)
git branch backup/original-$(git branch --show-current)
```

Do not delete or rewrite the original branch until the split has fully shipped.

## Step 2: Inventory the original PR

```bash
git diff --stat $BASE...HEAD
git diff --name-only $BASE...HEAD
git log --oneline $BASE..HEAD
```

Classify every changed file into exactly one review unit:

| Unit | Examples |
|------|----------|
| prep / refactor | renames, extractions, no behavior change |
| API / type changes | signatures, models, generated types |
| behavior | the actual feature/fix logic |
| tests | new or changed tests |
| docs / metadata | AGENTS.md, docs, changelogs |
| generated / lockfiles | `pnpm-lock.yaml`, generated types |

## Step 3: Create the scratchpad

Write `.ai/scratch/pr-split.md` (gitignored — never commit it):

```markdown
# PR split — {original branch}
Backup: backup/original-{branch} · Base: {BASE sha}

## Planned PRs
1. {branch-name} — scope: … — files/hunks: … — verify: … — status: …

## Remaining original intent
- …

## Drift notes (date / branch / what changed and why)
- …
```

## Step 4: Choose the split shape

| Situation | Shape |
|-----------|-------|
| Later work depends on earlier work | **Stacked** PRs (each branched off the previous) |
| Changes are truly independent | Parallel PRs off main |
| One shared prep change unlocks independent work | Foundation PR + parallel follow-ups |
| Unsure | Stacked — dependency mistakes surface as conflicts, not broken builds |

Rules: never separate tests from the code they verify; never split one behavior
across two PRs by file boundary; each PR must build and pass its tests alone.

## Step 5: Extract non-interactively

Start each PR from the correct base (`main`, or the previous PR in the stack):

```bash
git checkout -b {pr-branch} {base}
```

**Whole files** (the file belongs entirely to this PR):

```bash
git checkout backup/original-{branch} -- path/to/file.ts
```

**Part of a file** (the file mixes changes for different PRs):

```bash
git diff {base} backup/original-{branch} -- path/to/file.ts > .ai/scratch/extract.patch
# Edit .ai/scratch/extract.patch: keep the file header lines (---/+++),
# DELETE every @@-hunk that belongs to a different PR, keep the hunks you want.
git apply .ai/scratch/extract.patch
```

If `git apply` fails (context mismatch), do not fight it: open the file and
make the wanted changes by hand, using the patch as the reference. Then delete
the patch file.

Commit each extraction with a conventional message and check it off in the
scratchpad, noting exactly which files/hunks moved.

## Step 6: Verify each PR independently

For every PR branch, before opening it:

```bash
pnpm exec biome check --write --no-errors-on-unmatched <changed paths>
pnpm exec turbo run typecheck --filter=<pkg>    # per touched package, never whole-repo
pnpm --filter <pkg> test
```

A PR that only compiles on top of an unmerged sibling is stacked — say so in
its description and set its GitHub base branch accordingly.

## Step 7: PR descriptions

```markdown
## Summary
PR {N} of {M} split from {original branch}.

## Scope
- …

## Intentionally excluded (follow-up PRs)
- …

## Verification
- {commands run + results}
```

Keep the detailed extraction ledger in `.ai/scratch/pr-split.md`, not in PR
bodies.

## Step 8: Manage drift as reviews land

- Reviewer-approved changes are the **new source of truth** — when an earlier
  PR changes, rebase its dependents onto it and resolve conflicts in favor of
  the reviewed direction, never blindly back toward the original branch.
- After any rebase/force-push: `git range-diff {old-tip}...{new-tip}` and
  summarize meaningful differences for reviewers.
- Periodically diff the stack against the backup to find **remaining intent**
  (work not yet shipped in any PR) — not to force byte-for-byte equality.
- Record every intentional divergence in the scratchpad's drift notes.

## Done when

- [ ] Every hunk of `git diff $BASE...backup/original-{branch}` is either shipped
      in a PR or explicitly listed in the scratchpad as dropped (with a reason)
- [ ] Each PR builds and passes its scoped gates independently
- [ ] Tests shipped in the same PR as the code they verify
- [ ] Backup branch still intact

## Failure modes to avoid

Splitting by file when behavior spans files · extracting tests without their
code · a follow-up PR that doesn't compile · force-pushing without a range-diff
summary · deleting the backup early · resolving stack conflicts by reverting
reviewer feedback.
