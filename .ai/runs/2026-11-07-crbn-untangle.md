# crbn untangle — decision log

Scope: packages/dev (crbn CLI + docker) and the repo-level dev setup.
Extras chosen: Comments, Tests. Branch: refactor/crbn-untangle.

## Raw findings
- Own: down.ts writes every teardown step twice (tasks UI + runPlain for post-SIGINT).
- Own: Ctx (root, slug, ports, mode, database, db, hosts, jwt) exists only in up.ts; every other command re-derives it from getWorktreeRoot/resolveSlug/getSlot/recordedStackMode/stackDatabase/stackPorts/projectName.
- Compose/DB reviewer: topology facts copied across TS/yml/envoy/edge-main/restore script; DB pipeline (migrate→config row→types→authz→cron) copied 4x (up, migrate x2, restore); mode guessed 3 ways; anon key from 3 sources; legacy compose fallback; unused exports volumePgMajor, SHARED_NETWORK, sharedDir, ISOLATED_SHARED_SERVICES, PRIVATE_HOSTS, ensureTemplate(export); compose imports shared-db for ensureTemplate; createWorktreeDatabase order dependency on template; applyMigrations knows shared mode (syncWorktreeCron); destroyProjectVolumes passes project as slug; restartServices swallow; repairStaleMigrations N queries; stale comments dev.yml:4,16, migrate.ts:58,110, restore.ts:133.
- Apps/portless/hibernate reviewer: app registry spread over 7 tables (APP_CHOICES, APP_COLORS, APP_PORT_KEYS, APP_URL_ENV_KEYS, up.ts APP_PORT_KEY, aliasMap, killOrphanedApps list; reactRouterApps deny-list); TLD copied (PORTLESS_TLD, env.ts literals); STABLE_OAUTH_ALIAS vs env.ts api.carbon.dev; alias hostname built 4 ways; vite.js↔hibernate.ts state files/marker/timeout contract unwritten (vite ignores pid → 120s hold on stale marker); ~/.portless built 8x; ~/.carbon paths spread; portless alias calls run parallel despite routes-file race; execa portless option block x7; portless.ts imports prompts/ui; deep wake under portless still 502 (waker vs boot page = 2 mechanisms); detectPrivilegeIssues array of ≤1; removeAliases/pruneStaleRoutes omit cwd/preferLocal; lineWriter pipe x3; onShutdown(stopAuxApps) per spawn; ALIAS_SERVICES dead; vite.d.ts internal exports; setupPortless unused param; erp/mes vite carbon() blocks identical.
- Lifecycle reviewer: BUG main.ts:155 always passes portless → CARBON_PORTLESS=0 dead for CLI; APP_PORT_KEY copy; holdAppAliases after registerAliases order; reactRouterApps deny-list + per-app ifs up.ts:234,251,260,268,314,318,364; process.env.CRBN_STACK_STATE global; localhost ports 54321/3000/3001 x3; down re-derives branchPrefix from current branch (wrong after branch switch); down "could not" string protocol; down twice (tasks/runPlain) with diverging error handling; repo-base strip rule x4 (bash/TS disagree); worktree creation bash checkout vs new.ts; bash print_help copies citty; NODE_MIN copies engines; flags declared 3-4x; ctx `let ctx!` + freshDatabase task-order coupling; runAppsThenTeardown never stopAuxApps; reset→up, up→down command imports (migrate --force → interactive up); reset orphan cleanup weaker prune; hibernation state machine inline in up.ts; anon {ports,redisDb,jwt} type; pass-through wrappers refreshStaleCopyFiles/ensureDepsInstalled/ensureSkillsInstalled/seedSmokeTestUser; killStripe copies stopAuxApps; typeof redisDb checks dead; 3 poll-port loops; NaN hibernate; box() catch.
- Repo-setup reviewer: root scripts call `crbn` with no @carbon/dev dep (PATH-only); README Node 22 vs floor 24.22.1 in 5 places; docs omit cp .env.example; ports copied into README/docs/jobs; seed.ts cwd-relative .env.local relies on symlink; restore-database.sh reads registry/mode directly (raw path ===); ~/.portless/ca.pem x3; setup.sh plist TLD; setup.sh duplicates portless install (npm -g fallback); 4 env loaders 3 precedences; db:types == generate:types; turbo db:types/db:migrate/db:init dead; --filter=./packages/ matches nothing (dev:academy/dev:starter); app `dev` portless scripts duplicate boot path; dev:jobs stale; stale comments local-script-config.ts:10, setup-env-files.ts:55; setup-env-files dangling symlink exits 0; pre-commit gates exit 0 silently; setup.sh `|| true`; restore `|| echo 0`; .env.example placeholder secrets; install-skills run from 3 places.
- Core reviewer: teardown in 4 sequences on 3 primitives (down tasks, down runPlain, remove, prune) — disagree on containers (stopStack/destroyProjectVolumes/destroyProject), wt_ drop (throw/warn/ignore/own loop), stripe, aliases, portless.json, hibernation dir leaked by removeSlot rmdir; slugify x3 (worktree, branchToPrefix inline, bash); repo-base strip x3; ~/.carbon/stacks x2; REGISTRY_PATH at import vs others lazy; connection string x4; ui `?? "postgres"`; env.ts mode default isolated vs readStackMode shared; env.ts container names; ISOLATED_VOLUMES copies yml; "could not" prefix; prune tryConnect(SHARED_DB_PORT); prompts rely on caller requireTerminal; git.ts current: path===cwd raw (remove offers current worktree from subdir); optInApps second list; ensureSlugAvailable runs docker in worktree.ts; prune raw docker calls; pickBorrowSlug knows registry file; ALIAS_SERVICES/CRBN_NEW_TARGET/MAX_PENDING_OUTPUT export dead; list Promise.resolve; main/reload both filter `-` args; 4 confirmX copies + remove re-inlines abort; INVALID_BRANCH_RE vs git check-ref-format; envSync duplicates syncStaleCopyFiles (uses cwd, no mkdir); BUG git.removeWorktree rm -rf regardless of force; typeof redisDb dead; branchPrefix? not enforced; confirmPrune defaults unused; prompts hint `crbn go` (doesn't exist); ".env from current worktree" wording wrong.

## Fixes (each above the problems it solves)

1. **One `Stack` for a worktree** (`src/stack.ts`): `openStack(root)` resolves root, slug, project, mode (recorded ?? shared), slot, effective ports, database, db target, connection URL, hosts, branch prefix, state paths — once. Every command takes it instead of re-deriving.
   - Ctx exists only in up.ts; down/migrate/restore/status/list/reset/reload/prune/remove re-derive slug/slot/mode/db/project.
   - mode guessed 3 ways (mode file, .env.local SUPABASE_DB_URL, `modeOf` "database is postgres"); migrate writes the mode file from the guess.
   - anon key from 3 sources (env, readDevJwt, ctx.jwt) — migrate skips config row when env unset.
   - connection string built 4x; ui re-derives `?? "postgres"`.
   - `~/.carbon/...` paths built in worktree, hibernate, compose, portless (REGISTRY_PATH frozen at import) → one `carbonHome()` path table.
   - env.ts mode default "isolated" vs readStackMode default "shared".
   - migrate.ts / restore.ts each load .env.local + .env + requireNumberEnv("PORT_DB").
2. **One teardown** (`teardownStack(stack, {volumes, purge})`, a step list run by `tasks()`; `tasks()` prints plain lines when not interactive/silent). down, remove, prune (per dead slug), up's interrupt and --run all call it. Removal uses the label-based `destroyProject` (no compose files or .env.local needed). `removeSlot` removes the whole `~/.carbon/stacks/<slug>` dir. `dropWorktreeData` returns/throws; no message-prefix protocol.
   - down.ts tasks vs runPlain copy (already behave differently on a failed drop).
   - remove/prune/down disagree on containers, wt_ drop, stripe, aliases, portless.json; destroyProjectVolumes swallows errors and needs .env.local; prune re-implements dropWorktreeData.
   - `msg.startsWith("could not")` string protocol (down.ts:68,147).
   - hibernation state dir leaked by every teardown.
   - up.ts imports down; reset re-implements a weaker prune for orphans.
   - runAppsThenTeardown never calls stopAuxApps; killStripe copies stopAuxApps' kill fallback.
   - `typeof redisDb === "number"` dead checks (down x2, reset, remove).
3. **One app registry** (`APPS` in constants.ts): id, label, hint, kind (react-router | process | service), port key, URL env key, color, opt-in.
   - APP_CHOICES, APP_COLORS, APP_PORT_KEYS, APP_URL_ENV_KEYS, up.ts APP_PORT_KEY copy, aliasMap app part, killOrphanedApps port list, prompts optInApps.
   - `reactRouterApps` deny-list; `every(id => id === "studio")` services-only special case; per-app ifs in up.ts.
4. **One portless adapter + one host builder** in portless.ts: `runPortless(args)` (serialized, one env/binary rule), `portlessDir()` honouring PORTLESS_STATE_DIR, `appHost(name, prefix)` and TLD used by env.ts, ui.ts, up.ts; OAuth alias constant shared with env.ts.
   - PORTLESS_TLD copies TLD; `.dev` literals in env.ts; STABLE_OAUTH_ALIAS vs env.ts `api.carbon.dev`; stale "render-env.ts" comments.
   - alias hostname built 4 ways; holdAppAliases rebuilds names; aliasMap used with `{} as PortMap` for names.
   - execa portless block x7; removeAliases/pruneStaleRoutes skip cwd/preferLocal; parallel alias writes race the routes file.
   - ~/.portless built 8x.
   - holdAppAliases must run after registerAliases → registerAliases skips held app aliases (hold registers them).
5. **One database pipeline** in migrations.ts: `provisionWorktreeData` (template + clone + tenant, so no call-order rule) and `migrateDatabase(stack, {regen})` (migrate → config row → types → authz → cron sync). up, migrate (both paths) and restore call it.
   - migrate → config row → types → authz copied 4x with drift (restore skips config row; standalone skips swagger).
   - createWorktreeDatabase needs ensureTemplate first (only bootSharedServices does it) → compose.ts imports shared-db.
   - create db + register tenant copied (up, migrate).
   - applyMigrations knows shared mode (calls syncWorktreeCron).
6. **One hibernation contract** shared by hibernate.ts and vite.js (plain-JS `stack-state.js`: file names, marker format with pid, hold timeout); one "hold the URL until the app answers" used by first boot and deep wake; the hibernation loop moves from up.ts into hibernate.ts.
   - vite.js re-hardcodes `activity`/`asleep`, ignores the marker pid (stale marker holds 120 s; up.ts deletes it on boot to cover it).
   - 120 s literal in vite.js and wakeIfAsleep.
   - deep wake under portless still shows portless's 502 (waker vs boot page = 2 mechanisms).
   - up.ts 3 separate "poll a port" loops → one `waitUntil`.
   - CRBN_STACK_STATE set as a process global.
7. **One topology table** in compose.ts (container names, shared host ports, volume names, isolated volumes) with a test pinning it against the yml.
   - SHARED_*_PORT in worktree.ts vs shared.yml; REDIS_DB_MAX test checks literal "25"; container names as literals in 4 TS files; ISOLATED_VOLUMES copies isolated.yml; ISOLATED_SHARED_SERVICES == LATER_SHARED_SERVICES.
8. **Delete legacy and dead code.**
   - COMPOSE_DEV_FILE_LEGACY fallback (file moved long ago; compose files mount packages/dev/docker paths anyway).
   - dead: ALIAS_SERVICES, CRBN_NEW_TARGET, volumePgMajor/SHARED_NETWORK/sharedDir/PRIVATE_HOSTS exports, MAX_PENDING_OUTPUT export, setupPortless `_selectedApps`, list.ts Promise.resolve, vite.d.ts internal exports, confirmPrune defaults, one-caller optional params.
   - pass-through wrappers in up.ts (refreshStaleCopyFiles, ensureDepsInstalled, ensureSkillsInstalled, seedSmokeTestUser).
   - repairStaleMigrations deletes one row per query.
9. **Commands only compose services; prompts own the terminal rule.** Every prompt calls requireTerminal itself; one `confirmOrEnv` behind the 4 confirmX.
   - prompts rely on callers calling requireTerminal first; remove.ts re-inlines abort().
   - portless.ts imports prompts/ui (interactive install/update/privilege move to a setup module).
   - worktree.ts shells out to docker (ensureSlugAvailable) → compose.ts; prune's raw docker calls → compose.ts.
10. **Bugs the structure exposed** (fix where they fall):
   - main.ts always passes `portless`, so CARBON_PORTLESS=0 never works from the CLI.
   - git.removeWorktree rm -rf regardless of `force`.
   - git.listWorktrees `current` raw cwd compare (remove offers the worktree you stand in from a subdir).
   - prompts hint `crbn go` (doesn't exist); `.env from current worktree` wording.
   - NaN idle minutes silently disables hibernation.
   - restore-database.sh prints Studio at PORT_DB+2 (Inbucket in shared mode).
11. **bash ↔ TS single sources**: bin/crbn reads the Node floor from package.json engines; its help delegates the TS commands' list to citty; slugify/dir naming pinned by a parity test.
12. **Repo setup**: dead turbo tasks, `--filter=./packages/` matching nothing, duplicate `db:types`/`generate:types`, stale doc names, README Node version, setup-env-files dangling-symlink exit 0.

Kept on purpose (a requirement, not a design gap): registry compatibility with older crbn (jwt copy, optional ports) — other worktrees run older crbn source; deadlock retry in migrations (Supabase CLI); 42P04 race catches; lock busy-wait; removeStandaloneRedis/missingSharedServices (shipped days ago, #2161); slug resolution order (changing it renames stacks).

## Outcome (2026-11-07)

Done: fixes 1–12 above. Second-round review (structure + regression) also fixed:
- Regressions caught and fixed: `--run` lost the erp/mes aliases (now held only outside --run); deep wake's hold saw the waker's own 503 as "up" (`httpResponds` ignores `x-crbn-waking`); `migrate` read registry ports, wrong in localhost/--borrow mode (Stack now takes ports and mode from .env.local when it exists, registry otherwise); stripe exiting ended a no-dev-server run (not watched now); `--run` spawnApps rejection skipped teardown; `up`/`reload` env load now lets the shell win again (`shellWins`).
- `prune` tears dead / --all stacks down through `teardown`; `destroyProject` and `flushDb` throw instead of reporting success; `stopStack` lost its always-false `withVolumes`; `databaseTasks(stack, opts)`; `migrate` no longer persists a guessed mode; `waitForTcp(number[])`; deadline loops → `waitUntil`; `routeAlias`; summary + log prefixes from `ROUTE_STYLE`; `PROJECT_PREFIX`, `SHARED_STORAGE_FILES`, `SHARED_REDIS_IMAGE` pinned; `tailSharedLogs`; hibernation defaults in help; `confirmDestructive` exits on no; `worktreePath`; bin/crbn `created`/`enter`.

Kept on purpose:
- `CRBN_NEW_TARGET` (setup.sh's `crbn()` wrapper writes/reads it; a reviewer grepping .ts only called it dead).
- `db:types` and `generate:types` both stay (docs and rules use both names).
- First-time provisioning differs between `migrate` (no borrow/localhost pins) and `up`; sharing it would need both flows' options.
- `crbn checkout -b` defaults base to HEAD, `crbn new --yes` to origin/main — a product choice, not a copy.
- `down --volumes` does not start crbn-shared to drop the database (as before); the step fails loudly and says to rerun.
- `init`'s `quiet` option (used by `new`).
Behavior changes to know: `down --volumes` now also flushes the worktree's redis db; `reset` keeps the slot and no longer sweeps other worktrees' orphans (`prune` does); `remove` runs one worktree at a time; dev:academy/dev:starter now start the package watchers (their filter matched nothing before).

## Live check (2026-11-07)

`pnpm --filter @carbon/dev smoke` from a throwaway worktree holding this branch's changes, then `up --run`, `down` and `remove` there.
- Caught one regression: the scripted rename left `SHARED_REDIS_IMAGE` inside `sharedComposeArgs`, so every shared compose call failed. Fixed. No unit test covers compose argv; the smoke test does.
- After the fix: all 8 smoke checks pass; `up --run` reaches the gateway and stops the stack and its aliases; `remove` drops the database, flushes redis and releases the slot. The slots, `wt_` databases and crbn routes match the pre-run snapshot.
- Unchanged by design: the shared `api.carbon.dev` alias keeps the last `crbn up`'s port after teardown.
