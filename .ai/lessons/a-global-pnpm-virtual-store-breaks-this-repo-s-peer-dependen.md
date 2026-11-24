---
paths: [".npmrc", "pnpm-workspace.yaml"]
triggers: ["virtual-store", "--frozen-lockfile"]
promoted: null
---
# A global pnpm virtual store breaks this repo's peer dependencies

**Context:** A worktree installed while `enable-global-virtual-store=true` was set in the
user's global pnpm config (`~/Library/Preferences/pnpm/rc`).

**Problem:** Packages are linked from `~/Library/pnpm/store/v10/links/…`, where a package
cannot resolve its peers. The ERP dev server failed every page with `Cannot find package
'@tiptap/core'`, the database tests could not load, and the scoped typechecks reported about
7,000 React type errors in files nobody had changed, identical on `main`. It reads as a
broken branch, not a broken install.

**Rule:** When `readlink apps/erp/node_modules/react-icons` points into
`Library/pnpm/store/…/links`, reinstall the worktree with the global store off:
`pnpm install --frozen-lockfile --config.enable-global-virtual-store=false
--config.confirmModulesPurge=false`. Before blaming a change for mass type errors, compare
the error set against an untouched checkout of `main`.

**Applies to:** Any worktree; typecheck, vitest and `crbn up` runs.
