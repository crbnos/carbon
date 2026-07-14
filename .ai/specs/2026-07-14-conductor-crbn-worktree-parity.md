# Spec: Conductor ⇄ crbn worktree parity

**Status:** Draft (design) — decisions flagged for veto in §9
**Date:** 2026-07-14
**Author:** research + draft (agent)
**Area:** `packages/dev` (crbn CLI) + Conductor repo config
**Related rules:** `.ai/rules/environment-configuration.md`, `.ai/rules/dev-shared-redis.md`, `packages/dev/AGENTS.md`

---

## 1. Problem

`crbn new` / `crbn checkout` create a Carbon worktree whose dev environment is
fully isolated per-worktree: its own Docker Compose stack, ports, Supabase
JWT/anon/service keys, Redis logical DB, and portless `*.dev` domain. When we
instead create a workspace **inside Conductor**, Conductor does its own
`git worktree add` at `~/conductor/workspaces/<project>/<codename>` and then runs
a repo-level setup script. That script tries to bolt crbn's provisioning on top,
but it does so unreliably — the result is **not** equivalent to a `crbn checkout`
worktree, and in at least one real case it **collides with the main checkout**.

We want: **creating a workspace in Conductor produces the same fully-provisioned,
collision-free, branch-aligned worktree that `crbn new` / `crbn checkout` would —
even though the physical path differs.**

### 1.1 Evidence (current state on this machine)

`git worktree list` (abridged):

```
/Users/barbinbrad/Code/carbon                            [main]        slug: carbon
/Users/barbinbrad/conductor/workspaces/carbon/moscow     [featuser-select]
/Users/barbinbrad/conductor/workspaces/carbon/macau      [fixquote-markup-aggressiveness]
```

`~/.carbon/dev-ports.json` (the slot registry, keyed by slug):

```
slug=carbon  -> /Users/barbinbrad/conductor/workspaces/carbon/moscow   PORT_ERP=54943
slug=macau   -> /Users/barbinbrad/conductor/workspaces/carbon/macau    PORT_ERP=57199
slug=carbon-feat-service -> /Users/barbinbrad/Code/carbon-feat-service  (native crbn worktree)
```

- `~/Code/carbon/.carbon-worktree` = `carbon` (main checkout's slug).
- `moscow/.carbon-worktree` = **`carbon`** → **same slug as the main checkout.**
  Docker project `carbon-carbon` and the `carbon` registry key are shared between
  main and this Conductor workspace. Whichever boots second either hits
  `ensureSlugAvailable`'s "Slug already in use" error
  (`packages/dev/src/worktree.ts:95-120`) or steals the registry entry and
  re-allocates ports.
- `macau/.carbon-worktree` = `macau` → happens to be unique, so macau works.

The mechanism that produced both values is the same line in `conductor.json`
(`echo "$CONDUCTOR_WORKSPACE_NAME" > .carbon-worktree`), yet it yielded `carbon`
for one workspace and `macau` for another. **`$CONDUCTOR_WORKSPACE_NAME` is not a
reliable, unique, branch-aligned slug** (the first workspace of a project appears
to inherit the project name `carbon`). That is the root cause.

---

## 2. How it works today (grounded)

### 2.1 crbn: directory creation vs. environment provisioning are separate

- **`crbn new`** (`packages/dev/src/commands/new.ts`): `git worktree add -b <branch>`
  at a **sibling** of the main checkout, `"<repoBase>-<slugify(branch)>"`
  (`new.ts:38`), then copies `.env`. It does **not** allocate ports, mint JWTs,
  or write `.env.local`.
- **`crbn checkout`** (bash, `packages/dev/bin/crbn:173-296`): resolves/creates the
  worktree at the same `"<repoBase>-<slug>"` path, then runs `do_post_create`
  (`bin/crbn:404-417`) = `crbn env sync` + `.ai/scripts/install-skills.sh`. Also
  does **not** allocate ports or write `.env.local`.
- **`crbn up`** (`packages/dev/src/commands/up.ts`) is where the per-worktree
  environment is actually minted: `provisionSlot` → `resolveSlug` →
  `resolveSlot` (ports/redisDb/jwt, persisted to `~/.carbon/dev-ports.json`) →
  `branchToPrefix` → `renderEnv` → `writeEnv(.env.local)` (`up.ts:168-360`,
  `env.ts:6-113`).

So "do what `crbn checkout` does" = **(a)** the worktree exists (Conductor already
does this), **(b)** files synced + skills installed, **(c)** a correct, unique
slug so **(d)** `crbn up` mints an isolated stack.

### 2.2 Two identity sources (must both be right)

| Identity | Source | Drives | Code |
|---|---|---|---|
| **slug** | `$CARBON_WORKTREE` → `.carbon-worktree` file → `basename(worktreeRoot)` | Docker project `carbon-<slug>`, `~/.carbon/dev-ports.json` key, `CARBON_WORKTREE` | `worktree.ts:49-60`, `75-77` |
| **branchPrefix** | last `/`-segment of the git branch (sanitized), else slug | `DOMAIN`, `ERP_URL`/`MES_URL`/`SUPABASE_URL`, portless `*.dev` aliases | `portless.ts:390-402`, `env.ts:18-97` |

In a **native** worktree both are unique per worktree (slug = full dir basename
`carbon-feat-service`; prefix = `service`). Under **Conductor** the slug is forced
to `$CONDUCTOR_WORKSPACE_NAME`, which is neither guaranteed unique nor
branch-aligned, while the prefix is still branch-derived — hence
`CARBON_WORKTREE=carbon` but `DOMAIN=featuser-select.dev` in this workspace.

### 2.3 Conductor config today (legacy `conductor.json`, committed)

`conductor.json` (repo root, identical in main/moscow/macau):

```json
{
  "scripts": {
    "setup":   "echo \"$CONDUCTOR_WORKSPACE_NAME\" > .carbon-worktree && pnpm install && ./packages/dev/bin/crbn env sync && bash .ai/scripts/install-skills.sh",
    "run":     "./packages/dev/bin/crbn up --all",
    "archive": "./packages/dev/bin/crbn down --volumes"
  }
}
```

Facts that matter for the redesign:
- Conductor treats `conductor.json` as **legacy**; the modern form is
  `.conductor/settings.toml`. There is currently **no `.conductor/` dir**.
- Conductor reuses a physical codename dir across successive workspaces (symlinks
  accumulate; `git worktree list` shows a `prunable` reused dir). A reused dir can
  carry a **stale `.carbon-worktree`** from a prior occupant.
- Conductor **strips slashes** from branch names (`feat/user-select` →
  `featuser-select`), so its `branchPrefix` differs from native crbn's.
- Conductor's `archive` runs `crbn down --volumes`, which tears down containers +
  volumes but **does not free the registry slot** (only `crbn remove` calls
  `removeSlot`, `remove.ts:159`). Orphan slots accumulate.

---

## 3. Goals / Non-goals

**Goals**
1. A Conductor-created workspace boots via `crbn up` into a fully isolated stack,
   identical in shape to a `crbn checkout` worktree.
2. The slug is **deterministic, unique, and never collides** with the main
   checkout or sibling workspaces — regardless of physical path or codename reuse.
3. slug and domain are derived from a single, predictable rule (no more
   `carbon` vs `featuser-select.dev` split-brain).
4. The provisioning logic is a **first-class, idempotent crbn command** (usable by
   Conductor, by native users adopting a hand-made `git worktree add`, and by CI),
   not a one-off shell incantation embedded in `conductor.json`.
5. Migrate repo config to the supported `.conductor/settings.toml`.

**Non-goals**
- Changing how the main checkout or native `crbn new`/`checkout` worktrees behave
  (parity means Conductor matches them, not vice-versa).
- Changing Conductor's own `git worktree add` path/codename scheme (out of our
  control; we adapt to it).
- Sharing databases across workspaces (that's the existing `crbn up --borrow`
  opt-in; unchanged).

---

## 4. Proposed design

Two parts. Part A is the substance (a crbn command); Part B is the thin Conductor
wrapper that calls it.

### Part A — `crbn init`: provision the current worktree

Add an idempotent subcommand (working name **`crbn init`**; alt: `adopt` /
`provision`) that makes *the worktree it is run in* look exactly like one produced
by `crbn checkout`, then leaves the heavy stack boot to `crbn up`:

1. **Compute + persist a canonical slug** (see §5) via `persistSlug`
   (`worktree.ts:62`), overwriting any stale `.carbon-worktree`. This is the fix
   for the collision and the codename-reuse staleness.
2. **`env sync`** — copy `package.json#crbn.copy` files (today `[".env"]`) from the
   main checkout (`copy.ts` `envSync`).
3. **Install skills** — run `.ai/scripts/install-skills.sh` (symlink `.ai/rules` +
   `.ai/skills` into `.claude`/`.codex`), matching `do_post_create`.
4. **Idempotent + path-agnostic**: safe to re-run; resolves the main checkout via
   `--git-common-dir` (already how `bin/crbn:repo_root` works), so it works from
   any path including Conductor's.
5. *(Optional, see §9-D)* pre-allocate the slot and write `.env.local` so the env
   exists before the stack is booted. `crbn up` already does this idempotently, so
   this is a convenience, not a requirement.

Then refactor `do_post_create` (bash, `bin/crbn:404-417`) and the `.env` copy in
`new.ts:62-74` to call `crbn init`, so **one code path** provisions worktrees for
`new`, `checkout`, and Conductor. This removes today's drift where `new` copies
`.env` inline but skips `env sync`/skills while `checkout` does both.

### Part B — Conductor config → `.conductor/settings.toml`

Replace committed `conductor.json` with `.conductor/settings.toml`:

```toml
"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"

[scripts]
setup = "pnpm install && ./packages/dev/bin/crbn init"
run_mode = "concurrent"                       # workspaces are port-isolated by crbn
archive = "./packages/dev/bin/crbn remove --path . --yes"   # frees the registry slot too (see §6)

[scripts.run.dev]
command = "./packages/dev/bin/crbn up --all"
default = true
icon = "rocket"
```

Key changes vs today:
- **Slug no longer comes from `$CONDUCTOR_WORKSPACE_NAME`.** `crbn init` owns it
  (§5), killing the `carbon` collision.
- `env sync` + `install-skills` fold into `crbn init` (single source of truth).
- `run_mode = "concurrent"` is correct because crbn already isolates ports/DB per
  slug (the whole point of the slot registry).
- `archive` frees the slot, not just the containers (§6).

**Rollout caveat:** Conductor only honors a `settings.toml` change **after it is
merged to the default branch on the remote** (`origin/main`). Until then it keeps
reading the committed `conductor.json`. So we can either (i) ship `crbn init` +
fix `conductor.json` in the same PR for an immediate effect on the current legacy
path, then (ii) migrate to `settings.toml` — or do both in one PR and accept that
the TOML only activates post-merge. See §8.

---

## 5. Slug derivation — the central decision

The slug must be unique per worktree, stable, and ideally aligned with native
crbn. Candidates:

- **(R) Branch-derived, repo-prefixed** — `slug = "<repoBase>-<slugify(branch)>"`
  (e.g. `carbon-featuser-select`). Read the *current* branch via git inside
  `crbn init`.
  - ✅ Identical **shape** to native worktrees (`carbon-feat-service`), so
    `crbn list`/`status` show Conductor + native worktrees uniformly.
  - ✅ Deterministic, branch-aligned (slug and domain now tell the same story).
  - ✅ Never collides with main (`carbon`) or siblings (distinct branches).
  - ⚠️ On Conductor **codename reuse** (archive → recreate on the same physical
    dir with a new branch) the slug changes, so the old slot orphans in the
    registry — mitigated by the §6 archive change (`crbn remove` frees it).
- **(B) Path/codename-derived** — drop the `echo` line entirely and let
  `resolveSlug` fall back to `basename(worktreeRoot)` = `moscow`/`macau`.
  - ✅ Minimal change; already unique across Conductor dirs; reuses the same slot
    on codename reuse (no orphan).
  - ❌ Not branch-aligned (slug `moscow`, domain `featuser-select.dev` split-brain
    persists); doesn't match native shape; a reused dir silently reuses a prior
    branch's DB unless volumes were wiped.

**Recommendation: (R) branch-derived, repo-prefixed**, because it most literally
satisfies "do the same thing as `crbn checkout`" and eliminates the split-brain.
Pair it with the §6 archive fix so orphan slots don't accumulate. (Option B is the
acceptable low-effort stopgap if we only want to stop the bleeding — see §8.)

Uniqueness guard: `crbn init` should still call `ensureSlugAvailable`
(`worktree.ts:95`) and, on the (rare) event that the branch-derived slug is taken
by a *different* live path, fall back to appending a short disambiguator or the
codename. Two git worktrees can't share a branch, so collisions only arise from
stale/misconfigured state.

---

## 6. Archive / registry-slot lifecycle

Today `archive = crbn down --volumes` stops the stack but leaves the
`~/.carbon/dev-ports.json` entry behind (`down.ts` never calls `removeSlot`). With
branch-derived slugs (§5-R), that means an orphan per archived workspace. Fix by
having archive free the slot. Options:

- Point archive at a **non-interactive** teardown that removes the slot. `crbn
  remove` already does `removeSlot` (`remove.ts:159`) but is interactive
  (multi-select). This spec assumes we add non-interactive flags
  (`crbn remove --path . --yes`) or a `crbn down --purge` that also calls
  `removeSlot` + flushes the redis DB index. **Decision in §9-C.**

---

## 7. Edge cases

- **Main branch / main checkout.** Conductor workspaces are always on a feature
  branch, never `main`, so `slug = carbon-<branch>` never regenerates the main
  checkout's `carbon`. `crbn init` should still refuse to run in the main checkout
  root (guard via `--git-common-dir` == cwd) to avoid clobbering `carbon`.
- **Codename reuse with stale `.carbon-worktree`.** `crbn init` overwrites the
  slug file every run, so a reused dir is corrected on setup. (Today's `echo` also
  overwrites, but with the wrong value.)
- **Branch rename after creation.** Domain (branchPrefix) follows the branch on the
  next `crbn up`; slug stays put (keyed in the registry). Acceptable and matches
  native behavior. If we want slug to track renames too, that's a separate
  `crbn init --reslug`.
- **Slash-stripped branch names.** Conductor's `featuser-select` vs a native
  `feat/user-select` yields different prefixes/slugs. Cosmetic; note it. Not worth
  fighting Conductor's sanitizer.
- **PR workspaces.** Native `crbn checkout <pr#>` sets push-back tracking; Conductor
  has its own PR flow (`.context/attachments/.../PR instructions.md`). Out of scope
  — `crbn init` only provisions env; it doesn't manage PR tracking.
- **`.context` dir.** Conductor-managed, locally git-excluded; untouched.

---

## 8. Rollout plan

Because `settings.toml` activates only post-merge, sequence to avoid a broken
in-between state:

1. **PR 1 (crbn):** add `crbn init` (+ non-interactive `crbn remove`/`down --purge`
   per §9-C), refactor `do_post_create`/`new` to use it, unit tests
   (`packages/dev/src/*.test.ts` style). No behavior change for existing users of
   `new`/`checkout` beyond consolidation.
2. **PR 1 also:** fix the **legacy** `conductor.json` `setup` to
   `pnpm install && ./packages/dev/bin/crbn init` and `archive` to the
   slot-freeing teardown — this takes effect immediately on the current legacy
   path and fixes the `moscow`↔`carbon` collision without waiting on TOML.
3. **PR 2 (config migration):** add `.conductor/settings.toml` (Part B) and delete
   `conductor.json`. Takes effect once merged to `origin/main`. Verify Conductor
   picks it up on the next new workspace.
4. **One-time cleanup** on dev machines: `crbn remove` the stale `carbon`-slug
   Conductor entry, or re-run `crbn init && crbn up` in existing Conductor
   workspaces to re-slug them.

---

## 9. Open questions / decisions (recommendations — please veto)

- **A. Command name.** `crbn init` vs `crbn adopt` vs `crbn provision`.
  *Recommend `crbn init`* (shortest; "make this dir a ready Carbon worktree").
- **B. Slug policy.** §5. *Recommend (R) branch-derived, repo-prefixed
  `carbon-<slugify(branch)>`.*
- **C. Archive teardown.** Add `crbn remove --path . --yes` (non-interactive) vs a
  new `crbn down --purge`. *Recommend extending `crbn remove` with
  `--path`/`--yes`* (reuses its existing `removeSlot` + redis-flush path;
  `down --purge` would duplicate that logic).
- **D. Should `crbn init` also write `.env.local` (pre-allocate the slot), or leave
  that to `crbn up`?** *Recommend leaving it to `crbn up`* to keep `init` cheap and
  side-effect-light; revisit if tools need `.env.local` present pre-boot.
- **E. Migrate to `settings.toml` now, or just fix `conductor.json`?** *Recommend
  both, sequenced per §8* — fix the legacy file for an immediate effect, migrate to
  TOML for the supported long-term config.
- **F. Keep `run_mode = "concurrent"`?** *Recommend yes* — crbn's slot registry
  already guarantees per-workspace port/DB isolation, which is exactly the
  precondition for concurrent runs.

---

## 10. Acceptance criteria

- Creating a fresh Conductor workspace on branch `feat/x` results in:
  - `.carbon-worktree` = `carbon-feat-x` (or the §9-B chosen scheme), **never**
    `carbon` and never equal to any other live worktree's slug.
  - `~/.carbon/dev-ports.json` gains a distinct entry pointing at the workspace
    path; `crbn up --all` boots without an `ensureSlugAvailable` error and with a
    port set disjoint from main and siblings.
  - `.env.local` `CARBON_WORKTREE` and `DOMAIN` tell a consistent story
    (`carbon-feat-x` / `x.dev` or `feat-x.dev` per Conductor's branch sanitizer).
  - `.claude`/`.codex` skill symlinks present; `.env` copied from main.
- Booting the main checkout and the Conductor workspace **simultaneously** works
  (no shared Docker project, no port clash).
- Archiving the workspace frees its registry slot (no orphan in
  `~/.carbon/dev-ports.json`).
- `crbn new` / `crbn checkout` behavior for native worktrees is unchanged
  (verified by existing `packages/dev` tests + a manual `crbn new` smoke).

---

## 11. Risks

- **Config-activation lag:** `settings.toml` only applies post-merge to main;
  mitigated by fixing `conductor.json` in the same PR (§8).
- **Refactoring `do_post_create`/`new` to share `crbn init`** could regress native
  worktree creation — cover with tests + a manual smoke before merge.
- **Re-slugging existing Conductor workspaces** changes their Docker project name,
  so the old `carbon-carbon`/`carbon-macau` stacks + volumes orphan until cleaned
  up (one-time `crbn remove`, §8-4). Data in those dev stacks is disposable.
- **Branch-derived slug + codename reuse** without the §6 archive fix would leak
  registry entries — the two changes must ship together.

---

## Appendix — key files

- `packages/dev/bin/crbn` — bash router; `cmd_checkout` (173-296),
  `do_post_create` (404-417), `repo_root` (63-75).
- `packages/dev/src/commands/new.ts` — `newWorktree` (dir + `.env` copy).
- `packages/dev/src/commands/up.ts` — `provisionSlot`/`resolveSlug`/`persistSlug`
  (168-360).
- `packages/dev/src/worktree.ts` — `resolveSlug` (49-60), `resolveSlot`
  (134-166), `ensureSlugAvailable` (95-120), registry `~/.carbon/dev-ports.json`.
- `packages/dev/src/env.ts` — `renderEnv`/`writeEnv` (`.env.local`).
- `packages/dev/src/services/portless.ts` — `branchToPrefix` (390-402).
- `packages/dev/src/commands/remove.ts` — `removeSlot` (159).
- `packages/dev/src/commands/copy.ts` — `envSync` (`package.json#crbn.copy`).
- Repo config: `conductor.json` (legacy) → `.conductor/settings.toml` (target).
</content>
