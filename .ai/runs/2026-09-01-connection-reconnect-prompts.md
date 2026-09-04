# Run log — under-scoped connection reconnect prompts

Plan: `.ai/plans/2026-09-01-connection-reconnect-prompts.md`
Spec: `.ai/specs/2026-09-01-connection-reconnect-prompts.md`
Branch: `feat/active-pieces-integration` · Executed 2026-09-01 · **Nothing committed** (user commits). Stacks on today's uncommitted v1 + v2 Slack work.

## What landed

| Task | Result |
|---|---|
| 1. ee predicates | `grantedScopes` (comma/space parser, `null` = unknown), `missingScopes`; `createConnection` revive now refreshes `metadata`. 3 tests. |
| 2. jobs | `requiredScopesFor(piece)` = row `oauth.scope` ?? piece scope; barrel export; Google Calendar row records `metadata.scopes`. 3 tests. |
| 3. Runner | Pre-check `missingScopes` before the vendor call → reconnect copy naming Settings → Integrations → App → Accounts → Reconnect; vendor `missing_scope`/`insufficient_scope`/`insufficient permission` mapped to the same copy. 2 tests (runner mock now spreads the real ee module). |
| 4. Builder | `integration.connection` provider hides under-scoped accounts and returns `errorCode: "reconnect"` + `errorHref` (Accounts tab) when that empties a connected app; `IntegrationNodeForm` shows "{app} is connected, but needs to be reconnected…" + **Reconnect {app}** instead of "Connect". |
| 5. Accounts tab | Loader passes `requiredScopes`; rows carry `metadata`; amber **Reconnect needed** badge + copy; **Reconnect** button (also for Expired/Revoked rows) re-runs the consent under the same name via the shared `startConnect`. |
| 6. Card | `getIntegrationHealth` marks a piece card unhealthy while any usable account is under-scoped (erp-side, since ee cannot see the allowlist). |
| 7. Regen/docs | Catalog + Lingui regenerated (`check-workflow-catalog: ok`, 6 steps unchanged); "Scope drift" section in `workflow-integrations.md`; spec → implemented. |

## Automated gates

| Gate | Result |
|---|---|
| `turbo typecheck` — `@carbon/ee`, `@carbon/jobs`, `erp` | 3/3 successful |
| `@carbon/ee` vitest | 582 passed (43 files) |
| `@carbon/jobs` vitest | 583 passed; `services.test.ts` still import-fails on the empty local `INNGEST_SIGNING_KEY` (pre-existing) |
| `@carbon/workflows` vitest | 557 passed |
| `check:workflow-catalog` | ok |
| biome on touched files | clean; `integrations.$id.tsx` reports 7 pre-existing `noConsole` warnings on lines this work did not touch (hunks: 53, 917, 1704) |

## Dev data check

Backfilled Slack workspace: 10 granted scopes → `missingScopes` = `channels:read groups:read chat:write.customize im:write channels:manage groups:write` (the six piece-only scopes). So on this DB the Accounts row shows "Reconnect needed", the Slack card reads Unhealthy, the builder shows the reconnect banner, and a Slack step fails fast with the reconnect copy — all without calling Slack.

## Browser criteria (spec AC 4–6) — UNVERIFIED, user-driven

Needs the Slack app manifest to carry the connections redirect URL and the 16 bot scopes first. Then: Settings → Integrations → Slack → Accounts → **Reconnect** on "anshul" → approve → badge clears, card Healthy, builder lists the account, step runs (AC 5). Reconnect on a Revoked row revives it (AC 6).

## Deviations from plan

None beyond formatting.

## Follow-up (same day) — thermo-nuclear remediation

See `.ai/runs/2026-09-01-thermo-nuclear-review.md` → Remediation. Relevant here: mixed-readiness notice (provider `noticeCode`, field/banner), `storedNotOffered` guard in the node form, shared `needsReconnect`, health decided once in erp with a 60 s negative cache, `omittedProps` stripping at run time, loader projects `metadata` to `{ scopes }`.
