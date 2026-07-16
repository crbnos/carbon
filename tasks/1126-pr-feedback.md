# PR #1126 Feedback Fix: paths-filter needs explicit base for workflow_run

## Context
PR #1126 (`ci/functions-depend-on-deploy-apps` branch) introduced a `dorny/paths-filter@v3` step
to detect function file changes under `workflow_run` events. CodeRabbit flagged a **Major** correctness
issue: without an explicit `base`, the action may compare the head commit against itself (or the wrong
reference), producing an empty diff and silently skipping the deploy.

## File to fix
`.github/workflows/functions.yml` on branch `ci/functions-depend-on-deploy-apps`

## Current code (the problematic step around line 40-50)
```yaml
- name: Check for function changes
  id: filter
  if: ${{ github.event_name == 'workflow_run' }}
  uses: dorny/paths-filter@v3
  with:
    ref: ${{ github.event.workflow_run.head_sha }}
    filters: |
      functions:
        - 'packages/database/supabase/functions/**'
```

## Required fix
Add an explicit `base` to compare against. The correct base for `workflow_run` events
(triggered by a push to main) is `github.event.workflow_run.head_sha`'s parent, but the 
most reliable approach is to compare `head_sha` against the triggering workflow's "before" SHA.

For a `workflow_run` triggered by a push, GitHub exposes:
- `github.event.workflow_run.head_sha` — the commit that triggered the upstream workflow
- There is no `before` SHA directly on `workflow_run`, but the head_branch is available.

The best available base is `github.event.workflow_run.head_branch` (branch name — paths-filter
will compare HEAD of branch against... no, that's circular too).

Actually, the correct fix per dorny/paths-filter docs for `workflow_run` is:
```yaml
with:
  base: ${{ github.event.workflow_run.head_branch }}
  ref: ${{ github.event.workflow_run.head_sha }}
```

But even better — since this only runs on `workflow_run` from "Deploy Apps" which only runs on
pushes to `main`, we're always comparing against main. The simplest fix that works reliably:
```yaml
with:
  base: main
  ref: ${{ github.event.workflow_run.head_sha }}
```

This compares the pushed commit (`head_sha`) against `main` — since we're running after a push
to main, `head_sha` IS main, so `base: main~1` or better:

Wait — `head_sha` is the commit just pushed TO main. So comparing it against `main` = comparing
against itself. The correct comparison is `head_sha` against its parent (the prior commit on main).

Use `fetch-depth: 2` on checkout and compare against `HEAD~1`, or use:
```yaml
base: ${{ github.event.workflow_run.head_sha }}^
```

Or simplest reliable fix: use the `before` SHA. For `workflow_run`, the triggering `push` event's 
`before` SHA isn't directly available on the `workflow_run` payload. However:
```yaml
base: ${{ github.sha }}  # Not available in workflow_run context
```

**The cleanest pragmatic fix** (confirmed by dorny/paths-filter docs + community):
```yaml
- name: Check for function changes
  id: filter
  if: ${{ github.event_name == 'workflow_run' }}
  uses: dorny/paths-filter@v3
  with:
    base: ${{ github.event.workflow_run.head_branch }}
    ref: ${{ github.event.workflow_run.head_sha }}
    filters: |
      functions:
        - 'packages/database/supabase/functions/**'
```

When `base` is the branch name and `ref` is the head SHA, paths-filter fetches the branch and
compares ref against the branch tip. Since head_sha IS the branch tip after the push, this may
still give an empty diff for the same reason.

**Actually correct fix**: Since we have `fetch-depth: 0` already, use `base: ${{ github.event.workflow_run.head_sha }}~1`:
```yaml
with:
  base: ${{ github.event.workflow_run.head_sha }}~1
  ref: ${{ github.event.workflow_run.head_sha }}
```

This compares the pushed commit against its immediate parent — exactly what we want to detect
"did this push touch functions/**".

## Your task

1. `cd /home/openclaw/carbon`
2. `git fetch origin ci/functions-depend-on-deploy-apps`
3. Check out the branch: `git checkout ci/functions-depend-on-deploy-apps`
4. Read the full `.github/workflows/functions.yml` to understand current state
5. Fix the `paths-filter` step to add `base: ${{ github.event.workflow_run.head_sha }}~1` so it
   compares the pushed commit against its parent — detecting whether functions/** was touched
6. The `fetch-depth: 0` on checkout already ensures the git history is available
7. Commit with message: `fix(ci): add explicit base to paths-filter for workflow_run`
8. Push to `ci/functions-depend-on-deploy-apps`

## Proof
The fix is in a YAML file only. Verify the YAML is valid (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/functions.yml'))"`)
and that the `base` field is correctly set in the `paths-filter` step.

## Reply on PR
After pushing, reply to the CodeRabbit comment on PR #1126 thread, confirming the fix with the commit SHA.
Use `gh pr comment 1126 --body "..."` — NOT inline review comment.
