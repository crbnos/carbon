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

## TODO (ranked; filled from the inventory agent — abfcc035)
> Filled once the inventory returns. Order: SMALL (body already in `packages/ee`) first,
> then MEDIUM, then LARGE (engine relocation), backups + anything destructive last.

_(pending inventory)_

## STATUS
| Feature | Size | State | Commit | Notes |
|---|---|---|---|---|
| PERMISSIONS | — | ✅ done | ba2787c2 | body in ee, requireEntitlement embedded, per-user modal overlay |
| console (PERMISSIONS) | — | ✅ done | ba2787c2 | console.server in ee, embedded; card gated-state |
| APPROVAL_RULES | — | ✅ done | ba2787c2 | approvals/ in ee, embedded, page overlay |
| BACKUPS | gate-only | ◑ gated | ba2787c2 | gated via canManageBackups; engine still in packages/jobs (LARGE relocation deferred — do last) |
| _rest_ | | ⬜ pending inventory | | |
