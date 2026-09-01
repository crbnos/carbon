# Thermo-nuclear review — Slack workflow piece · single source of truth · reconnect prompts

> **Remediated 2026-09-01 (same session):** BLOCKER 1–2 and MAJOR 3–10 are fixed — see the
> "Remediation" section at the end. MINOR 11–23 (except 24, fixed in passing) and Q1–Q6 are
> still open. Verification after the fixes: typecheck `@carbon/ee @carbon/jobs @carbon/workflows erp`
> clean; ee 582 / jobs 586 (+ the pre-existing env-gated `services.test.ts`) / workflows 557 pass;
> `check:workflow-catalog` ok; biome clean on every touched file; the hardened migration ran in a
> rolled-back transaction without error; `.po` diff is 13 files / 1,223 lines of real strings.

Scope: the uncommitted working tree on `feat/active-pieces-integration` (43 modified + 14 new
files, 26 `.po` files) plus today's one commit `cd04bee95` (transient-refresh fix). Reviewed via
`self-review` strict mode: four area reviewers (ee + migration · jobs integrations · erp routes/UI ·
env/docs/tests) whose claims were re-verified against the code before inclusion; items marked
*(reviewer)* were checked by the reviewer with `file:line` evidence but not independently
re-executed by me.

Verification run while reviewing: typecheck `@carbon/ee @carbon/jobs @carbon/env @carbon/workflows erp`
clean; ee 582 / jobs 583 (+1 pre-existing env-gated suite) / workflows 557 tests pass;
`check:workflow-catalog` ok; biome clean on touched lines.

Nothing below has been fixed — the user decides.

---

## BLOCKER 1 — a fourth reader of `companyIntegration.slack` was missed: per-user Slack DMs go dark

`packages/jobs/src/inngest/functions/notifications/notify.ts:650-673`

The v2 spec repointed `getSlackAuth`, `send-slack`, `slack-document-sync` (×4), the interactive
route and the prefs page. `notify.ts`'s `resolve-slack-recipients` step still does
`companyIntegration … .eq("id","slack")` → `resolveIntegrationSecrets(client, companyId, "slack", …)`.
With `SECRET_KEYS.slack` removed (`packages/ee/src/integrations/secrets.ts:26`) that helper returns
the now-empty metadata `{}` at its early return, `accessToken` is `undefined`, the step returns `[]`,
and **every per-user Slack DM notification is silently skipped for every tenant** the moment the
migration runs. No type error, no test, no log above `console.error` on the happy path.

Fix: replace the block with `const workspace = await getSlackWorkspace(client, payload.companyId)`
and use `workspace?.token`; then grep once more for `"slack"` next to `companyIntegration` before
merging (the earlier consumer map was built from `packages/ee/src/slack` exports and missed this
inline read).

## BLOCKER 2 — 169,651 lines of `.po` noise

`packages/locale/locales/*/erp.po` (26 files)

`lingui:extract` was run without the repo's `lingui:clean`, so every catalog gained `#: path:line`
origin comments and a `POT-Creation-Date` header (`lingui.config.js:9-12`, `package.json:65`).
Translations are intact (one legitimately reworded msgid). The commit hook would normalise it, but
as a working tree it hides the real change. Fix: `pnpm run lingui:clean`.

## MAJOR 3 — the migration can abort a deploy, or leave an Active connection with no secret

`packages/database/supabase/migrations/20260901044047_slack-connections-single-source.sql:32-63`

- `companyIntegration.updatedBy` is bare `TEXT` (no FK — verified against `pg_constraint`), but it is
  copied into `integrationConnection.createdBy/updatedBy`, both `REFERENCES "user"`. One stale user
  id in any tenant raises 23503 inside the `DO` loop and fails the whole migration. Fix: resolve
  `v_actor` through `SELECT id FROM "user" WHERE id = …` before the `userToCompany` fallback, and use
  `v_actor` for `updatedBy` too.
- The row is inserted `Active` before the vault is consulted; if `get_integration_secret` returns
  NULL / no `access_token`, the plaintext and old vault entry are then deleted (`:67-71`) and the
  company ends with an Active connection whose `readTokens` throws `ConnectionSecretUnavailableError`
  forever, while the card reads Healthy. Fix: read the bag first; insert `status='Expired',
  lastError='No token found at migration'` when absent; skip the vault upsert when `v_row.active`
  is false (a Revoked row must hold no secret, as `disconnectConnection` guarantees). Also have
  `getSlackWorkspace*` catch `ConnectionSecretUnavailableError` → `null`.
- *(reviewer)* The "no member" skip branch leaves the old token orphaned in the integration vault
  with no remaining reader; strip + `delete_integration_secret` there too, or say why not.

## MAJOR 4 — the Slack incoming-webhook URL is copied into `metadata` and shipped to the browser

`packages/jobs/src/workflows/integrations/allowlist.ts:165-166` (`webhook_url`, `configuration_url`),
migration `:49-50`, `apps/erp/app/routes/x+/settings+/integrations.$id.tsx:917` (full rows →
`ConnectionRow` now includes `metadata`, `ConnectionsTab.tsx:184`).

An incoming-webhook URL is a bearer capability (whoever holds it can post to the channel). Nothing
reads it (`workspaceFacts` uses only `team_id/channel_id/bot_user_id`), yet the map, the migration
and the loader all carry it, and the `oauth.test.ts` "never the token" test asserts its presence.
Fix: drop both keys from the allowlist map and the migration (and strip them from the already-
migrated dev row); project the loader payload to `{ …row, metadata: { scopes } }` or compute
`needsReconnect` server-side and remove `metadata` from `ConnectionRow`.

## MAJOR 5 — `omit` is catalog-only; a node value still reaches the vendor

`packages/jobs/src/workflows/integrations/properties.ts:152-176` (`toPropsValue`),
`packages/workflows/src/runtime/integration.ts:32`, `packages/workflows/src/definition/nodes.ts:246`

`toPropsValue` iterates the piece's own `props` and "a node value always wins". `checkInputs` only
validates *declared* inputs. So a node saved before the omit (or a definition posted with
`inputs.sendAsBot=false` / `inputs.blocks=[…]`) sends the omitted prop — the exact user-token path
the omit exists to make unreachable. Fix: `toPropsValue` (or `runIntegrationAction`) consults
`visibilityOf` and, for `omit: true`, ignores `inputs[name]` and sends only the pin. Test: "an
omitted prop with a stale node value is not sent".

## MAJOR 6 — the bot token is persisted in Inngest step state

`packages/jobs/src/inngest/functions/notifications/send-slack.ts:15-22`

`step.run("resolve-slack-token")` returns the token as step output, which Inngest serialises. The
old code had the same shape but had been returning `null` since the Aug-17 vault scrub; this diff
makes it return a live token again. Fix: resolve and use the token inside the single `post-message`
step (as `slack-document-sync.ts` does); never return secret material from `step.run`. Also catch
and return `null` on lookup failure to preserve the env-token fallback (see MINOR 12).

## MAJOR 7 — mixed readiness: builder and card disagree, and a stale account is silently repointed

`apps/erp/app/modules/workflows/options-providers.server.ts:96-108`,
`…/IntegrationNodeForm.tsx:89-93,151-168,178-183` *(reviewer, logic confirmed by reading)*

One ready + one under-scoped Active account: the provider drops the stale one with no `errorCode`;
`onlyConnection` becomes the single ready id, the connection field is hidden, a node already
storing the stale id keeps it with no field and no banner, a new node is silently pointed at the
other account — while the card says Unhealthy. Fix: return `errorCode: "reconnect"` + `errorHref`
whenever `ready.length < usable.length` (alongside the ready options); never hide the field while
the stored `connectionId` is not among the offered options.

## MAJOR 8 — `getSlackWorkspaceByTeamId` picks the first company when a workspace is linked to two

`packages/ee/src/slack/lib/service.ts:254-281` *(reviewer)*

One Slack app serves all tenants and the card now advertises "add more accounts", so two Carbon
companies can connect the same workspace. `.limit(1)` routes every slash command to whichever
connected first; `getCarbonEmployeeFromSlackId` falls back to `id: "system"` (`:381-392`), so an
employee of company B creates issues in company A. The old code took `data[0]` too — this diff
codifies it. Fix: fetch all Active matches; if >1 distinct `companyId`, answer with an ephemeral
"this workspace is linked to more than one Carbon company" (or resolve by the invoking user's
email → membership). Test the ambiguity branch.

## MAJOR 9 — health check does the work twice and never caches "unhealthy"

`apps/erp/app/modules/settings/settings.server.ts:427-434,475-483`, `packages/ee/src/hooks.server.ts:56`

Only `"1"` is honoured from Redis, so every legacy Slack workspace (now permanently under-scoped
until someone reconnects) is recomputed on every Settings → Integrations load — the ee hook's
`readConnections` plus a second identical `readConnections` here plus `requiredScopesFor`. Fix:
one read in erp (`connectionsHealthy(rows) && !rows.some(needsReconnect)`), skip the ee hook for
allowlisted pieces, and cache `"0"` with a short TTL (the callback already invalidates the key).

## MAJOR 10 — docs contradict the code

- `.claude/rules/workflow-integrations.md:327` says "the ten our four actions need"; the row has 16.
- `.ai/specs/2026-09-01-slack-workflow-piece.md:59,92,172,217` and `.ai/plans/…workflow-piece.md:23`
  still name `SLACK_CONNECTIONS_REDIRECT_URL` while marked implemented.
- `.claude/rules/issue-module.md:169` documents `nonconformance_channel_id` /
  `nonconformance_notifications_enabled` that the migration dropped.
- `.claude/rules/workflow-actions.md:230` and `…/fields/choiceOptions.tsx:27` gate the notify
  action's Slack channel on `companyIntegration.slack.active`, while delivery now needs a usable
  connection (MINOR 13).
- `packages/ee/AGENTS.md:42` still describes the piece pattern as `google-calendar/config.tsx` only.

---

## MINOR 11 — `markIntegrationInstalled` is read-then-insert
`settings.server.ts:316-343`. Two concurrent callbacks both see `null`; the second insert hits the
PK and the callback reports `save-failed` after tokens were already written. Use
`upsert(…, { onConflict: "id,companyId", ignoreDuplicates: true })` then a guarded `update`.

## MINOR 12 — `getSlackWorkspace` now throws where the old path fell back
`send-slack.ts:17-21`, `service.ts:232-252`. Vault errors / near-expiry now throw (3 retries, then
fail) instead of falling back to `SLACK_BOT_TOKEN`; and it costs three round trips
(`readConnections` → `readConnection` → vault). Catch → `null` in the step; let
`readConnectionAccessToken` accept an already-read connection.

## MINOR 13 — revoking the last account leaves the card installed
Disconnect (not Uninstall) the only Slack account: card stays Installed, builder still offers the
Slack notify channel (`choiceOptions.tsx:27`), `send-slack` falls back to the env token silently.
Decide: deactivate the card when the last connection is revoked, or have `notify` warn and skip.

## MINOR 14 — `needsReconnect` written three times
`settings.server.ts:481-482`, `options-providers.server.ts:96-98`, `ConnectionsTab.tsx:184-185`
(+ `requiredScopesFor` fetched in three places). One `partitionByScopes(rows, required) → { ready, stale }`
in `@carbon/ee/integrations/connections`.

## MINOR 15 — `service.ts:258-268` re-inlines `SELECT_COLUMNS` and the `as unknown as IntegrationConnection`
cast that `connections.ts:86-90` promises is bridged in one place. Add `readConnectionsWhere(...)`
to `connections.ts`.

## MINOR 16 — `readConnectionAccessToken` duplicates `resolveConnectionAuth`'s read/status guard and
throws a bare `Error` where the file otherwise uses typed errors (`connections.ts:535-554`). Extract
`readActiveConnection()`; name the error.

## MINOR 17 — revive omits `updatedAt` (`connections.ts:217-232`) unlike rename/disconnect.

## MINOR 18 — `vendorText` (`properties.ts:114-116`) does not escape `\`; the generator emits raw
template literals, so a vendor `\u`/trailing `\` would break `labels.generated.ts`. Also the step
label `${entry.label}: ${action.displayName}` (`catalog.ts:127`) bypasses both `vendorText` and
`assertLabelIsSafe`. Latent today.

## MINOR 19 — `SCOPE_ERROR` (`integration.ts:28-29,138`) also matches Carbon's own throws inside the
same `try` and `insufficient.?permission` can relabel a resource ACL denial as "reconnect". Apply it
only to errors from `action.run`; narrow to observed vendor tokens.

## MINOR 20 — shared `reconnecting` state (`ConnectionsTab.tsx:130,150`): one Reconnect click spins
every Reconnect and Add-account button. Track `pendingName`.

## MINOR 21 — `IntegrationNodeForm.tsx:224-268` two near-identical banner blocks; provider's
`emptyHref: path.to.integrations` (`options-providers.server.ts:115`) still points at the grid while
both banners deep-link to `?tab=connections`.

## MINOR 22 — migration `integrationConnection_slack_team_idx` is Slack-named but not partial; the
helper's `SECURITY DEFINER SET search_path` is unneeded (the RPCs it calls are definers). Cosmetic.

## MINOR 23 — connect route error strings (`$piece.connect.ts:29,38`) are English-only and now
toasted from two entry points; route them through `integration-errors.ts` codes like the callback.

## MINOR 24 — `settings.server.ts:305-309` comment on `markIntegrationInstalled` still says the Slack
row holds `team_id/channel_id/webhook url`; it no longer does.

---

## QUESTIONS

- **Q1** Every existing Slack customer's card goes Unhealthy at deploy (backfilled scopes = the
  Assistant's 10) although the Assistant works. This is the badge behaviour the user chose, but the
  blast radius is "all legacy tenants at once". Keep, or gate the badge on the company having a
  workflow that uses the piece?
- **Q2** Reconnect re-consents under the same name and the revive overwrites `metadata` wholesale
  (`connections.ts:224-226`); picking a *different* workspace or channel in Slack's picker silently
  repoints the Assistant's `team_id`/`channel_id`. Refuse (or warn) when the new `team_id` differs?
- **Q3** If the Slack app ever enables token rotation, `expiresAt` is stored and every Assistant
  call throws "use resolveConnectionAuth". Deliberate constraint — is it written where the person
  flipping that switch will see it?
- **Q4** `slack-user:${userId}` Redis key (`service.ts:311,333`) is not keyed by team; multi-workspace
  is now a feature. Pre-existing.
- **Q5** Runner copy (`reconnectCopy`, `NO_CONNECTION`) is English-only by precedent; the reconnect
  string is the longest user-facing one yet. Is the run ledger exempt from Lingui by design?
- **Q6** `.ai/docs/slack-integration-storage-eli5.html` is the only `.html` in `.ai/docs/`. Keep in
  repo or move to scratch/artifact?

## Docs freshness

| File | Stale | Fix |
|---|---|---|
| `.claude/rules/workflow-integrations.md:327` | "ten" scopes | sixteen (10 Assistant + 6 workflow) |
| `.claude/rules/issue-module.md:169` | `nonconformance_*` on the integration row | channel comes from the connection's `channel_id` via `getSlackWorkspace` |
| `.claude/rules/workflow-actions.md:230` | Slack gated on the integration being active | a usable Slack connection |
| `.ai/specs/2026-09-01-slack-workflow-piece.md:59,92,172,217`, `.ai/plans/…workflow-piece.md:23` | `SLACK_CONNECTIONS_REDIRECT_URL` | superseded note → `SLACK_OAUTH_REDIRECT_URL` + forwarder |
| `packages/ee/AGENTS.md:42` | piece pattern described as GCal-only | mention Slack; the Assistant consumes the connection |
| `apps/erp/app/modules/settings/AGENTS.md:75` | helper list | add `markIntegrationInstalled` |
| `.ai/specs/AGENTS.md:30` | three specs "implemented" but not in `implemented/` | ask, then move |
| `.ai/lessons.md` | no entry | add: "secret material is read through one reader — three readers of `companyIntegration.metadata.access_token` silently degraded after the Aug-17 vault scrub" and "commit `.po` files only after `lingui:clean`" |

## Missing tests (would a revert be caught?)

| Change | Covered | Feasible as |
|---|---|---|
| `notify.ts` Slack recipient resolution | no | unit with mocked `getSlackWorkspace` |
| `markIntegrationInstalled` insert / reactivate / never-overwrite | no | erp unit with a hand-rolled client stub (precedent: `connections.test.ts` `makeClient`) |
| forwarder `integrations.slack.oauth.ts` | no | trivial loader test asserting `Location` |
| `getSlackWorkspace` / `getSlackWorkspaceByTeamId` (oldest-Active, null, missing-secret, ambiguity) | no | ee unit with `from`/`rpc` stub; extract a pure `pickAssistantConnection` |
| `getIntegrationHealth` scope branch | no | unit with mocked `readConnections`/`requiredScopesFor`/redis |
| options-provider `reconnect` branch (incl. mixed readiness) | no | unit with mocked ee/jobs |
| revive **without** `metadata` keeps the old map | no | one more case in `connections.test.ts` |
| omitted prop with stale node value not sent | no | `properties.test.ts` |
| migration (tokenless row, no-member skip, re-run) | manual only | no SQL harness in repo |
| `ConnectionsTab` / `IntegrationNodeForm` | no | browser/RTL; low ROI |
| Covered: `buildConsentUrl`, `requiredScopesFor`, `connectionMetadataFrom`, `missingScopes`, `readConnectionAccessToken`, revive-with-metadata, runner scope refusal + `missing_scope` mapping, catalog emission, `omit`/MARKDOWN visibility, `vendorText` | — | — |

## Checked and cleared

Forwarder is a fixed same-origin path with only `url.search` passed through — no open redirect; the
callback still enforces session, HMAC state (10-min) and `state.companyId === companyId`; token
exchange uses the same `redirectUri` the consent was built with. Service-role reads in health,
provider and prefs page are all scoped by the session's `companyId`. `@slack/oauth` removed from
`@carbon/ee` (transitive of `@slack/bolt` only). `SLACK_STATE_SECRET`, `getSlackInstallUrl`,
`slackOAuthTokenResponseSchema`, `integrations/slack/install`, `getSlackIntegration*`,
`hasSlackIntegration` — zero live references. RPC signatures, json/jsonb casts and idempotency of
the migration verified; `companyIntegration.updatedAt` defaults to `now()`. `loadPiece` memoises,
so `requiredScopesFor` is a map lookup after warm-up. Google Calendar rows have no recorded scopes
→ never flagged. All new UI strings go through `<Trans>`; catalog diff is additive only.
`connections.ts` transient-refresh commit (`cd04bee95`) is sound.

## Verdict

**Not shippable as is.** BLOCKER 1 breaks per-user Slack DMs for every tenant on deploy and is a
five-line fix; BLOCKER 2 is one command. MAJOR 3 (migration robustness) and MAJOR 4 (webhook URL
in metadata / browser) should land before the migration runs anywhere but dev, because both are
much cheaper to fix before data exists. MAJOR 5 (omit at run time) and MAJOR 6 (token in Inngest
state) are correctness/security gaps in code that is otherwise complete. MAJOR 7–9 are design
tightenings; Q1 is a product call to make explicitly.

---

## Remediation (what was changed for each)

| # | Fix |
|---|---|
| B1 | `notify.ts` `resolve-slack-recipients` now calls `getSlackWorkspace(client, companyId)` (try/catch → `[]`); `resolveIntegrationSecrets` import dropped. |
| B2 | `pnpm run lingui:clean` (and a fresh `lingui:extract` for the new banner strings). |
| M3 | Migration rewritten: `v_actor` resolved through `"user"` then `userToCompany`, else NOTICE + untouched; vault read BEFORE insert; no token → `status='Expired'` + `lastError`; inactive → `'Revoked'` with no secret; `updatedBy = v_actor`; index made partial on `pieceName='slack'`; no `SECURITY DEFINER`. Dry-run in `BEGIN…ROLLBACK` clean. |
| M4 | `webhook_url` / `configuration_url` removed from the Slack allowlist `metadata` map, the migration and the dev row (`metadata - 'webhook_url' - 'configuration_url'`); `oauth.test.ts` now asserts their absence; the drawer loader projects rows to `{ …, metadata: { scopes } }`. |
| M5 | `omittedProps(piece, action, props)` in `visibility.ts`; `runIntegrationAction` strips those keys from the node's inputs before `toPropsValue`, so only the pin is sent. Tests in `visibility.test.ts` (real Slack row) and `integration.test.ts` (stale `sendAsBot=false` → piece receives `true`). |
| M6 | `send-slack.ts` resolves the token inside the single `post-message` step (never a step output) and falls back to the env token on any lookup failure. |
| M7 | Provider returns ready options **plus** `noticeCode: "reconnect"` / `noticeHref` when some usable accounts are under-scoped (error only when none are ready); `useWorkflowOptions` passes the notice through; `OptionsField` shows "An account is missing from this list until it is reconnected · Reconnect it"; `IntegrationNodeForm` shows a non-blocking banner, and never hides the connection field when the node's stored account is not among the offered options (`storedNotOffered`). Provider `emptyHref` now deep-links to `?tab=connections`. |
| M8 | `getSlackWorkspaceByTeamId` fetches every Active match and throws `AmbiguousSlackWorkspaceError` when they span companies; the interactive route answers with an ephemeral explanation instead of acting in the wrong company. |
| M9 | `getIntegrationHealth` decides piece-card health once in erp (`connectionsHealthy(rows) && !rows.some(needsReconnect)`), honours a cached `"0"` (60 s TTL; unhealthy is stable until a reconnect, and every mutation path invalidates the key), and the ee hook no longer runs for piece cards (`pieceConnectionsHealthy` + its `onHealthcheck` entries removed). New shared `needsReconnect(row, required)` in `@carbon/ee/integrations/connections` used by the provider, the health check and the Accounts tab (also closes MINOR 14). |
| M10 | Docs: `workflow-integrations.md` (sixteen scopes), `issue-module.md:169`, `workflow-actions.md:230`, v1 spec + plan superseded notes, `packages/ee/AGENTS.md:42`, settings `AGENTS.md:75`, two new `.ai/lessons.md` entries. Spec moves to `implemented/` still pending your say-so (`.ai/specs/AGENTS.md:14`). |
| Minor 24 | `markIntegrationInstalled` comment reworded in passing. |
