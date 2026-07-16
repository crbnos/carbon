# Task #1125 — ci: sync self-hosted functions workflow should depend on deploy apps

## Context

Carbon repo: `/home/openclaw/carbon`
GitHub issue: https://github.com/crbnos/carbon/issues/1125

## Problem

`.github/workflows/functions.yml` ("Deploy Self-Hosted Functions") triggers on `push` to `packages/database/supabase/functions/**` independently of the deploy pipeline. It can run before `Deploy Apps` finishes, causing sync issues.

## What to build

Modify `.github/workflows/functions.yml` so that:

1. It uses `workflow_run` triggered by "Deploy Apps" (type: completed) on main — same pattern as `inngest.yml`
2. Only runs if `workflow_run.conclusion == 'success'` (see `inngest.yml` for the guard pattern)
3. Adds a delay step at the start of the job (e.g. `sleep 60`) to let ECS/infra stabilize post-deploy
4. Preserves `workflow_dispatch` for on-demand manual runs — the delay should be skipped or optional for manual runs (check `github.event_name != 'workflow_run'` to skip delay when manually triggered)
5. Preserves the path-filter behavior: only sync when files under `packages/database/supabase/functions/**` actually changed
   - Since `workflow_run` doesn't support path filters natively, use `dorny/paths-filter@v3` action to check whether the triggering commit touched those paths
   - If no relevant paths changed AND it's a `workflow_run` trigger, skip the job (add an `if:` condition or an early-exit step)
   - Skip the path check for `workflow_dispatch` (always run)
6. All other steps (SSH setup, deploy, cleanup) remain unchanged

## Reference: current functions.yml

```yaml
name: Deploy Self-Hosted Functions

on:
  push:
    branches: [main]
    paths: ["packages/database/supabase/functions/**"]
  workflow_dispatch:

jobs:
  functions:
    name: Deploy Self-Hosted Functions
    runs-on: ubuntu-latest
    strategy:
      matrix:
        environment:
          - name: "govcloud"
            instance_host: GOVCLOUD_INSTANCE_HOST
            instance_ssh_key: GOVCLOUD_INSTANCE_SSH_KEY

    env:
      INSTANCE_HOST: ${{ secrets[matrix.environment.instance_host] }}
      INSTANCE_SSH_KEY: ${{ secrets[matrix.environment.instance_ssh_key] }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup SSH key
        run: |
          mkdir -p ~/.ssh
          echo "$INSTANCE_SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $INSTANCE_HOST >> ~/.ssh/known_hosts

      - name: Deploy functions
        run: |
          ssh ubuntu@$INSTANCE_HOST 'sudo bash /home/ubuntu/supabase/sync-carbon-functions.sh'

      - name: Cleanup SSH key
        if: always()
        run: |
          rm -f ~/.ssh/id_rsa
```

## Reference: inngest.yml (pattern to mirror)

```yaml
on:
  workflow_run:
    workflows: ["Deploy Apps"]
    types:
      - completed
    branches:
      - main
  workflow_dispatch:

jobs:
  sync:
    if: ${{ github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success' }}
```

## Verification

- Valid YAML (run `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/functions.yml'))"`)
- `workflow_run` trigger references the exact name "Deploy Apps" (must match `deploy.yml`'s `name:` field)
- No other workflow files changed

## Deliverable

- Modified `.github/workflows/functions.yml`
- PR against main in `crbnos/carbon` with title: "ci: sync self-hosted functions should depend on deploy apps"
- Reference issue #1125 in the PR body ("Closes #1125")
