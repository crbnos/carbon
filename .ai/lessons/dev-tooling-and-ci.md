# Dev tooling and CI lessons

The crbn CLI, the local stack, git and worktrees, CI, scripts, the harness, agents and skills, docs authoring.

## A folder that implies "run this in production" arms every file dropped into it

```scope
id: a-folder-that-implies-run-this-in-production-arms-every-file
paths: ["ci/src/one-off-scripts.ts","scripts/one-off/**"]
triggers: ["discoverOneOffScripts","SCRIPT_FILENAME"]
```

**Context:** One-off data migrations (copying the legacy `private` bucket into
per-company buckets) needed to run automatically, once per database. The design
made `scripts/one-off/` self-registering: `discoverOneOffScripts` reads the
directory and every `.ts` file is executed against every production database
after `supabase db push`, recorded in that database's own `scriptRun` table.

**Problem:** Removing the hardcoded registry array killed a real duplication —
a list that could disagree with the folder — but replaced an explicit opt-in
with an implicit one. `endsWith(".ts")` also matches `foo.test.ts`, and
`scripts/lib/` already colocates `*.test.ts` beside its sources. A developer
following the repo's own established convention would have shipped a test file
into production execution. Nothing in the type system, the linter, or a review
diff makes a new file in a directory look dangerous.

**Rule:** When a directory's *membership* is what triggers an action, gate it
with an ALLOWLIST pattern and make non-matching files a loud failure, never a
silent skip. A blocklist arms whatever nobody thought to exclude; a silent skip
is worse than a crash, because a script ignored for a filename typo is
indistinguishable from one that already ran, and the deploy reports success
having done nothing. State the naming rule in the folder's README, and test it
with the exact filename the surrounding conventions would produce.

**Applies to:** `ci/src/one-off-scripts.ts` (`SCRIPT_FILENAME`,
`discoverOneOffScripts`), `scripts/one-off/`, and any future
convention-over-configuration discovery where the discovered thing is executed
rather than merely loaded.

## A git merge can move a doc comment onto a different function

```scope
id: a-git-merge-can-move-a-doc-comment-onto-a-different-function
paths: ["apps/erp/app/modules/*/*.service.ts"]
triggers: ["@mcp ","generate:mcp"]
```

**Context:** Every API tool is declared by an `@mcp` line in its function's doc comment.
Main inserted a new function directly under an existing doc block.

**Problem:** The merge was clean, but the doc block (and its `@mcp` line) now sat above
the NEW function, and the function it described had none. That function silently stopped
being a tool. Nothing fails: an untagged export is simply not exposed.

**Rule:** After merging into a branch that touches service files, regenerate the manifest
and diff the tool NAMES against the pre-merge list. A name that disappears is a displaced
tag until proven otherwise.

**Applies to:** `apps/erp/app/modules/*/*.service.ts`, `pnpm run generate:mcp`.

## A lookup table keyed by source text must be a `Map`

```scope
id: a-lookup-table-keyed-by-source-text-must-be-a-map
paths: ["scripts/lib/service-ast.ts"]
triggers: ["memberName","Object.hasOwn"]
```

**Context:** The MCP generator once decided "is this call a database write" by
indexing an object literal with `memberName`.

**Problem:** `memberName` comes from the code being analysed, so `x.toString()` looked up
the `"toString"` key, found `Object.prototype.toString`, and counted as a write. Five read
tools silently left the manifest until the digest diff showed them missing.

**Rule:** When the key is arbitrary input (an identifier from parsed source, a column name,
a user string), use a `Map`/`Set` or `Object.hasOwn`, never `obj[key]` truthiness. And diff
the generated manifest against the previous one before trusting a generator change.

**Applies to:** `scripts/lib/service-ast.ts`, and any analyser or dispatcher that indexes a
record by a name it did not choose.

## A text replace on a function name also renames its prefix siblings

```scope
id: a-text-replace-on-a-function-name-also-renames-its-prefix-si
paths: ["apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json"]
triggers: ["ts-morph","tool-manifest.digest.json"]
```

**Context:** The service-function migration (2026-10-16) renamed thousands of call sites with scripts.

**Problem:** A string or regex replace of `getJob` also matched `getJobs`, `getJobOperation` and every other name that starts with it, and matched the name inside strings and comments. One pass also left a stray suffix on a public name (`createSupplierInteractionLineDocumentUploadUrlTool`), which renamed an MCP tool without anyone asking for it.

**Rule:** Rename code through ts-morph references (`findReferencesAsNodes`, `rename`), never through text. After a mass rename, diff the published tool names against main (`tool-manifest.digest.json`) and explain every added and removed name.

**Applies to:** codemods over `apps/erp/app/modules/**` and any script that renames exports.

## A Vite plugin that reads the file name must drop the query first

```scope
id: a-vite-plugin-that-reads-the-file-name-must-drop-the-query-f
paths: ["packages/dev/vite.js","apps/*/vite.config.ts"]
triggers: ["linguiWithoutIdQuery","basename(id)"]
```

**Context:** Lingui's native macro transform chooses its parser from the module id's file name.

**Problem:** Only route modules carry a query after the extension. vitest and non-route files never show the failure.

**Rule:** When a transform plugin misbehaves only on route modules, look at the id's query. Verify a build-plugin change with a real `react-router build` of ERP, not with vitest. The rest is in `.claude/rules/i18n-lingui-system.md`.

**Applies to:** `packages/dev/vite.js` (`linguiWithoutIdQuery`), `apps/*/vite.config.ts`.

## `crbn reload` must load root `.env` — compose-substituted secrets silently reset

```scope
id: crbn-reload-must-load-root-env-compose-substituted-secrets-s
paths: ["packages/dev/src/commands/reload.ts","packages/dev/src/commands/up.ts","packages/dev/src/env.ts"]
triggers: ["loadEnvFiles","docker compose","force-recreate"]
```

**Context:** Enabling GoTrue SAML via `${SAML_ENABLED:-false}` / `${SAML_PRIVATE_KEY:-}` in docker-compose.dev.yml, values kept in root `.env`.

**Problem:** `crbn reload <service>` once ran `docker compose up -d --force-recreate` without root `.env` in process.env, so compose substitution fell back to the defaults. Recreating ANY service also reconciles every other service whose definition changed. So a `crbn reload kong` recreated gotrue with SAML silently OFF.

**Rule:** Any crbn command that invokes docker compose must call `loadEnvFiles` (`packages/dev/src/env.ts`) first, as `up.ts` and `reload.ts` do. After any reload, verify the dependent feature's health endpoint (e.g. `curl .../sso/saml/metadata` → 200), not just container status. The rest is in `.claude/rules/environment-configuration.md`.

**Applies to:** packages/dev reload/compose commands; any GoTrue/Kong/storage env sourced from root `.env`.

## Never `git checkout` a generated file to undo a local patch — the user may have regenerated it

```scope
id: never-git-checkout-a-generated-file-to-undo-a-local-patch-th
paths: ["packages/database/src/types.ts","apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json"]
triggers: ["git checkout --","generate:types"]
```

**Context:** Typechecking a new-column change in a worktree with no local database, the
generated `packages/database/src/types.ts` was patched by hand as a throwaway so `tsc`
could see the columns, then "restored" with `git checkout -- …/types.ts`. Meanwhile the
user had run `pnpm db:migrate`, which regenerated that file with the real columns.

**Problem:** The checkout reverted the user's regeneration to `HEAD`, silently leaving the
repo with types that no longer matched the live schema. The first symptom
was a wall of `Duplicate identifier` errors from re-applying the throwaway patch on top of
the regenerated file.

**Rule:** Before reverting any generated file, `git diff` it and confirm the only changes
are yours. Prefer regenerating (`pnpm generate:types`, needs the local stack) over a
checkout; if there is no stack, keep the throwaway patch in a scratch copy rather than the
tracked file.

**Applies to:** `packages/database/src/types.ts`,
`apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`, any generated artifact.

## Parallel subagents each running the heavy checks exhaust the machine

```scope
id: parallel-subagents-each-running-the-heavy-checks-exhaust-the
paths: ["packages/dev/bin/heavy-lock",".claude/skills/**"]
triggers: ["heavy-lock","max-old-space-size","generate:mcp","subagent"]
```

- **Context:** A review fanned out to six subagents. Each ran the `erp` typecheck, `generate:mcp` or a raw `tsc` in `apps/erp` to verify its own part.
- **Problem:** The `erp` typecheck peaks near 10 GB and `generate:mcp` near 5 GB. Five of them at once took about 28 GB.
- **Rule:** Never raise `--max-old-space-size` to make one fit. A waiting run prints `heavy-lock: waiting for …`: that is the queue working, not a hang. Do not kill it. The rest is in `AGENTS.md` (Always).
- **Applies to:** Any skill or workflow that dispatches subagents (review, execute, fix, conductor).

## Regenerating `src/email/previews/` fixtures requires a follow-up biome format pass

```scope
id: regenerating-src-email-previews-fixtures-requires-a-follow-u
paths: ["packages/documents/scripts/generate-notification-previews.mjs","packages/documents/src/email/previews/*"]
triggers: ["generate-notification-previews"]
```

**Context:** Adding ChangeOrder* entries to `packages/documents/scripts/generate-notification-previews.mjs` and re-running it to emit the per-event preview fixtures.

**Problem:** The generator writes raw `JSON.stringify(..., null, 6)` output (quoted keys, 6-space indent), but the committed fixtures are biome-formatted (unquoted keys, 2-space indent). Re-running the script therefore rewrites **all** existing fixtures into the raw style — 28 files of pure formatting churn drowning the 3 intended new files in the diff.

**Rule:** After running `generate-notification-previews.mjs`, always run `pnpm exec biome check --write packages/documents/src/email/previews/` before reviewing the diff. Only intended fixture changes should remain; if pre-existing fixtures still show as modified, something else changed.

**Applies to:** `packages/documents/scripts/generate-notification-previews.mjs`, `packages/documents/src/email/previews/*`, and any generator whose committed output is formatter-normalized.

## Review the deployable diff, including new files

```scope
id: review-the-deployable-diff-including-new-files
paths: ["apps/mes/app/routes/**"]
triggers: ["git status --short","git diff --cached"]
```

**Context:** Adding MES bin loaders backed by new database RPCs.

**Problem:** The service and UI changes were visible in the diff, but the new route and migration were untracked, so deploying the reviewed patch would leave the requests returning 404 and the RPCs missing. A follow-up picker change also called the single-item stock RPC once for every material revision.

**Rule:** Before requesting review, check `git status --short` and `git diff --cached --stat` for every new route and migration that a changed call site needs. For stock shared across item revisions, collect the revision IDs and use one set-based, company-scoped read.

**Applies to:** MES routes and inventory services, ERP inventory RPC callers, and `packages/database/supabase/migrations/`.

## `scripts/one-off/` is executed in production

```scope
id: scripts-one-off-is-executed-in-production
paths: ["scripts/one-off/**"]
triggers: ["scriptRun"]
```

**Context:** A codemod that added `@mcp` tags to service files was saved as
`scripts/one-off/tag-mcp-exposure.ts` — "a script run once".

**Problem:** That folder is a registry, not a scratch area. `ci/src/migrations.ts` runs
every `.ts` file in it against every workspace database on the next deploy and records it
in `scriptRun`. A source-rewriting codemod there would have been executed by the deploy
workflow.

**Rule:** `scripts/one-off/` is only for one-time DATA migrations (see its README). A
codemod is run locally and deleted, or lives in `scripts/` if it is worth keeping.

**Applies to:** anything added under `scripts/one-off/`.

## ts-morph re-resolves the whole program after every edit

```scope
id: ts-morph-re-resolves-the-whole-program-after-every-edit
paths: []
triggers: ["ts-morph"]
```

**Context:** The barrel-removal codemod (2026-10-16) resolved each import's target, edited it, then resolved the next one.

**Problem:** Each edit invalidates the type checker, so the next symbol lookup rebuilt the program. The script took many minutes for what should take seconds.

**Rule:** In a ts-morph codemod, resolve everything first (symbols, targets, references) into plain data, then make all the edits, then save once.

**Applies to:** scratch codemods using ts-morph over the ERP project.

## Two `crbn up` in one worktree take each other down

```scope
id: two-crbn-up-in-one-worktree-take-each-other-down
paths: ["packages/dev/src/commands/up.ts"]
triggers: ["crbn up"]
```

**Context:** `crbn up` records its pid in `~/.carbon/stacks/<slug>/up`, and its teardown first stops whichever `crbn up` that file names.

**Problem:** An agent started `crbn up` in the background, then the user started another in the same worktree. The second overwrote the marker and reused the first's dev servers. Stopping the agent's run then SIGINT'd the user's run through the marker, and every app went down.

**Rule:** Run one `crbn up` per worktree. Check `ps` for a running one (or ask) before starting it, and never stop it while someone else may be using it.

**Applies to:** Agents and humans booting a stack in a shared worktree.

## Vite caches a module-resolution MISS for the whole dev session

```scope
id: vite-caches-a-module-resolution-miss-for-the-whole-dev-sessi
paths: ["apps/erp/app/components/**","apps/mes/app/components/**"]
triggers: []
```

**Context:** Added a new component: edited the importing file first, created the new file a moment later.

**Problem:** The SSR module graph cached the failed resolution, so every request 500'd with `Failed to load url ./components/<NewComponent> … Does the file exist?` even though it did. `docker exec … grep` and `ls` both confirmed the file, which sends you hunting a phantom bug in the import path.

**Rule:** Create the new module BEFORE the code that imports it. If the overlay already says "Does the file exist?" and it does, `touch` the new file and its importer to force re-resolution — the file's presence alone will not invalidate the cached miss.

**Applies to:** any new file under `apps/{erp,mes}/app` added after its importer during a running `crbn up`; the sibling failure mode for edge functions is the cached compiled isolate (`crbn reload edge-runtime`).

## zsh does not split an unquoted variable into words

```scope
id: zsh-does-not-split-an-unquoted-variable-into-words
paths: []
triggers: ["biome check","git diff --name-only"]
```

**Context:** Running Biome on a list of changed files held in a shell variable (2026-10-16).

**Problem:** In zsh, `biome check $files` passes the whole list as ONE argument. Biome reported "File name too long" and "No files were processed", which reads as a Biome bug, not a shell one.

**Rule:** Pass file lists through `xargs` (`git diff --name-only | xargs biome check`) or use zsh's `${=files}`. Don't trust a tool error about a path until you have checked how the shell passed it.

**Applies to:** every Bash call in this environment (the login shell is zsh).

## A cached generator's inputs are everything it executes, not everything it parses

```scope
id: a-cached-generator-s-inputs-are-everything-it-executes-not-e
paths: ["turbo.json","apps/*/turbo.json","packages/*/turbo.json","apps/erp/test/mcp-manifest-cache-inputs.test.ts"]
triggers: ["generate:mcp","\"inputs\""]
```

**Context:** The MCP manifest generator was made a cached Turborepo task with `inputs`
listing the service, models and `types.ts` files it parses.

**Problem:** It also EXECUTES every `*.models.ts` to convert the zod validators, so the
schemas depend on whatever those files import: `sales.utils.ts`, `accounting.utils.ts`,
`samplingStandards`, `@carbon/utils`. A change to one of those was a cache hit; turbo
restored the old manifest (and the old committed digest) over the working tree, and the
build bundled it. Uncached, this could not happen.

**Rule:** Before caching a task, list what it loads and runs, not only what it reads on
purpose, and pin that list with a test against the task's real imports. If the true set
cannot be named, leave the task uncached.

**Applies to:** `//#generate:mcp` in `turbo.json` (pinned by
`apps/erp/test/mcp-manifest-cache-inputs.test.ts`), and any task given `inputs`.

## A codemod rename can shadow, and the typecheck will not say so

```scope
id: a-codemod-rename-can-shadow-and-the-typecheck-will-not-say-s
paths: []
triggers: ["ts-morph","jscodeshift","replaceWithText"]
```

**Context:** A codemod collected loop writes into new arrays, then renamed them to drop numeric suffixes.
**Problem:** Two new arrays took the name of the array their loop iterated, inside the same function. The inner `const` shadowed it, the loop walked the new empty array, and nothing was written. TypeScript accepts the shadow.
**Rule:** After a codemod declares or renames variables, scan each new name for an earlier use in the same function. Run the database tests that cover the touched writes before committing.
**Applies to:** Scripted refactors in service files.

## A global pnpm virtual store breaks this repo's peer dependencies

```scope
id: a-global-pnpm-virtual-store-breaks-this-repo-s-peer-dependen
paths: [".npmrc","pnpm-workspace.yaml"]
triggers: ["virtual-store","--frozen-lockfile"]
```

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

## A PR's CLA check counts every commit author on the branch, including copies of main's commits

```scope
id: a-pr-s-cla-check-counts-every-commit-author-on-the-branch-in
paths: []
triggers: ["user.email","git rebase","force-with-lease"]
```

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

## A `prepare` script that edits git config reaches every worktree

```scope
id: a-prepare-script-that-edits-git-config-reaches-every-worktre
paths: ["package.json","scripts/git-hooks/**"]
triggers: ["simple-git-hooks","core.hooksPath","preserveUnused"]
```

**Context:** Replacing husky with simple-git-hooks, `prepare` unset `core.hooksPath` and installed hooks. It ran on every `pnpm install` in a worktree.

**Problem:** Worktrees share one `.git`. The unset removed the main checkout's `core.hooksPath` and simple-git-hooks wrote into the shared `.git/hooks`, so checkouts still on husky skipped their hooks without a word. The desktop app also sets `core.hooksPath` at WORKTREE scope, which a plain `git config --unset` does not touch. simple-git-hooks additionally deletes every hook it does not manage unless `preserveUnused` is set.

**Rule:** Treat a lifecycle script that touches git config or `.git/hooks` as a change to every checkout of the repository. Use `pnpm install --ignore-scripts` while such a branch is unmerged, clear both the local and the worktree scope, and set `preserveUnused: true`.

**Applies to:** root `package.json` (`prepare`, `simple-git-hooks`), `scripts/git-hooks/`.

## A `resolve.alias` stub reaches the server bundle too

```scope
id: a-resolve-alias-stub-reaches-the-server-bundle-too
paths: ["apps/*/vite.config.ts","apps/*/app/ssr-shims/**","packages/dev/vite.js"]
triggers: ["clientOnlyAlias","unpdf/pdfjs","resolve.alias"]
```

**Context:** Both apps aliased `unpdf/pdfjs` to a throwing stub to keep unpdf's 1.5 MB engine out of the browser bundle, where react-pdf's `pdfjs-dist` is used instead.

**Problem:** A top-level `resolve.alias` applies to every Vite environment. On the server `unpdf/pdfjs` is the only PDF engine, so every deployed document extraction (purchase invoice, sales RFQ) failed with "Serverless PDF.js bundle could not be resolved". Dev and vitest passed: dev leaves `unpdf` external, so Node resolves the real module and the alias never applies.

**Rule:** A stub that exists to shrink the client bundle goes through `clientOnlyAlias` (`@carbon/dev/vite`), never `resolve.alias`. Verify a server-side dependency change against a bundle built with `ssr.noExternal: true`, not against the dev server.

**Applies to:** `apps/{erp,mes}/vite.config.ts`, `app/ssr-shims/`, `packages/dev/vite.js`.

## Bare-tsx scripts: isolate the import chain, never flip a shared package's `type`

```scope
id: bare-tsx-scripts-isolate-the-import-chain-never-flip-a-share
paths: ["packages/jobs/src/scripts/**","packages/database/src/seed-*.ts","packages/database/src/check-*.ts","ci/src/**"]
triggers: ["does not provide an export named","\"type\": \"module\""]
```

**Context:** `pnpm db:check:backups` (`packages/jobs/src/scripts/check-backups.ts`) runs under bare `tsx`, which cannot named-import a CJS workspace package at runtime. Its import of `company-backup.ts` pulled in `@carbon/logger` via a module-scope `getLogger`, and the branch "fixed" the resulting crash by adding `"type": "module"` to `packages/logger/package.json` — a module-system change to a package consumed by 13 others, made for one dev script.

**Problem:** Flipping a shared package's `type` field changes resolution for every consumer to satisfy one entrypoint, and the connection between the flip and its reason is invisible — the next person hitting the same error flips the next package. The actual dependency was incidental: the script needed six pure functions that sat in a file whose module scope also called the logger.

**Rule:** When a bare-`tsx` (or plain-node) script hits `does not provide an export named …`, fix the SCRIPT's runtime import chain: move the pure logic it needs into a module with no runtime `@carbon/*` imports (type-only imports are fine — they erase) and import that. `packages/jobs/src/backups/schema.ts` is the pattern; `packages/database`'s seed scripts (relative `.ts` imports only) are the older precedent. Never change a shared package's `type`/`exports` for one script's benefit.

**Applies to:** `packages/jobs/src/scripts/**`, `packages/database/src/{seed,check}-*.ts`, `ci/src/**`, and any new `tsx`-run script in a CJS-rooted package.

## Biome does not apply 3rd-level nested configs — enforce Deno via an override

```scope
id: biome-does-not-apply-3rd-level-nested-configs-enforce-deno-v
paths: ["biome.jsonc","packages/biome.jsonc"]
triggers: ["noConsole"]
```

**Context:** Bringing Supabase edge functions (`packages/database/supabase/functions/**`, Deno) into Biome's lint surface for the new `noConsole` rule. These files sit outside the linted globs (`apps/*/app/**`, `packages/*/src/**`) and were never Biome-formatted.

**Problem:** A dedicated nested `functions/biome.jsonc` (root:false, formatter off, noConsole only) is silently ignored. Biome applies the depth-1 nested config (`packages/biome.jsonc`) for the whole `packages/` subtree; a depth-2 nested config under it never governs — the `format` diagnostic keeps appearing and `formatter.enabled:false` has no effect. Letting `packages/biome.jsonc` (which `extends "//"`) govern the Deno files directly produces ~270 CI-failing errors (Deno globals → `noUndeclaredVariables`, `useImportType`, `organizeImports`, formatting) on never-linted code.

**Rule:** Do not rely on 3-level Biome config nesting. Add the target path to the depth-1 config's `files.includes`, then scope an `overrides` entry there (glob relative to that config) that turns off `formatter`/`assist` and the Node-oriented error rules (`correctness.noUndeclaredVariables`, `noUnusedVariables`, `style.useImportType`) while inheriting the one rule you want (`noConsole` as a warning). Verify with `pnpm exec biome check --reporter=summary <dir>` expecting 0 errors. See `packages/biome.jsonc`.

**Applies to:** `biome.jsonc` / `packages/biome.jsonc` rule scoping; any attempt to lint Deno edge functions or other non-`src/` trees.

## `@carbon/kv` answers null for a miss and for an outage

```scope
id: carbon-kv-answers-null-for-a-miss-and-for-an-outage
paths: ["packages/kv/src/**"]
triggers: ["@carbon/kv","withResilience","\"NX\""]
```

**Context:** The ERP's internal postings endpoint used `redis.set(key, "1", "PX", ttl, "NX")` to refuse a nonce it had seen.

**Problem:** `withResilience` (`packages/kv/src/resilient.ts`) turns a Redis failure or a 2-second timeout into the command's fallback, `null`. `SET NX` also answers `null` for a key that exists. The two cases looked the same, so a Redis outage refused every MES posting as a replay.

**Rule:** Never read a `null` from `@carbon/kv` as "the key is there". Read the key back to tell the cases apart. Decide on purpose whether the feature fails open or closed when Redis is down, and log it.

**Applies to:** every `@carbon/kv` caller that branches on a command's result.

## crbn reload of storage leaves Kong routing 502s

```scope
id: crbn-reload-of-storage-leaves-kong-routing-502s
paths: ["packages/dev/src/commands/reload.ts"]
triggers: ["crbn reload","/storage/v1/"]
```

**Context:** Recreating the `storage` container (`crbn reload storage imgproxy`) after a compose edit.

**Problem:** Kong resolves upstreams via Docker DNS at proxy time but held the old container IP — every `/storage/v1/*` request returned 502 while the storage container itself was healthy and listening.

**Rule:** After `crbn reload` of any service Kong proxies (storage, auth, postgrest, edge-runtime), also run `crbn reload kong`. Verify with `curl $SUPABASE_URL/storage/v1/version` (expect 200), not with `docker ps`.

**Applies to:** `packages/dev` compose workflow, any per-service reload.

## Direct psql DDL needs a PostgREST schema-cache reload

```scope
id: direct-psql-ddl-needs-a-postgrest-schema-cache-reload
paths: []
triggers: ["NOTIFY pgrst","psql -c","PGRST205"]
```

**Context:** Applied an unshipped migration's delta (drop `assemblyGroup`, create `assemblyUnit`) to the local DB with `psql` instead of `crbn migrate`, to avoid a full rebuild. The ERP page then hung: the `$id` loader's `Promise.all` timed out (`fetchWithRetry` TimeoutError) even on queries against unrelated tables.

**Problem:** PostgREST caches the DB schema. `crbn migrate` / `db:migrate` reload it after applying migrations; a raw `psql` DDL does not. With a stale cache, queries against the changed tables can't resolve and hang, which exhausts the connection pool and times out *other* queries too. (Confirmed after: `assemblyGroup` returned PGRST205 "Could not find the table in the schema cache".)

**Rule:** After any direct-psql schema change to a local Supabase DB, reload PostgREST — `psql -c "NOTIFY pgrst, 'reload schema';"` (or `docker restart <...>-postgrest-1`). Prefer `crbn migrate` when possible; when patching by hand (e.g. editing an unshipped migration in place), the reload is a required follow-up.

**Applies to:** any local schema change applied outside `crbn migrate`; symptom is loader/REST timeouts after a DDL patch.

## `git add` aborts the whole invocation on one unmatched pathspec

```scope
id: git-add-aborts-the-whole-invocation-on-one-unmatched-pathspe
paths: [".claude/skills/check-and-commit/**"]
triggers: ["git add","git mv","git commit"]
```

**Context:** Committing a spec that had been moved with `git mv`, the staging command listed both the old and new paths. The old path no longer existed, so `git add` exited with `fatal: pathspec … did not match any files` and staged **nothing** — but the following `git commit` still ran and produced a commit containing only the already-staged deletion. The spec was removed from the branch without its replacement, and it was pushed before anyone noticed.

**Problem:** `git add` is all-or-nothing across its arguments, and a `fatal:` from it does not stop a `&&`-free command sequence. The failure message scrolls past in a multi-command block, and `git commit` happily commits whatever the index already held — which after a `git mv` is exactly the destructive half of the change.

**Rule:** Never list a path that a previous step may have moved or deleted. Build the staging list from `git status --porcelain` output rather than typing paths, and **verify the index before committing** — `git status --porcelain | grep -vc "^[MARD]"` must be 0, or diff `git diff --cached --name-only` against the intended file list. Treat a commit whose file count differs from the intended change as a failed commit, not a done one.

**Applies to:** any commit flow following a `git mv`, `/check-and-commit`, scripted staging.

## Local database URLs must match Docker's loopback binding

```scope
id: local-database-urls-must-match-docker-s-loopback-binding
paths: ["packages/dev/src/stack.ts"]
triggers: ["localhost:54322","127.0.0.1:54322","SUPABASE_DB_PORT","--db-url"]
```

**Context:** The database types workflow runs `crbn migrate` against a fresh shared
Postgres container on GitHub Actions.

**Problem:** Compose publishes port 54322 on `127.0.0.1`, but `dbUrl()` emitted
`localhost`. The Supabase CLI resolved that to `::1` and failed to connect after
the migrations had already succeeded. Changing the URL to `127.0.0.1` exposed
another CLI behavior: it treats that host and port as its own `supabase start`
database and refuses to generate types without that container.

**Rule:** Use `127.0.0.1` in generated host database URLs when the corresponding
Docker port is bound to IPv4 loopback. For `supabase gen types --db-url`, set
the CLI's `SUPABASE_DB_PORT` to a different port in that process so it honors
the explicit URL as a direct connection. Keep URL expectations in the dev
tests aligned with the binding.

**Applies to:** `packages/dev/src/stack.ts`, database and pooler URLs from
`renderEnv()`, and local CLI consumers such as database type generation.

## Never blind-pop a stash in a Conductor worktree — the stash stack is shared/stale

```scope
id: never-blind-pop-a-stash-in-a-conductor-worktree-the-stash-st
paths: []
triggers: ["git stash"]
```

**Context:** During /execute, proving an erp typecheck failure pre-existing by temporarily parking three edited files with `git stash push -u <paths>` in a Conductor workspace.

**Problem:** The `stash push` failed ("could not write index" — likely a concurrent git process from a sibling workspace; untracked-file pathspecs also fail plain `stash push`). No stash was created, but the follow-up `git stash pop` applied the TOP of the existing stash stack — an old stash from a *different branch's* work — half-applying unrelated files with merge conflicts (`UU`) and staged changes that then had to be surgically reverted.

**Rule:** In Conductor/multi-worktree checkouts, don't use `git stash` for temporary file parking at all. Prove a failure is pre-existing with `git show HEAD~1:<file>` / `git log -- <file>` / a merge-base check instead. If stash is truly unavoidable: verify the push succeeded AND `git stash list` shows YOUR entry at stash@{0} before ever popping, and never `pop` after a failed `push`.

**Applies to:** any git stash usage in Conductor workspaces; /execute and /check-and-commit loops; proving pre-existing test/typecheck failures.

## Resolve merge conflicts in GENERATED files by regenerating, not by hand-editing the markers

```scope
id: resolve-merge-conflicts-in-generated-files-by-regenerating-n
paths: ["packages/database/src/types.ts","packages/database/src/swagger-docs-schema.ts"]
triggers: ["<<<<<<<","generate:types","generate:swagger"]
```

**Context:** Merging `origin/main` into a long-lived feature branch where both sides had added migrations. The only conflict was a generated output: one FK-relationship hunk in `packages/database/src/types.ts`.

**Problem:** Git auto-combined most of the generated output but left one view's relationship list conflicting. Hand-picking a side drops one branch's relationships (the view genuinely has all the columns); union-merging risks duplicating entries; either way the result may not match what the real generator emits from the COMBINED schema. Generated files are outputs, not source — resolving their conflict markers by hand is guessing at the generator.

**Rule:** For a conflict in a generated file, regenerate instead of editing markers. For `@carbon/database` types: start the postgres container, apply BOTH branches' pending migrations (`pnpm db:migrate`), then `pnpm run generate:types` — it overwrites `types.ts` from the live schema, connects via `SUPABASE_DB_URL`, and needs only postgres. `swagger-docs-schema.ts` reads PostgREST: with the stack up, `pnpm generate:swagger`, then `pnpm generate:workflow-catalog`. No build regenerates it, and CI fails when it lags the migrations. `git add` the regenerated files to resolve. `generate:types` FK ordering is non-deterministic, so ignore ordering-only churn afterward (see the turbo-regen lesson above). Applying pending migrations forward is NOT a DB rebuild — that is the normal path; a full reset still needs the user.

**Applies to:** merging `main` into any branch with migrations on both sides; conflicts in `packages/database/src/types.ts`, `swagger-docs-schema.ts`, and any committed generated artifact.

## Scripted source patches must assert their anchors

```scope
id: scripted-source-patches-must-assert-their-anchors
paths: []
triggers: ["sed -i","write_text(","perl -pi"]
```

**Context:** Applying code changes to large files via scripted string replacement (python/sed) instead of hand editing.

**Problem:** A `.replace()` whose anchor doesn't match (e.g. after Biome reformatted the code) is a silent no-op: the script reports success, the file is unchanged, and the missing code later presents as an inexplicable runtime bug. One silent miss cost hours of "stale module" mis-debugging — the client genuinely lacked a branch the server had.

**Rule:** Every scripted patch must assert the anchor's occurrence count before replacing (`assert s.count(old) == 1`) and fail loudly on a miss. Never chain a patch script with `&&` after an unasserted step.

**Applies to:** Any agent or script editing source by string replacement, repo-wide.

## The `@carbon/ee` barrel boots the server env — four places that breaks

```scope
id: the-carbon-ee-barrel-boots-the-server-env-four-places-that-b
paths: ["packages/ee/src/index.ts","packages/ee/src/sync/**","packages/jobs/src/inngest/functions/integrations/topology.ts"]
triggers: ["from \"@carbon/ee\"","vi.mock(\"@carbon/ee\"","import(\"@carbon/ee\")"]
```

**Context:** Adding `providerRole` + `IntegrationTopology` (`.ai/plans/implemented/2026-09-23-provider-roles-topology.md`).
Consumers across `@carbon/jobs`, `apps/erp` and tests needed the registry lookup
`getIntegrationIdsByRole` / `resolveIntegrationTopology`.

**Problem:** `packages/ee/src/index.ts` imports every integration descriptor, and
`ramp/config.tsx` imports `RAMP_CLIENT_ID` from `@carbon/auth`, which validates
the FULL server env at import time. So a plain `import … from "@carbon/ee"`
fails in four distinct ways, each with a different symptom:

1. **In a `*.service.ts`** — these were re-exported through the module barrel that
   client components import, so they were browser-bundled. The build fails with
   "server-only module referenced by client". (The barrels are gone since
   2026-10-16; a service file reaches the browser now only through a route
   component that uses one of its values — see "A server-only value in a route
   component, or a dropped side-effect import, fails only the production build".) (`accounting.service.ts` cannot use
   the registry at all; its id list stays hard-coded with a comment saying why.)
2. **In a test** — `Error: INNGEST_SIGNING_KEY is not set` at import. Hit three
   times: a test importing the barrel directly, a test importing a module that
   imports it, and a jobs test importing a module whose sibling did.
3. **As a lazy `await import("@carbon/ee")`** — moves the failure from module
   load to CALL time, which looks fixed until a test actually exercises the path.
4. **Via a `vi.mock("@carbon/ee", …)` fixture** — the mock lists exports
   explicitly, so adding a registry call to a loader breaks any test mocking it
   with `No "X" export is defined on the "@carbon/ee" mock`.

**Rule:** Keep decision cores free of the barrel. Put shared logic in an
import-light module (`packages/ee/src/sync/**` imports no `@carbon/auth`) and
take the registry slice as an ARGUMENT — `buildIntegrationTopology(rows,
descriptors)`, not `buildIntegrationTopology(rows)`. Only ENTRY POINTS (Inngest
functions, route loaders/actions) import the barrel and inject what they read;
give that import its own tiny module (`jobs/…/integrations/topology.ts`) so the
blast radius is one file. When you add a registry call to a loader, grep for
`vi.mock("@carbon/ee"` and extend those fixtures in the same change. Precedent
for the same shape elsewhere: `events/sync-tables.ts` and
`accounting/core/subscriptions.ts` are both deliberately import-light.

**Applies to:** `packages/ee/src/index.ts` consumers; `packages/ee/src/sync/**`;
`packages/jobs/src/inngest/functions/**`; any `apps/erp` `*.service.ts`; any test
mocking `@carbon/ee`.

## The edge runtime reuses a worker, env and all, per pool key

```scope
id: the-edge-runtime-reuses-a-worker-env-and-all-per-pool-key
paths: ["packages/dev/docker/edge-main/index.ts"]
triggers: ["userWorkers.create"]
```

**Context:** One shared `supabase/edge-runtime` serving every worktree, with the
dispatcher (`packages/dev/docker/edge-main/index.ts`) passing each request's
worktree API as `SUPABASE_URL` in `EdgeRuntime.userWorkers.create({ envVars })`.

**Problem:** With the default pool key, a worker created with worktree A's env
served worktree B's next request with A's `SUPABASE_URL`. Nothing errors.

**Rule:** A dispatcher that varies `envVars` per request must pass a `poolKey`
that includes every value that varies (here `${api} ${servicePath}`). The rest
is in `.claude/rules/dev-shared-services.md`.

**Applies to:** `packages/dev/docker/edge-main/index.ts` and any other
`--main-service` dispatcher.

## The pre-commit Lingui extract reads the working tree, not the commit

```scope
id: the-pre-commit-lingui-extract-reads-the-working-tree-not-the
paths: ["scripts/git-hooks/pre-commit","packages/locale/locales/*/*.po"]
triggers: ["lingui:check","lingui extract"]
```

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

## Turbo typecheck/test runs can regenerate `@carbon/database` artifacts as ride-along churn

```scope
id: turbo-typecheck-test-runs-can-regenerate-carbon-database-art
paths: ["packages/database/src/types.ts","packages/database/src/swagger-docs-schema.ts"]
triggers: ["turbo run","generate:types"]
```

**Context:** Running `pnpm exec turbo run typecheck --filter=erp` and `turbo run test --filter=@carbon/jobs` to verify unrelated changes (notification filter, invite-link fix).

**Problem:** Turbo builds dependency packages first, and a `@carbon/database` build step regenerated `src/types.ts` (nondeterministic FK-relationship ordering) and `src/swagger-docs-schema.ts` — neither of which the task touched. Committing them would mix generated-file drift into an unrelated PR; the drift can also reflect whatever local DB happens to be running, not migrations.

**Rule:** After any turbo run, check `git status` for modified generated files under `packages/database/` before committing. If you didn't intentionally run `pnpm run generate:types`, revert them (`git checkout -- packages/database/src/...`). Regenerate deliberately and separately when schema actually changed. A branch that adds migrations commits the regenerated `types.ts` and `swagger-docs-schema.ts`: the Database types CI job (`.github/workflows/database-types.yml`) fails when either lags the migrations, so never revert a swagger diff that traces to a migration.

**Applies to:** `packages/database/src/types.ts`, `packages/database/src/swagger-docs-schema.ts`; any branch running turbo tasks that build `@carbon/database`.

## Two sessions in one worktree share every uncommitted file

```scope
id: two-sessions-in-one-worktree-share-every-uncommitted-file
paths: []
triggers: ["git stash","git checkout --","git reset --hard"]
```

**Context:** Two parallel sessions worked in the same Conductor worktree: one on contracts Phase B, one on hardening the period runs. Both edited `accounting.server.ts`, `propose-revenue-recognition-run/index.ts` and the accounting `AGENTS.md`.

**Problem:** Each session's uncommitted edits sat in the same files as the other's. Neither could commit a file whole, so every commit needed hunk-level staging, and a doc written by one session described the other's half-finished code.

**Rule:** Before a task, run `git status` and treat any change you did not make as foreign: stage only your own hunks and never stash, reset or check out over them. For a long task, ask for an isolated worktree (`isolation: "worktree"`) instead of sharing one.

**Applies to:** Any session that starts in a worktree with uncommitted changes; parallel agents dispatched into the same checkout.

## Vercel's route limit counts dynamic routes twice

```scope
id: vercel-s-route-limit-counts-dynamic-routes-twice
paths: ["apps/*/react-router.config.ts"]
triggers: ["routeIdToServerBundleId"]
```

**Context:** The ERP deploy failed with "Maximum number of routes (rewrites, redirects, etc)
exceeded. Max is 2048, received 2074" after a merge added 151 route files. The local build
passes, because the count happens in `@vercel/remix-builder` on Vercel's side.

**Problem:** The builder adds two routes for each addressable dynamic route (the page and its
`.data`) and none for a static one. 1029 dynamic routes cost 2058, and 16 more are fixed
overhead, so the ceiling was about 1016 dynamic routes. Merging route files would only have
delayed the failure.

**Rule:** All of those routes point at one function that matches on the request URL, so the
ERP's preset removes them from `routeIdToServerBundleId` and they reach the function through the
builder's `/(.*)` fallback. Do not remove that step to "tidy" `react-router.config.ts`. A route
that exports `config` gets its own bundle and keeps its routes, and each one still counts.

**Applies to:** `apps/erp/react-router.config.ts`, and MES or another app if it nears 1016
dynamic routes.

## Vite plugin wrappers preserve the caller's type

```scope
id: vite-plugin-wrappers-preserve-the-caller-s-type
paths: ["apps/mes/vitest.config.ts"]
triggers: ["Plugin[]","PluginOption"]
```

**Context:** Adding an ERP dependency refreshed pnpm peer resolutions, and CI then typechecked the MES Vitest config.

**Problem:** The helper declared its input and output as `Plugin[]` from its own `vite` import. On a clean Linux install, Lingui supplied `Plugin[]` from a different Vite peer instance. Vite's private type members made the two declarations incompatible even though the hooks work the same way.

**Rule:** A wrapper that only changes a plugin hook should infer and return the caller's plugin type. Cast locally only to inspect the hook shape; do not force another Vite instance's `Plugin[]` at the function boundary.

**Applies to:** Vitest and Vite plugin wrappers such as `apps/mes/vitest.config.ts`.

## A blanket symbol rename re-homes family-neutral code into one family

```scope
id: a-blanket-symbol-rename-re-homes-family-neutral-code-into-on
paths: ["packages/utils/src/rules.ts","packages/utils/src/rule-filters.ts","packages/ee/src/rules/**"]
triggers: ["ItemFilter","ruleAppliesToItem","SalesRule"]
```

**Context:** Renaming the "Item Rules" feature to "Sales Rules" was done with a repo-wide `ItemRule` → `SalesRule` string sweep. It also caught the shared item-scoping filter in `packages/utils` (today `ItemFilter` / `toItemFilter` in `rule-filters.ts`), where "Item" meant *the item being filtered*, not the feature. The result was a `SalesRule`-named normalizer, imported by the **storage** evaluator, with a docstring still reading "Normalize a raw `storageRule` row". Nothing failed: types, tests, and lint were all green, because a wrong name is not a type error.

**Problem:** A string-match rename cannot distinguish "the feature named X" from "the noun X used as a domain word". Shared code is exactly where the two collide, and the damage is invisible to every automated gate — it only shows up when the next reader trusts the name.

**Rule:** Before a blanket rename, list the symbols that will match and check each one's *consumers*, not just its definition: a symbol used by more than one feature is shared and must get a family-neutral name (`ItemFilter`, not `SalesRuleFilter`), not the new feature's name. After the sweep, grep the renamed symbols inside the OTHER feature's directories — a hit there is the tell. Docstrings and comments are part of the rename: a comment that contradicts its symbol's new name is proof the rename was mechanical.

**Applies to:** `packages/utils/src/rules.ts`, `packages/utils/src/rule-filters.ts`, `packages/ee/src/rules/**`, any repo-wide identifier rename.

## A docs heading is read by the in-app agent, and its length counts against a budget

```scope
id: a-docs-heading-is-read-by-the-in-app-agent-and-its-length-co
paths: ["docs/content/docs/**","apps/erp/app/modules/agent/agent.kb.ts","apps/erp/app/modules/agent/agent.kb.test.ts"]
triggers: ["READ_BUDGET","read_doc"]
```

**Context:** Adding a billing cycle to rental agreements lengthened two troubleshooting headings in `docs/content/docs/reference/rental-agreements.mdx`, each quoting every variant of an error message.

**Problem:** The in-app agent's `read_doc` returns a long page as its intro plus a link per section, and `agent.kb.test.ts` caps every page and section read at `READ_BUDGET` (16,000 characters). Each heading appears twice in that list, as text and inside its anchor URL. About 1,400 characters of heading growth pushed the page over the cap and failed the ERP test suite, far from the docs package.

**Rule:** Keep a troubleshooting heading to one message. Use `…` for the part that varies and list the variants in the body. After you edit a long reference page, run `apps/erp/app/modules/agent/agent.kb.test.ts` as well as the docs checks.

**Applies to:** `docs/content/docs/**`, `apps/erp/app/modules/agent/agent.kb.ts`.

## A dynamic `.server` import fails the client build too

```scope
id: a-dynamic-server-import-fails-the-client-build-too
paths: ["apps/mes/app/services/*.service.ts"]
triggers: ["await import(","internal-call"]
```

**Context:** The MES services that call the ERP (`operations.service.ts`, `inventory.service.ts`) are also imported by client components, for their client-safe functions. The signing helper they need uses `node:crypto`.

**Problem:** React Router's `react-router:dot-server` plugin checks every `resolveId` in the client build, static and dynamic. Moving a `.server` module behind `await import(…)` does not hide it. The production build still refuses it, and typecheck and the dev server do not show the error.

**Rule:** A helper that a client-graph module must load is not named `.server`. Give it a plain name (`@carbon/api/internal-call`). Load it lazily with `await import(…)` inside the server function, so the browser never evaluates it. Prove it with the production build of the app.

**Applies to:** `apps/mes/app/services/*.service.ts`, `apps/erp/app/modules/*/*.service.ts`, any package subpath they import.

## A git hook exports GIT_DIR, so any git run from a subdirectory gets the wrong work tree

```scope
id: a-git-hook-exports-git-dir-so-any-git-run-from-a-subdirector
paths: ["packages/jobs/src/scripts/check-backups.ts","scripts/generate-mcp.ts","scripts/git-hooks/**"]
triggers: ["GIT_DIR","git add","GIT_WORK_TREE"]
```

**Context:** The pre-commit backup check (`packages/jobs/src/scripts/check-backups.ts`,
reached through `pnpm --filter @carbon/jobs`, so its cwd is `packages/jobs`) regenerates
`packages/jobs/manifests/schema.json` and stages it with `git add <absolute path>`.

**Problem:** Run by hand it staged the right path. Under the hook it ALSO indexed the
same content as a root-level `manifests/schema.json` on every migration commit — a
6,994-line file that existed nowhere on disk, resurfacing after each `git rm --cached`.
Git runs hooks with `GIT_DIR` exported and no `GIT_WORK_TREE`; with `GIT_DIR` set, git
treats the CURRENT directory as the work-tree root, so an absolute path under
`packages/jobs` was recorded relative to `packages/jobs`. An absolute path does not
protect you: the index path is computed from the assumed work tree, not from cwd.

**Rule:** Any script a git hook may invoke must run its git commands from the
repository root (`cwd: REPO_ROOT` derived from `import.meta.dirname`, or `git -C`),
never from the package `pnpm --filter` dropped it in. Verify a hook-driven `git add`
by reading `git show --stat HEAD` after the commit, not by running the script by hand.

**Applies to:** `check-backups.ts`, `scripts/generate-mcp.ts`'s digest staging, the
lingui staging in `scripts/git-hooks/pre-commit`, and any future hook step that writes and stages
a generated file from inside a workspace package.

## A limiter must hand a freed slot to the next waiter, not decrement and let it race

```scope
id: a-limiter-must-hand-a-freed-slot-to-the-next-waiter-not-decr
paths: ["packages/utils/src/async.ts"]
triggers: ["async.limit","semaphore","Semaphore"]
```

**Context:** `async.limit` first released a slot by decrementing the active count and waking the first queued call.

**Problem:** The woken call resumes a microtask later. A call made in between saw a free slot, took it, and the woken call then incremented too: more than `concurrency` ran at once, and under steady load a queued call could be overtaken indefinitely.

**Rule:** When a slot frees and a call is queued, pass the slot to it directly and leave the count unchanged; decrement only when the queue is empty. A queued call never increments. Test it by starting a new call in the same tick a running one finishes and asserting the queued one runs first.

**Applies to:** `packages/utils/src/async.ts` (`limit`), any hand-written semaphore.

## A new package `exports` subpath 500s until every running dev server restarts

```scope
id: a-new-package-exports-subpath-500s-until-every-running-dev-s
paths: ["packages/*/package.json"]
triggers: []
```

**Context:** Adding `@carbon/logger/context.server` and `@carbon/auth/request-scope` during the same perf work.

**Problem:** Vite resolves a package's `exports` map once at dev-server start. Adding a subpath and importing it immediately produced `"./context.server" is not exported under the conditions [...]` on every route — a hard 500 across the whole app, twice, each time looking like a code bug rather than a stale resolver. Typecheck was green throughout, since TypeScript reads the updated `package.json` directly.

**Rule:** Adding an export subpath to a workspace package is a dev-server-restart change. Either restart every running dev server as part of the change, or re-export the new module from an already-exported entry point and leave a TODO to move it at the next coordinated restart. A green typecheck does not mean the running server can resolve the import.

**Applies to:** `packages/*/package.json` `exports`, and any new `src/*.server.ts` intended for cross-package import.

## A word-boundary rename corrupts UI copy that typecheck and tests can't see

```scope
id: a-word-boundary-rename-corrupts-ui-copy-that-typecheck-and-t
paths: ["apps/erp/app/modules/*/ui/*/*Table.tsx","apps/erp/app/modules/*/types.ts"]
triggers: ["PartListItem","MaterialListItem","ToolListItem"]
```

**Context:** Splitting ERP list types into `X` (full view row, for detail screens) and `XListItem` (the narrowed list select) on `sid/perf-audit-hot-paths`. Applied with a regex renaming the whole-word alias across each table component.

**Problem:** `Part`, `Material`, `Tool`, `Consumable`, `Service` are single words that appear in **user-visible strings** as well as type positions. The rename produced ``t`PartListItem ID` ``, `<Trans>Delete PartListItem</Trans>`, and a button reading "Add PartListItem" — 20 occurrences across five files. Typecheck passed, 268 unit tests passed, all ten narrowed selects returned 206 from PostgREST, and `EXPLAIN` looked right. Only loading the page caught it. (The five multi-word aliases — `PurchaseOrder`, `SalesOrder`, … — were untouched, because their display text contains a space.)

**Rule:** After any mechanical rename of an identifier that is also an English word, grep for the new name inside string literals, template literals and JSX text (``t`…` ``, `<Trans>…</Trans>`, `"…"`) before committing — and load one affected screen. Type-level green says nothing about copy. Prefer renaming with an editor's symbol-aware rename over a regex; when a regex is the only option, exclude string/JSX regions explicitly.

**Applies to:** `apps/erp/app/modules/*/ui/*/*Table.tsx`, `apps/erp/app/modules/*/types.ts`; any bulk identifier rename in files containing Lingui macros.

## An `isolation: "worktree"` subagent forks from `main`, not the parent's current branch

```scope
id: an-isolation-worktree-subagent-forks-from-main-not-the-paren
paths: []
triggers: ["isolation: \"worktree\"","git merge-base"]
```

**Context:** Dispatching three `Agent` subagents with `isolation: "worktree"` to run `/feature` autonomously for NIST items, each told it was "forked from branch `nist-800-110-audit`" and building on code that lives ONLY on that branch (`packages/auth/src/services/auth-events.server.ts` etc., absent from `main`).

**Problem:** The worktree the Agent tool creates forks from the repo's default (`main`), NOT the parent session's current branch HEAD. A subagent that trusts the "you are on <branch>" framing is actually on a `main`-based commit missing all the branch's work. Two of three agents noticed (the referenced file was absent at HEAD) and re-branched from `origin/nist-800-110-audit`; the third did not — it **vendored a duplicate** of the branch-only `auth-events.server.ts`, and its PR branch dragged in ~70 files of `main`-only work plus the duplicate, so the PR was unmergeable and had to be rebuilt by hand.

**Rule:** When an agent's task depends on unmerged branch code, do not assume the worktree is based on that branch. In the dispatch prompt, require the agent to `git fetch origin` and explicitly branch from `origin/<intended-base>`, set the PR `--base` to it, and **verify the base before writing code** (confirm a known branch-only file exists at HEAD; STOP and report if it is missing rather than recreating/vendoring it). When a delivered branch looks wrong, check `git merge-base <base> <deliveredBranch>` against the base HEAD — a merge-base far back means it forked from the wrong place. To salvage a mis-based branch, extract only its real new files onto a fresh branch off the correct base (don't cherry-pick its whole divergent history).

**Applies to:** any `Agent` call with `isolation: "worktree"` whose work builds on unmerged branch state; PR base selection for agent-produced branches.

## `apps/erp` targets ES2019, so a package it compiles cannot use BigInt literals

```scope
id: apps-erp-targets-es2019-so-packages-workflows-cannot-use-big
paths: ["packages/ee/src/workflows/**","packages/workflows-core/src/**"]
triggers: ["BigInt"]
```

**Context:** The workflow engine needed a stable 64-bit hash for batch item keys,
and the plan specified FNV-1a via `BigInt`.

**Problem:** `apps/erp/tsconfig.json` sets `"target": "ES2019"` and compiles
workspace package **source**, not built output. A `0xcbf29ce484222325n` literal
fails the erp typecheck with TS2737 even though the package's own
`tsc --noEmit` passes — the shared base config targets `esnext`.

**Rule:** Anything in a package `apps/erp` imports must be ES2019-safe, not only
`packages/ee/src/workflows`. Always run `pnpm exec turbo run typecheck --filter=erp`
after touching a shared package — the package's own typecheck is not the binding
constraint. The rest is in `.claude/rules/workflow-engine.md`.

**Applies to:** every `packages/*` that `apps/erp` imports.

## Biome drops quotes from valid identifier keys, so a drift check that greps for `"key":` misses them

```scope
id: biome-drops-quotes-from-valid-identifier-keys-so-a-drift-che
paths: ["scripts/check-workflow-catalog.ts"]
triggers: [".generated.ts"]
```

**Context:** `scripts/check-workflow-catalog.ts` verifies the committed generated
catalogue matches what the generator would produce, partly by grepping the label
file for its keys.

**Problem:** The generator emits `"notify":` but Biome formats the committed file
to `notify:`. A regex anchored on `^ {2}"([^"]+)":` therefore skipped exactly the
keys that happen to be valid JS identifiers — the check passed while genuinely
missing entries.

**Rule:** A check that reads a **formatted** generated file must tolerate the
formatter's output, not the generator's. Make the quotes optional
(`^ {2}"?([^":\s]+)"?:`), or compare parsed data rather than text.

**Applies to:** `scripts/check-workflow-catalog.ts` and any future drift check
that greps a Biome-formatted generated file.

## Committing with the hook off skips Biome too

```scope
id: committing-with-the-hook-off-skips-biome-too
paths: ["scripts/git-hooks/**"]
triggers: ["core.hooksPath","--no-verify"]
```

**Context:** The chart of accounts import (2026-10-12) committed with `git -c core.hooksPath=/dev/null` so the Lingui catalogs, which the hook stages into any commit with `.ts` changes, could land in their own commit.

**Problem:** The hook also runs lint-staged. Bypassing it skipped Biome's formatter, and a test file reached the branch unformatted. The self-review caught it, not the commit.

**Rule:** Before a commit with the hook off, run `pnpm biome check --write` on the staged files and the checks the hook would run (`pnpm --silent check:manifest`, `pnpm --silent db:check:datasets` for `packages/database`, `pnpm --silent db:check:backups` for migrations). Prefer committing the catalogs last with the hook on.

**Applies to:** any commit made with `--no-verify` or `core.hooksPath=/dev/null`.

## `db:seed:dev` under portless needs the local CA, and a hibernated stack

```scope
id: db-seed-dev-under-portless-needs-the-local-ca-and-a-hibernat
paths: ["packages/database/src/seed-dev.ts","packages/dev/src/services/apps.ts"]
triggers: ["NODE_EXTRA_CA_CERTS","db:seed:dev","SELF_SIGNED_CERT_IN_CHAIN"]
```

**Context:** Seeding a dataset on a portless stack (`https://api.<prefix>.dev`).

**Problem:** `pnpm db:seed:dev` failed with "Failed to create user: fetch failed". Two causes stacked: the portless certificate, and a hibernated stack (gotrue and the API gateway were exited, `crbn status` shows "hibernated"). `curl` worked, so the cause was not plain to see.

**Rule:** Before a script that calls the local Supabase API over portless, wake the stack (one request to the ERP URL). The rest is in `.claude/rules/onboarding-company-templates.md`.

**Applies to:** `pnpm db:seed:dev`, and any `tsx` script that calls `SUPABASE_URL` on a portless stack.

## Dual-major deps of workspace source packages crash the SSR bundle when the shared dep is externalized

```scope
id: dual-major-deps-of-workspace-source-packages-crash-the-ssr-b
paths: ["apps/erp/vite.config.ts","apps/mes/vite.config.ts","packages/viewer/package.json"]
triggers: ["noExternal","zustand","@react-three/fiber"]
```

**Context:** Merging assembly instructions (#1075) added `@carbon/viewer` (a source-only workspace package) with `@react-three/fiber@8`, whose ESM dist does `import create from 'zustand'` against its own nested zustand v3. The app + `@react-three/drei` use the catalog zustand v5, which removed the default export.

**Problem:** Production (app.carbon.ms) 500'd on every request while builds stayed green. Vite/rolldown inlines deps of linked workspace packages into the SSR bundle but externalizes packages resolvable from the app root **by package name**, merging fiber's v3 default import with v5 named imports into one `import ste,{create,...}from"zustand"` in `build/server/index.js`. Node resolves that to v5 at runtime → `SyntaxError: The requested module 'zustand' does not provide an export named 'default'` at `ModuleJob._instantiate` — before any code runs, so the error never reaches error reporting, dev SSR never reproduces it (per-importer resolution), and Vercel previews show READY (crash is invocation-time). The runtime log dumps a random window of the minified bundle (logtape's timezone formatter), which reads like an Intl/timezone error — red herring.

**Rule:** When a dep of a workspace source package pins a different major of a package the app also depends on, add that package to `ssr.noExternal` in the consuming apps' `vite.config.ts` so each importer keeps its own inlined copy. Verify with a build + `grep -E "from *[\"']zustand" build/server/**` (expect no bare imports) and `node --input-type=module -e "await import('.../build/server/index.js')"` — reaching an env-var error proves linking succeeded. For any all-requests-500 Vercel incident with a minified source dump, read the **last** lines for the real error and check `node:internal/modules/esm/module_job` in the stack before believing anything the dumped source suggests.

**Applies to:** `apps/erp/vite.config.ts`, `apps/mes/vite.config.ts` `ssr.noExternal`; any new dep of `@carbon/viewer` or other source-only workspace packages (`@carbon/form`, `@carbon/onboarding`, ...) that pins an older major of a shared package.

## ioredis retryStrategy returning null kills auto-recovery

```scope
id: ioredis-retrystrategy-returning-null-kills-auto-recovery
paths: ["packages/kv/src/client.ts","packages/kv/src/resilient.ts"]
triggers: ["retryStrategy","ioredis"]
```

**Context:** Making the Redis client (`@carbon/kv`) resilient to outages (issue #1076).

**Problem:** A `retryStrategy` that returns `null` after N attempts stops reconnection for good, and the app never recovers without a restart. Unit tests with `ioredis-mock` do NOT catch it — only a real kill-and-restart test does.

**Rule:** Verify a change to the Redis connection config by stopping and restarting a real Redis, not with mocks. The rest is in `.claude/rules/dev-shared-redis.md`.

**Applies to:** `packages/kv/src/client.ts`, `packages/kv/src/resilient.ts`, any ioredis client config.

## Measure completed typechecks before claiming a speedup

```scope
id: measure-completed-typechecks-before-claiming-a-speedup
paths: ["apps/erp/tsconfig.json","turbo.json","apps/erp/turbo.json"]
triggers: ["tsBuildInfoFile","\"incremental\""]
```

**Context:** The ERP typecheck speed investigation first produced an incremental
configuration and several bounded checks, but no completed before/after run.

**Problem:** A cache configuration looked promising, yet a cold check and edits
to large query-heavy services could still take minutes. Reporting the config
change as a speedup before measuring those cases obscured the remaining cost.

**Rule:** Complete and time a cold check, an unchanged rerun, and a representative
changed-file check before claiming a typecheck improvement. Report those cases
separately and keep Turbo cache hits distinct from TypeScript incremental runs.

**Applies to:** ERP typecheck performance work and other cached validation tasks.

## On carbon-shared, a shared service's bare name answers in every worktree

```scope
id: on-carbon-shared-a-shared-service-s-bare-name-answers-in-eve
paths: ["packages/dev/docker/envoy/cds.template.yaml","packages/dev/docker/docker-compose.dev.yml"]
triggers: ["carbon-shared","local-edge-runtime","container_name"]
```

**Context:** Envoy's `functions` cluster listed the worktree's private
`edge-runtime` first and the shared `carbon-edge-runtime` second.

**Problem:** With no private runtime the bare name resolved to the shared one;
with one, Docker happened to answer with the private one only. A test with one
side up showed nothing wrong.

**Rule:** Check a new name with `docker exec <api-gw> getent ahostsv4 <name>`
with and without the other side up. The rest is in
`.claude/rules/dev-shared-services.md`.

**Applies to:** `packages/dev/docker/envoy/cds.template.yaml`,
`packages/dev/docker/docker-compose.dev.yml`, `.claude/rules/dev-shared-services.md`.

## `scripts/one-off/` is a registry, not a folder of leftovers

```scope
id: scripts-one-off-is-a-registry-not-a-folder-of-leftovers
paths: ["scripts/one-off/**","ci/src/one-off-scripts.ts"]
triggers: ["readdirSync"]
```

**Context:** A cleanup pass listed a script in `scripts/one-off/` as dead because nothing referenced it by name.

**Problem:** `ci/src/one-off-scripts.ts` runs every `.ts` file in that folder once per database on deploy; the folder IS the reference. Deleting a file there changes what the next deploy does.

**Rule:** "No grep hits" does not mean dead. Before deleting a script, check whether its directory is enumerated (`readdirSync`, a glob in a workflow or `turbo.json`).

**Applies to:** `scripts/one-off/`, `ci/src/one-off-scripts.ts`, any repo cleanup.

## The license-header fixer only sees files git tracks

```scope
id: the-license-header-fixer-only-sees-files-git-tracks
paths: ["packages/checks/src/sources/license-files.ts"]
triggers: ["license-headers"]
```

**Context:** `pnpm --filter @carbon/checks license-headers -- <paths>` writes the SPDX header. It walks `git ls-files --cached`. In the multi-jurisdiction tax work (2026-10-17), two new files were committed with no SPDX header, although the fixer had run before each commit.

**Problem:** A new, untracked file is not in that list, so the fixer reports "0 fixed" and the file keeps no header until the `spdx-license-header` check fails at commit. Or the conformance test fails later, on someone else's run.

**Rule:** Run `git add -N <new files>` (intent to add; it records no content) or `git add` before the fixer, then run the fixer with those paths. Stage the file again after the fixer writes the header.

**Applies to:** every new source file outside generated output, and `packages/checks/src/sources/license-files.ts`.

## The manifest-digest hook checks the working tree, not the staged copy

```scope
id: the-manifest-digest-hook-checks-the-working-tree-not-the-sta
paths: ["apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json","scripts/git-hooks/pre-commit"]
triggers: ["check:manifest","tool-manifest.digest"]
```

**Context:** The trial balance PR (2026-10-13) left `tool-manifest.digest.json` out of a commit, thinking its diff was unrelated drift.

**Problem:** `check:manifest` regenerates the digest and compares it with the file on disk. The disk copy was the regenerated one, so the hook passed while the commit carried the stale digest. Only running the check against the committed version showed "2 changed".

**Rule:** Never leave a regenerated `tool-manifest.digest.json` unstaged on the assumption that it is drift. Run `pnpm --silent check:manifest` with the committed copy restored; when it fails, the regenerated digest belongs in the commit.

**Applies to:** `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`, `scripts/git-hooks/pre-commit`.

## Parallel agents on one rule need the shared helper first

```scope
id: parallel-agents-on-one-rule-need-the-shared-helper-first
paths: [".claude/skills/conductor/**", ".claude/skills/execute/**"]
triggers: ["subagent", "Agent tool"]
```

**Context:** One PR fixed eight stock-out paths with five parallel subagents. The draw rule had a shared helper before the fan-out, and every agent used it. The return rule ("back to the bins the issues drew from") and the shipment line bin chooser had no helper, so the agents wrote the return rule three times and made a near copy of the chooser. The copies already differed: one broke ties by `entryNumber` and the others did not.

**Problem:** A subagent sees only its own path and writes the rule inline. Nobody compares the copies until review, and by then they have drifted apart.

**Rule:** Before fanning out work that applies one rule in several places, list every rule the paths share (draw, return, line bin, refusal message). Write each rule as a pure tested helper first, and name it in every agent's brief. Review the agents' diffs side by side for logic that repeats. Also check the small edits each agent made:
- A new helper inserted between a function and its doc comment moves the comment onto the wrong function.
- Two arrays matched by position silently break when someone adds a row; have each entry hold its own row instead.
- A scripted multi-site edit can corrupt brackets; run the typecheck right after it.

**Applies to:** Multi-path fixes run through the Agent tool or `/conductor`.
