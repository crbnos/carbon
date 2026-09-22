# EE vs CE Licensing Cleanup

Branch: `ee-vs-ce-cleanup`
Started: 2026-09-21
Owner: Brad (brad@carbonos.dev)

State legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked/needs decision

This plan is the durable state for a large licensing refactor. Update the
checkboxes and the "Session log" as work lands. Each feature is a self-contained
unit; the tree must stay green after each.

Reference: `.claude/rules/commercial-licensing.md` (the pattern), `LICENSE` +
`packages/ee/LICENSE` (the boundary: Enterprise = everything under `packages/ee`
OR any filename containing `.ee.`).

---

## Task 1 — Configurator rules engine → CE  ✅ DONE

The configurator UI was freed in commit b99dd084a7; only the sandbox engine file
was left marked EE.

- [x] `git mv packages/database/supabase/functions/lib/sandbox.ee.ts → sandbox.ts`
- [x] Update importer `packages/database/supabase/functions/get-method/index.ts:33`
- [x] Update doc source `docs/content/docs/reference/configurator.mdx`
- [x] Regenerate agent KB (`pnpm run generate:agent-kb`)
- [x] Verify no `sandbox.ee` references remain

---

## Task 3 — License Section 2 wording  ✅ DONE

- [x] `packages/ee/LICENSE` Section 2 updated to add "…or otherwise without
  making any Enterprise functionality available…"

---

## Task 4 — Material Planning (MRP + scheduler) → CE  ✅ DONE

The engine `packages/ee/src/planning/` was self-contained: zero EE-internal deps,
no entitlement gating. Depended only on `@carbon/database` subpaths + `@carbon/utils`.

**Decision: new package `packages/planning` (`@carbon/planning`).** Cleanest CE
licensing boundary; no cycle risk. Source-exported `.ts` like `@carbon/ee`.

### Steps
- [x] Created `packages/planning/` (`package.json`, `tsconfig.json` extends
      `base.json`, `vitest.config.ts`). deps: `@carbon/database`, `@carbon/utils`,
      `@internationalized/date`, `@supabase/supabase-js`, `kysely`, `zod`.
      devDeps: `@carbon/config`, `typescript`, `vitest`. (No `@logtape` needed —
      planning reaches logging via `@carbon/database/logging`.)
- [x] `git mv packages/ee/src/planning/{index.ts,mrp,scheduling}` → `packages/planning/src/`
- [x] Removed `"./planning"` export from `packages/ee/package.json`
- [x] Repointed 9 functional import sites → `@carbon/planning` (11 specifiers incl. 3 dynamic + vi.mock)
- [x] Repointed test `$jobId.status.test.ts` (import + vi.mock)
- [x] Added `@carbon/planning: workspace:*` to `packages/jobs` + `apps/erp` package.json
- [x] Updated comment refs in the 7 `@carbon/database` files + `production.mcp.server.ts`
- [x] Created `packages/planning/AGENTS.md`; updated `packages/ee/AGENTS.md`,
      `.claude/rules/{mrp-system,scheduling-data-structures}.md` (paths + mentions),
      `packages/database/AGENTS.md`, `apps/erp/app/modules/production/AGENTS.md`,
      `docs/content/docs/reference/forecast.mdx` (+ regenerated agent KB)
- [x] Verified: `@carbon/planning` typecheck ✓ + 183 tests ✓; `@carbon/jobs`
      typecheck ✓; `erp` typecheck ✓ (after `react-router typegen`)
- [x] `pnpm install` (workspace linked)
- Note: 3 pre-existing biome style warnings in relocated test files (unchanged content).
- Note: MCP `tool-manifest.digest.json` UNCHANGED (planning wasn't an MCP tool source).

---

## Task 2 — Move CE-located commercial engines into `packages/ee`

All five already have `Feature` keys in `packages/ee/src/plan.ts`
(`EMAIL_NOTIFICATIONS`, `MCP`, `BACKUPS`, `WORKFLOWS`, `AUDIT_LOG`) and route/UX
gates. The remaining work per feature: relocate engine body into
`packages/ee/src/<feature>/` and embed `requireEntitlement` (authoring) /
`companyHasFeature` (runtime-degrade). Do them **one at a time, tree green each**.
Order = ascending risk.

### 2a. Audit log  ✅ DONE
Scoping revealed a CLEANER move than originally planned: only the ENGINE
(`audit.ts`) moves; `audit.config.ts` + `audit.types.ts` STAY in `@carbon/database`
(client-graph members holding generic schema types `TableName`/`ColumnOf` consumed
by CE packages `@carbon/workflows`, `@carbon/jobs` — moving them would force
community packages into a commercial dep for no licensing benefit). Cycle-safe:
`@carbon/database` never imports audit internally; all 10 engine importers are apps.
- [x] `git mv packages/database/src/audit.ts` → `packages/ee/src/audit/audit.ts`
- [x] Rewired moved engine's imports: `./audit.config`→`@carbon/database/audit.config`,
      `./audit.types`→`@carbon/database/audit.types`, `./event`→`@carbon/database/event`
- [x] Embedded `requireEntitlement("AUDIT_LOG")` in `enableAuditLog`, guarded by
      `if (!CONTROLLED_ENVIRONMENT)` (ITAR audit is mandatory; all 3 auto-enable
      call sites are already CONTROLLED_ENVIRONMENT-gated). Left read getters +
      `insertAuditLogEntries` ungated (capture is gated by subscription creation,
      which `enableAuditLog` controls; avoids dropping security-audit events + hot-path cost).
- [x] Removed `"./audit"` from `packages/database/package.json`; added
      `"./audit.server": "./src/audit/audit.ts"` to `packages/ee/package.json`
- [x] Repointed 10 app engine importers `@carbon/database/audit` → `@carbon/ee/audit.server`
      (erp routes + mes itar.service; both apps already depend on `@carbon/ee`)
- [x] Updated `.claude/rules/audit-log-system.md` (paths + wrapper location),
      `commercial-licensing.md` (rollout ✅), `packages/database/AGENTS.md`, `packages/ee/AGENTS.md`
- [x] Verified: `@carbon/ee`, `erp`, `mes`, `@carbon/jobs` all typecheck clean
      (mes/erp after `react-router typegen`). No audit .test.ts to move.

### 2b. MCP  ✅ DONE — protocol engine → `@carbon/ee/mcp` + `@carbon/ee/mcp.server`
Executed via DI (the dispatch is `~/`-bound and can't move): `git mv` server.ts +
catalog-search/describe-format/format-result/instructions/types → `packages/ee/src/mcp/`;
split exports — `@carbon/ee/mcp` (pure barrel `index.ts`, no auth/entitlement chain, for
tests) and `@carbon/ee/mcp.server` (`server.ts`). `createMcpServer` is now generic over
the auth context, takes injected `deps` `{ callOperation, operationsByName, isListOperation,
isMcpBlockedTool, catalogSearch, toolMetadata }`, and embeds `requireEntitlement("MCP")`
(async; route catches `EntitlementError` → 402, replacing the deletable in-route
`companyHasFeature`). `types.ts` `McpContext` redefined structurally (no `~/` import) +
`McpServerDeps`/`McpCallResult`; `instructions.ts` takes the catalog summary as an arg (no
app-JSON import). Route `_index.ts` builds `catalogSearch` once + passes deps; imports
`createCatalogSearch` from `@carbon/ee/mcp`, `createMcpServer` from `@carbon/ee/mcp.server`.
`tool-metadata.json` + `mcp-blocked-tools.ts` + `manifest.ts` + `agent-setup-prompt.ts`
stay in the app. Added ee deps: `@modelcontextprotocol/sdk`, `zbsearch` (runtime),
`@carbon/api` (devDep, type-only). The 3 pure-logic tests stay in-app (real
`tool-metadata.json`) importing from `@carbon/ee/mcp` (pure barrel avoids the glossary/auth
load that broke them under the heavy barrel). Updated `.claude/rules/mcp-tools-reference.md`,
`commercial-licensing.md` (✅), `packages/ee/AGENTS.md`.
Verified: ee + erp typecheck green; **158 MCP tests pass** (49 lib + 109 generator/dispatch).
⚠️ RESIDUAL: `server.ts` is `@ts-nocheck` and the live `POST /api/mcp` endpoint can't be
exercised in this env — needs an endpoint smoke test before merge.

#### (original scoping) ~1k lines; engine in `apps/erp/.../api+/mcp+/`
- [ ] Move the dispatch core (`lib/server.ts` + helpers) into
      `packages/ee/src/mcp/`; keep the thin route in the app calling it.
- [ ] Embed `requireEntitlement("MCP")` in the ee entry (route keeps its
      `companyHasFeature` choke as UX).
- [ ] Watch `generate:mcp` digest: tools ARE the ERP `*.service.ts`; moving the
      dispatcher does not move the tool bodies. Run `pnpm run generate:mcp`,
      review digest diff.
- [ ] Verify.

### 2c. Email notifications  ✅ DONE
Scoping: the lockable seam is just the email-channel DECISION. `sendEmail`
(`@carbon/lib`) is GENERIC transactional transport (invites, MFA, password,
onboarding) — must NOT be gated. `content.ts`, in-app/slack channels, `send-email.ts`
all stay CE.
- [x] Created `packages/ee/src/email-notifications/deliver.server.ts` →
      `emailNotificationsEnabled(client, companyId)` (wraps
      `companyHasFeature("EMAIL_NOTIFICATIONS")`, DEGRADE not throw). Distinct dir
      from the existing `packages/ee/src/email/` integration-config.
- [x] Added `"./email-notifications.server"` export to `packages/ee/package.json`
- [x] Rewired `notify.ts` `check-email-plan` step → `emailNotificationsEnabled`
      (feature key + degrade contract now in commercial code); step id unchanged
- [x] Verified: `@carbon/ee` + `@carbon/jobs` typecheck green

### 2d. Backups  ✅ DONE  (gate-in-place — engine is Inngest-coupled, CANNOT move)
Scoping: the durable functions import `@carbon/jobs`-internal `../../../db` + the
inngest client, so the engine can't move to ee (would invert the dep). Onboarding
(`company-template`) is a second caller of `buildCompanyBackup`/`wipeAndLoad` and
must stay free. `packages/jobs/src/backups/` is import-light (bare-`tsx` CLI +
`db:check:backups`) — left untouched.
- [x] Created `packages/ee/src/backups.server.ts` → `requireBackupsEntitlement(companyId)`
      = `if (IS_LOCAL_DEV) return; requireEntitlement(serviceRole, companyId, "BACKUPS")`.
      Added `"./backups.server"` export.
- [x] Embedded the gate at the top of all 5 durable functions: `companyExportFunction`
      (company-export.ts), `companyRestore{,Finalize,Revert}Function` (company-restore.ts),
      `companyImportFunction` (company-import.ts — exempts `referencedTemplate` onboarding).
- [x] Left `canManageBackups` (app route UX gate) + `canAccessBackups` (browser-safe
      hatch for nav/Demo Data) in place. Did NOT push the check into
      `buildCompanyBackup`/`wipeAndLoad` (onboarding uses them).
- [x] In-app purge/delete/upload stay route-gated by `canManageBackups` (they carry
      `email` for the internal-staff hatch; heavy work funnels into the gated durable fns).
- [x] Updated `commercial-licensing.md` (✅), `company-backup-restore.md`, `packages/ee/AGENTS.md`.
- [x] Verified: `@carbon/ee` + `@carbon/jobs` typecheck green.
- Accepted tightening: internal-staff export of a real customer Starter company on
  Cloud is now blocked at the job (no email on the service-role path); backups is a paid
  feature and this path is not a normal support flow.

### 2e. Workflows  ✅ DONE — moved the whole package into `@carbon/ee/workflows`
Executed: created `@carbon/workflows-core` leaf (`run-trigger.ts` + `moments.ts`
`MOMENT_OUTPUT_KEYS`/types); repointed `@carbon/lib` (events.ts + raise-moment.ts)
to the leaf and swapped its dep (cycle broken); `git mv packages/workflows/src` →
`packages/ee/src/workflows` + AGENTS.md; deleted `packages/workflows`; engine
`run-trigger.ts`/`catalog/moments.ts` re-export the contracts from the leaf; added ee
exports `./workflows`, `./workflows/help`, `./workflows/labels`, `./workflows.server`
+ deps (`@carbon/workflows-core`, `@lingui/core`, glossary devDep); repointed all 94
importers (`@carbon/workflows` → `@carbon/ee/workflows`); removed stale
`@carbon/workflows` deps from erp/jobs package.json, swapped checks dep to `@carbon/ee`;
fixed build-critical paths (turbo.json inputs, package.json generate script, lingui.config.js,
scripts/{check,generate}-workflow-catalog.ts, checks `sources/typescript.ts` — removed the
now-redundant `packages/workflows/src` entry since `packages/ee/src` already covers it);
embedded gates — runtime DEGRADE `workflowsEnabledForCompany(companyId)` in jobs
`engine/execute.ts` (Skipped when not entitled), authoring throw `requireWorkflowsEntitlement`
in erp `publishWorkflowVersion`; added the `MOMENT_OUTPUT_KEYS`↔`WORKFLOW_MOMENTS` sync
assertion to `check-workflow-catalog.ts`; added the ee mock to the 4 jobs engine test files.
Verified: typecheck ee/jobs/erp/lib/checks/workflows-core green; ee tests 1499 pass, jobs
tests 734 pass; `check:workflow-catalog` green. Docs update delegated to a subagent.

<!-- original plan retained below for reference -->
#### (original plan)  ~23k lines, 96 importers
Directive: **move the whole `@carbon/workflows` package** into `packages/ee`.

**Cycle reality (scoped):** only **`@carbon/lib`** is a real cycle source —
`@carbon/database` and `@carbon/checks` were FALSE alarms:
- `@carbon/database` datasets only MENTION `@carbon/workflows` in comments (0 real
  imports); the real edge runs the other way (`@carbon/database` EXPORTS
  `./seed-workflows`, consumed test-only by workflows). No `database → workflows` dep.
- `@carbon/checks` imports it (1 script) but `@carbon/ee` does NOT depend on checks
  → `checks → ee` after repoint is safe.
- `@carbon/lib` imports it in 2 files, **type-only**: `events.ts` (`type RunTrigger`),
  `workflows/raise-moment.ts` (`type MomentKey, MomentPayload`). `@carbon/ee` depends
  on `@carbon/lib` → this is the cycle to break.

**Plan (confirmed: extract a tiny CE leaf, then move the rest):**
- [ ] Create leaf package `@carbon/workflows-core` (dep: `zod` only) holding the
      wire contracts lib needs:
      - `run-trigger.ts` — move `runTriggerSchema` + `RunTrigger` VERBATIM (it's
        already self-contained, imports only `zod`).
      - moment contract — the derivation is `MomentPayload<K> = { [O in
        keyof WORKFLOW_MOMENTS[K]["outputs"]]: MomentEntityRef }`, i.e. it needs the
        per-moment OUTPUT KEY NAMES only (not the `t.entity(...)` types). So the leaf
        holds `export const MOMENT_OUTPUT_KEYS = { "production.jobReleased": ["job",
        "releasedBy"], ... } as const` (9 entries, keys+output-key-names copied from
        `catalog/moments.ts` `WORKFLOW_MOMENTS`), then `MomentKey =
        keyof typeof MOMENT_OUTPUT_KEYS`, `MomentEntityRef = { id: string }`,
        `MomentPayload<K> = { [O in (typeof MOMENT_OUTPUT_KEYS)[K][number]]:
        MomentEntityRef }`. The engine's `WORKFLOW_MOMENTS` stays the source of truth
        (labels/permissions/`t.entity`); have the engine RE-EXPORT `MomentKey`/
        `MomentPayload`/`MomentEntityRef` from `-core` (drop its local defs) so there
        is ONE type. Add an assertion in `scripts/check-workflow-catalog.ts` that
        `Object.keys(MOMENT_OUTPUT_KEYS)` === `Object.keys(WORKFLOW_MOMENTS)` AND each
        moment's output keys match — this is the sync invariant typecheck won't catch.
- [ ] Repoint `@carbon/lib` (`events.ts`, `workflows/raise-moment.ts`) →
      `@carbon/workflows-core`; swap its `@carbon/workflows` dep for `-core`.
- [ ] `git mv packages/workflows/src/**` (minus the extracted leaf) →
      `packages/ee/src/workflows/`. Re-export `RunTrigger`/`runTriggerSchema` +
      moment types from `-core` so `@carbon/ee/workflows` surface is unchanged.
- [ ] Add ee exports: `./workflows`, `./workflows/help`, `./workflows/labels`.
      Add ee deps: `@carbon/glossary` (devDep, type-only), `@lingui/core` (for
      `./workflows/labels`), `@carbon/workflows-core`. (already has database, utils,
      intl-date, kysely, zod.)
- [ ] Repoint 96 importers → `@carbon/ee/workflows` (+`/help`, `/labels`):
      erp 61, jobs 32, checks 1 (lib now off it). erp + jobs already dep ee; add
      `@carbon/ee` to `packages/checks/package.json`.
- [ ] Lock the runtime engine `packages/jobs/src/workflows/`: embed
      `companyHasFeature("WORKFLOWS")` at `engine/execute.ts` (runs on background
      events, bypassing route gates). Default: gate in place, keep in jobs (Inngest-coupled).
- [ ] Embed `requireEntitlement("WORKFLOWS")` in
      `apps/erp/app/modules/workflows/workflows.service.ts` authoring writes.
- [ ] Move `packages/workflows/AGENTS.md` → ee; update rules referencing it.
- [ ] Delete empty `packages/workflows`; `pnpm install`.
- [ ] Verify typecheck erp + jobs + ee + checks + lib; run workflows test suites.

---

## Cross-cutting verification (run before considering any feature done)
- `pnpm exec turbo run typecheck --filter=<pkg>` (scoped — whole-repo OOMs)
- `pnpm run lint` (biome)
- `pnpm --filter <pkg> test`
- Dev build for `.server` client-graph errors (typecheck won't catch these)
- Update `.claude/rules/commercial-licensing.md` "Rollout status" per feature
- Update affected `AGENTS.md` and `.claude/rules/*` `paths:` frontmatter

## Open decisions
- [x] Task 4 destination: new `packages/planning` — DONE.
- [x] Workflows cycle resolution (2e): scoped — only `@carbon/lib` (2 type-only
  imports) is a real cycle; extract a tiny `@carbon/workflows-core` leaf (zod-only:
  `RunTrigger` + moment contract), repoint lib, move the rest to `@carbon/ee/workflows`.
- [!] Does the jobs workflow-execution engine (`packages/jobs/src/workflows/`)
  physically move to ee, or gate-in-place? Default: gate-in-place
  (`companyHasFeature` at `engine/execute.ts`); it's Inngest-coupled.

## Session log
- 2026-09-21: Tasks 1 & 3 done. Plan written. Task 4 DONE (new `@carbon/planning`
  package; typechecks + 183 planning tests green). Task 2a (audit) DONE — engine →
  `@carbon/ee/audit.server` with `requireEntitlement` (ITAR-guarded); config/types
  stay in `@carbon/database`; ee/erp/mes/jobs typecheck green.
- 2026-09-21 (cont.): 2c (email) DONE — `@carbon/ee/email-notifications.server`;
  ee+jobs green. 2d (backups) DONE — gate-in-place `@carbon/ee/backups.server`
  `requireBackupsEntitlement` embedded in all 5 durable functions; ee+jobs green.
  6 of 8 pieces complete and green (1, 3, 4, 2a, 2c, 2d). Tree is GREEN.
  REMAINING (each must land atomically): **2e workflows** (whole-package move: new
  `@carbon/workflows-core` leaf + move to `@carbon/ee/workflows` + repoint 96
  importers + lock jobs `execute.ts`/erp `workflows.service.ts`) and **2b MCP** (DI
  refactor of `@ts-nocheck` server.ts + 5 helpers → `@carbon/ee/mcp.server`, inject
  app dispatch/metadata, +3 ee deps `@modelcontextprotocol/sdk`/`zbsearch`/`@carbon/api`;
  metadata-coupled tests stay in app importing from ee). Both fully scoped above.
- 2026-09-21 (final): ALL 8 pieces DONE. 2e (workflows) — whole package → `@carbon/ee/workflows`
  + `@carbon/workflows-core` leaf; 94 importers repointed; gates in jobs `execute.ts` (runtime
  degrade) + erp `publishWorkflowVersion` (authoring throw); moment-sync invariant added.
  2b (MCP) — engine → `@carbon/ee/mcp` (pure) + `@carbon/ee/mcp.server` via DI;
  `requireEntitlement("MCP")` inside `createMcpServer`. Final consolidated typecheck GREEN
  9/9 (ee, jobs, planning, workflows-core, lib, checks, erp, mes). Tests green: ee 1499,
  jobs 734, MCP 158, planning 183, `check:workflow-catalog`. Docs synced. NOT committed.
  ⚠️ Verify before merge: MCP `POST /api/mcp` endpoint smoke test (server.ts is `@ts-nocheck`,
  not exercisable in this env).
