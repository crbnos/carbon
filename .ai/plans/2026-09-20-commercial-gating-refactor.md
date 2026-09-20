# Commercial Gating Refactor — overnight autonomous run

**Branch:** `move-permissions-to-ee` · **Started:** 2026-09-20 · **Owner:** brad@carbonos.dev
**This file is the LEDGER.** It survives context resets — read it first, then continue
from the STATUS table. The pattern spec is `.claude/rules/commercial-licensing.md`.

## Goal
Refactor every plan-gated commercial feature to the tamper-resistant pattern:
1. Feature body lives in `packages/ee` (using it requires running commercial code).
2. `requireEntitlement(client, companyId, FEATURE)` embedded INSIDE the ee authoring
   functions (stripping the gate requires editing commercial code).
3. Client UX: **visible + upgrade overlay**, never hidden. Route loaders DON'T
   `requireFeature`-redirect the primary page; write routes/actions keep it.
4. Gate helper: `companyHasFeature`/`requireFeature` (community-blocked) — NOT
   `companyHasPlan`/`requirePlan` (Cloud-only no-op).

## Per-feature refactor strategy (the loop)
For each feature, one focused subagent does:
1. Confirm/add the `FEATURE_PLANS` key.
2. If the engine is in an app module / `packages/jobs`, relocate it to
   `packages/ee/src/<feature>/` (or `<feature>.server.ts`). Fix `~/` deps
   (`sanitize`→`@carbon/utils`; redefine `~/utils/query` types locally; keep
   `trigger()`/`@carbon/notifications` in the ROUTE — `@carbon/ee` can't import
   `@carbon/jobs`/`@carbon/notifications`).
3. Embed `requireEntitlement` at the top of every authoring write fn; runtime reads
   that must degrade use `companyHasFeature` → return empty/no-op.
4. Repoint call sites; remove from the app module + barrel.
5. **Bundling gotchas** (typecheck won't catch — only the dev build does): a client
   barrel must NOT derive types via `ReturnType<service>` (derive from
   `@carbon/database`); a `*.service.ts` must NOT import `@carbon/ee/<f>.server`
   (move that caller to a `*.server.ts`). See the rule's "Bundling gotcha".
6. UI: `.ee.tsx`; nav stays visible; gated page renders `usePlanGate` overlay
   (`RulesUpgradeOverlay` for tables, `UpgradeOverlay` primitives / a modal for
   editors — mirror `SalesRulesUpgradeOverlay` and the per-user permissions modal).
7. `pnpm run generate:mcp` if functions left a `*.service.ts` (they drop as MCP tools —
   usually correct; note it).

## Verification per feature (what I CAN do autonomously)
- `pnpm exec turbo run typecheck --filter=@carbon/ee`
- `cd apps/erp && pnpm run typecheck` (ignore ONLY the pre-existing
  `root.tsx(57) Cannot find module './+types/root'`)
- `pnpm exec biome check --write <touched files>`
- Relevant unit tests (`pnpm --filter @carbon/ee test`, app vitest).
- **Add entitlement unit tests** exercising BOTH editions where practical
  (`companyHasFeature`/`requireEntitlement`: Community→blocked, Enterprise/Cloud-Business→allowed).
- `pnpm run translate` (or leave a note) to fill the new overlay strings.
- Commit each feature as its own checkpoint (message `feat(ee): gate <FEATURE> …`).

## Acceptance / testing — TWO PHASES (browser = human, in the morning)
The dev build's `.server` client-graph check is the thing typecheck misses; I prevent
it via the bundling rules but the **browser boot is the real proof** and is Brad's.
1. **Gated case — `CARBON_EDITION=community`** (current `.env`): each feature's nav
   entry is VISIBLE, the page shows the upgrade overlay, and writes are blocked
   (direct-URL POST returns blocked / no effect). Inviting users still works.
2. **Non-gated case — `CARBON_EDITION=enterprise`**: switch `.env`, restart stack.
   Every feature is fully VISIBLE and FUNCTIONAL (create/edit/delete work, no overlay).
   → This validates the embedded `requireEntitlement` passes for entitled companies and
   nothing was over-gated.
A per-feature browser checklist is maintained in the STATUS table's Notes.

## Context-management protocol (how the overnight run stays alive)
- This file is the ledger; update the STATUS table after every feature.
- Heavy work → one subagent per feature (fresh context). I verify + commit + update
  ledger + dispatch the next. Subagent completion re-invokes me, so the loop is
  self-sustaining as long as one subagent is always in flight.
- STOP and leave a `⚠ BLOCKED` note (don't guess) when a feature needs a product
  decision (is X a Business feature? destructive surface? engine too woven into jobs).
- Do NOT open a PR or merge — commits on the branch are the deliverable for review.

## TODO (ranked — from inventory abfcc035)
Default decision (matches permissions/approvals precedent): convert `requirePlan`/
`companyHasPlan` → `requireFeature`/`companyHasFeature` (community-blocked) for every
gated feature; move authoring bodies into `packages/ee` + embed `requireEntitlement`;
runtime engines that live in `packages/jobs`/`@carbon/notifications` (can't move to ee)
just swap to `companyHasFeature` (degrade). Do these autonomously (A–I). FLAG the LARGE
product/architecture decisions (J–L) — don't guess.

- **A. SALES_RULES + STORAGE_RULES** (together — shared `upsertEnforcementRule`/
  `deleteEnforcementRule` in `shared.service.ts:619,651`). Evaluators already in
  `packages/ee/src/rules/{sales,storage}/server.ts` → swap `companyHasPlan`→
  `companyHasFeature` (`sales/server.ts:48`, `storage/server.ts:50`); move the shared
  enforcement-rule CRUD + `assign/unassign*` into ee, embed `requireEntitlement`; routes
  `requirePlan`→`requireFeature`. Watch `shared.service.ts` barrel client-graph.
- **B. EMAIL_NOTIFICATIONS** — body in `packages/jobs` `notify.ts:537` (can't move). Just
  `companyHasPlan`→`companyHasFeature` there + `account+/notifications.tsx:49`. Tiny.
- **C. INTEGRATIONS** — bodies already in ee. Embed `requireEntitlement("INTEGRATIONS")`
  in `integrations/hooks.server.ts`/`secrets.ts` install/save (honor
  `isIntegrationWhitelisted`); routes `integrations.$id.tsx:1476`,
  `integrations.deactivate.$id.tsx:26` → `requireFeature`.
- **D. TWO_FACTOR** — move only the `requireMfa` company-policy writer into ee +
  `requireEntitlement` (mirror `updateConsoleSetting`); `security.tsx:159`→`requireFeature`.
  Leave GoTrue MFA.
- **E. API_KEYS** — move `upsertApiKey`/`deleteApiKey` (`settings.service.ts:1317,98`) to
  ee + `requireEntitlement`; routes→`requireFeature`. Leave `@carbon/auth` runtime verify.
  Barrel client-graph risk.
- **F. WEBHOOKS** — move `upsertWebhook`/`deleteWebhook` (`settings.service.ts:1478,112`)
  to ee + `requireEntitlement`; routes→`requireFeature`; gate delivery via runtime
  `companyHasFeature` in jobs. Barrel risk.
- **G. FORECAST** — extract `upsertDemandForecasts`/`deleteDemandForecasts`
  (`production.service.ts:4753,498`) to ee + `requireEntitlement`; routes→`requireFeature`.
- **H. CUSTOMER_PORTALS** — move portal authoring (`shared.service.ts:256-298` + the
  `upsertExternalLink` path) to ee + `requireEntitlement`; keep public share-page
  (`share+/customer.$id*`) as runtime `companyHasFeature` degrade.
- **I. AUDIT_LOG** — wrap the audit read in an ee fn gated by `companyHasFeature`; remove
  the loader `requirePlan` redirect (`audit-logs.tsx:92`) so the page stays visible behind
  the overlay (read-only → no `requireEntitlement` throw).

### FLAGGED — do NOT do autonomously (need Brad)
- **J. AI_AGENT** ⚠ — LARGE; currently HIDDEN when gated (`useAgentAvailable.ts:12`).
  Decision needed: hidden→visible+overlay? Core in `modules/agent` deeply `~/`-coupled
  (AI SDK, cross-module tools) — big relocation.
- **K. WORKFLOWS** ⚠ — authoring movable to ee, but the runtime ENGINE is a full inngest
  system in `packages/jobs` (gate via `companyHasFeature`). LARGE; confirmed
  `workflows.service.ts` `ReturnType`/`~/utils/query` client-graph gotcha to fix.
- **L. BACKUPS** ⚠ — engine deeply in `packages/jobs`; rule says relocate LAST. Already
  gated via `canManageBackups` (route-level). Big lift; keep the `canAccessBackups`
  internal/local-dev escape hatch.

**Every move:** no `*.service.ts` may import `@carbon/ee/<f>.server` (barrel→client graph —
move the caller to `*.server.ts`); derive client types from `@carbon/database`, not
`ReturnType<service>`; run `generate:mcp` when fns leave a `*.service.ts`.

## STATUS
| Feature | Size | State | Commit | Notes |
|---|---|---|---|---|
| PERMISSIONS | — | ✅ done | ba2787c2 | body in ee, requireEntitlement embedded, per-user modal overlay |
| console (PERMISSIONS) | — | ✅ done | ba2787c2 | console.server in ee, embedded; card gated-state |
| APPROVAL_RULES | — | ✅ done | ba2787c2 | approvals/ in ee, embedded, page overlay |
| BACKUPS | gate-only | ◑ gated | ba2787c2 | gated via canManageBackups; engine still in packages/jobs (LARGE relocation deferred — do last) |
| A. SALES_RULES + STORAGE_RULES | MEDIUM | ✅ done | (this) | CRUD → packages/ee/src/rules/service.server.ts (`@carbon/ee/rules.server`), requireEntitlement by `family`; evaluators swapped companyHasPlan→companyHasFeature; 12 write routes → requireFeature; verified (ee+erp typecheck, biome, 1041 ee tests, mcp shared 31→29). `unassignStorageRule` gained companyId arg. |
| B. EMAIL_NOTIFICATIONS | SMALL | ✅ done | (this) | companyHasPlan→companyHasFeature at notify.ts:537 (jobs, runtime degrade — email channel off for community) + account/notifications.tsx:49. Body stays in jobs (can't move to ee — @carbon/notifications dep). Verified jobs+erp typecheck. |
| C. INTEGRATIONS | MED (arch) | ⚠ FLAGGED — needs Brad | | No single ee choke point for the install/save WRITE: it goes through community `upsertCompanyIntegration` (settings.server.ts:330, inline vault write), NOT ee `persistIntegrationSecrets`. Shared install/update dispatcher (`hooks.server.ts:84`) also serves uninstall+read (can't gate). Per-provider hooks have HOLES (jira/linear/onshape/paperless-parts/slack have no onInstall/onUpdate). **Decision:** (A) relocate the universal integration secret/metadata write into ee `persistIntegrationSecrets` + embed requireEntitlement (complete, covers OAuth callbacks; bigger) — RECOMMENDED; or (B) embed in the 4 existing provider hooks + accept documented holes. Route swap requirePlan→requireFeature held pending this (else it's a UX-only mislabeled moat). |
| D. TWO_FACTOR | SMALL-MED | ✅ done | (this) | updateRequireMfaSetting → packages/ee/src/two-factor.server.ts; requireEntitlement scoped to ENABLING only (downgrade can still disable); security.tsx route→requireFeature; mcp 1548→1547. Verified. |
| E. API_KEYS | MEDIUM | ✅ done | (this) | upsert/deleteApiKey → packages/ee/src/api-keys.server.ts + requireEntitlement (companyId from payload/row); 3 routes→requireFeature; key-gen/hash stays in route; mcp 1547→1545. Runtime verify (@carbon/auth) untouched. Verified. Doc-sync TODO: settings/AGENTS.md lists upsert/deleteApiKey (stale). |
| F. WEBHOOKS | MEDIUM | ✅ done | (this) | upsert/delete/deactivateWebhooks → packages/ee/src/webhooks.server.ts + requireEntitlement; delivery gated via companyHasFeature degrade in jobs events/webhook.ts:37; 3 routes→requireFeature; mcp −3. Verified. |
| G. FORECAST | MEDIUM | ⬜ next | | extract upsert/deleteDemandForecasts from production.service.ts → ee + requireEntitlement; routes→requireFeature; watch production.service.ts barrel |
| H. CUSTOMER_PORTALS | MEDIUM | ⬜ | | |
| I. AUDIT_LOG | MEDIUM | ⬜ | | |
| J. AI_AGENT | LARGE | ⚠ FLAGGED | | hidden→overlay decision + big relocation; needs Brad |
| K. WORKFLOWS | LARGE | ⚠ FLAGGED | | engine in jobs; needs Brad |
| L. BACKUPS engine | LARGE | ⚠ FLAGGED | | relocate engine from jobs; do last; needs Brad |
