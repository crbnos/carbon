---
paths: []
triggers: ["user.email", "git rebase", "force-with-lease"]
promoted: null
---
# A PR's CLA check counts every commit author on the branch, including copies of main's commits

**Context:** PR #1697's `license/cla` stayed pending after the author had signed many
times. The bot listed "Brad Barbin" (not a GitHub user) and `chasefostermfg` as unsigned.

**Problem:** Two independent causes, neither fixable by signing again. (1) Commits made
before `user.email` was configured were authored as `<user>@<hostname>.local` — git's
fallback — which no GitHub account can own, so cla-assistant can never match them.
(2) Rebasing the branch onto main by replaying commits copied other contributors'
already-merged commits onto the branch with new SHAs, so they became PR commits and
their authors became CLA "committers".

**Rule:** Set `user.name` / `user.email` before the first commit
(`git log origin/main..HEAD --format='%ae' | sort -u` must show only GitHub-linked
emails). Bring main in with a MERGE, never by replaying main's commits onto the branch.
To repair an affected PR, squash onto `origin/main` (merge main first so the tree is
current, `git reset --soft origin/main`, commit once, confirm `HEAD^{tree}` is
unchanged) and `git push --force-with-lease=<branch>:<known sha>`.

**Applies to:** any PR on crbnos/carbon (cla-assistant.io).
