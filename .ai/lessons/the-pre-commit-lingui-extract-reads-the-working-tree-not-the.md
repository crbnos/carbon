---
paths: []
triggers: []
promoted: null
---
# The pre-commit Lingui extract reads the working tree, not the commit

**Context:** `scripts/git-hooks/pre-commit` runs `pnpm lingui:check` when a staged file is TS, JS or `.po`. That script runs `lingui extract --clean` and then compiles. The hook then stages every `packages/locale/locales/**/*.po` file.

**Problem:** The extract reads the working tree, not the index. On 2026-10-09, commit eac7595333 ran the hook while another session had uncommitted UI edits in the same tree (`PaymentApplyTable.tsx` and others). The extract removed strings that the committed code still uses ("Applied amount for {0}", "Discount for {0}"). It added strings that only the uncommitted code uses ("Apply to {0}", "FX Gain/Loss"). The hook staged all 13 catalogs, with those changes, into that commit. Commit 814631c22f restored catalogs extracted from HEAD in a clean worktree.

**Rule:** Before you commit TS or JS, run `git status`. If it shows uncommitted `.ts` or `.tsx` edits that are not part of your commit, the hook's catalogs are wrong. A catalog-only commit in the same tree does not fix them, because the hook extracts again from the same dirty tree. Make the catalog commit in a clean tree:

1. Run `git worktree add -b i18n-catalogs <path> HEAD`.
2. In that worktree, run `pnpm install`.
3. In that worktree, run `pnpm lingui:check`, then `pnpm lingui:clean`.
4. Stage `packages/locale/locales/*/*.po` there and commit. The hook now extracts from a clean tree.
5. In your own tree, run `git merge --ff-only i18n-catalogs`. A fast-forward creates no commit, so no hook runs.
6. Remove the worktree and the branch.

After any commit, check its `.po` diff. A removed `msgid` that HEAD code still uses means that the extract read a dirty tree.

**Applies to:** `scripts/git-hooks/pre-commit`; `packages/locale/locales/*/*.po`; every workspace that more than one session edits at a time.
