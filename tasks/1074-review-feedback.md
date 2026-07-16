# Task: Address PR #1074 Review Feedback

## Objective
One-line wording fix in `.ai/skills/conductor/SKILL.md` on branch `docs/conductor-shipped-pr-review`. The repo main dir IS this branch — work directly there at `/home/openclaw/carbon`.

## Merge origin/main first
```bash
cd /home/openclaw/carbon
git fetch origin main && git merge origin/main
```

## Fix (single item)

CodeRabbit Major (line 208, Brad confirmed "good call"):

The current wording around line 199-208 says "open every PR as a draft first, then promote based on outcome" — but this is backwards. Shipped PRs should be created directly as ready-for-review; drafts are only for unverified/partial runs.

CodeRabbit's suggested wording (accepted):
```
3. **Ready-vs-draft is decided by the exit state** — create the PR as a draft only for unverified or partial runs, then promote shipped PRs to ready for review:
```

Find the exact current line in `.ai/skills/conductor/SKILL.md` and apply this fix. Keep the rest of the section (the two bullet points below it) unchanged.

## After
- Commit: `docs(conductor): fix ready-vs-draft wording (draft only for partial/unverified runs)`
- Push to `docs/conductor-shipped-pr-review`
- Resolve the CodeRabbit review thread
