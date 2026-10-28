# Under-scoped connections: say "reconnect" everywhere the customer would otherwise file a bug

> Status: implemented (2026-09-01)
> Author: Aashu
> Date: 2026-09-01
> Follows: `2026-09-01-slack-single-source-of-truth.md` (v2)

## TLDR

After v2, a Slack workspace connected before the workflow piece existed is **connected but
under-scoped**: its bot token carries the Assistant's 10 scopes, not the 16 the piece asks for, so
a workflow Slack step or its channel dropdown fails with Slack's `missing_scope` — and nothing in
Carbon says why. This spec compares each connection's **granted** scopes (already recorded as
`metadata.scopes` by the v2 callback and backfill) against the piece's **required** scopes (the
allowlist row / piece auth — the same list the consent URL sends) and surfaces one consistent
"Reconnect" state in four places: the Accounts tab (with a one-click **Reconnect** that re-runs the
consent for that account), the workflow builder (connection field and the node's banner), the
Integrations card badge (Unhealthy), and the step's run error (pre-checked before calling the
vendor, and mapped if the vendor says so anyway). Everything is data-driven off the allowlist row;
a vendor whose connections record no scopes (Google Calendar today) is never flagged.

## Problem Statement

Customers will not read release notes. An admin who installed Slack for the Assistant months ago
opens a workflow, drops a Slack step, sees the account in the dropdown, publishes, and the run
fails with `Slack rejected this: An API error occurred: missing_scope`. They file a bug. The fix
is one click (re-consent) — Carbon just has to say so, at the moment they'd otherwise get stuck.

## Goals

1. Detect under-scoped connections generically: `missingScopes(connection, required)`.
2. Show it and offer the fix where the person is: Accounts tab, builder, card, run error.
3. Reconnect = the existing consent for that account name (row revives, token and `metadata.scopes`
   refresh). No new route, no new table.
4. Vendors without recorded scopes are untouched; Google Calendar starts recording them for the future.

## Non-Goals

- Automatic re-consent, emails, or in-app notifications about it.
- Per-scope explanations ("you are missing channels:read") to customers — the fix is the same
  regardless; the missing list goes to the server log only.
- Changing what "usable"/"healthy" mean for the Assistant: an under-scoped workspace is still fully
  usable by the Assistant.

## Proposed Solution

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Granted scopes source | `connection.metadata.scopes` (string; split on `/[\s,]+/`) | Slack's token response uses commas, the v2 backfill wrote spaces; one parser, no migration. Absent → `null` = unknown. |
| Required scopes source | `requiredScopesFor(piece)` = `entry.oauth.scope ?? pieceAuth.scope` (jobs, `oauth.ts`) | Exactly what `buildConsentUrl` sends, so "reconnect" always grants what "required" checks. Shared by connect route, options provider, health and runner. |
| Predicate home | `packages/ee/src/integrations/connections.ts`: `grantedScopes`, `missingScopes(connection, required)` — pure | ee cannot import jobs (jobs depends on ee), so the required list is a parameter; every caller lives where both are known (erp, jobs). Unknown grants → `[]` missing (never flag what we cannot see). |
| Builder dropdown | Under-scoped accounts are **excluded**; if that empties an otherwise-connected app, the provider returns `errorCode: "reconnect"` + `errorHref` (Accounts tab) | Precedent: "a revoked account in a dropdown is a trap". `OptionsProviderResult` already carries `errorCode`/`errorHref`, and `OptionsField` already renders "This account needs to be reconnected · Fix this". |
| Node banner | `IntegrationNodeForm` distinguishes "not connected" from "needs reconnect" using the same hook result | Today it shows "Connect Slack" whenever the option list is empty — wrong words for an installed app. |
| Card badge | `getIntegrationHealth` (erp) marks a piece card **unhealthy** when any usable connection is under-scoped | User decision. erp knows both sides; the generic hook keeps returning connection health, the erp layer adds the scope check for `PIECE_ALLOWLIST` ids only. Unhealthy is never cached, so Reconnect clears it at once. |
| Reconnect action | Accounts row button → `GET /api/integrations/connections/{piece}/connect?name={row.name}` → consent → callback → `createConnection` **revives** the row | Existing revive path; it must now also refresh `metadata` (today it keeps the old map, so `scopes` would never update). |
| Runner | Pre-check `missingScopes` before `action.run`; ALSO map a vendor error matching `/missing_scope\|insufficient_scope\|insufficient.?permission/i` | Deterministic first (no vendor call, no partial side effects), belt-and-braces second for a grant that drifted server-side. Copy names the path: Settings → Integrations → {app} → Accounts. |
| Google Calendar | Add `metadata: { scopes: "scope" }` to its allowlist row | Google returns `scope` too; new connections record it, old ones stay `null`/unflagged. One line; makes the mechanism uniform. |
| Copy | Lingui (`<Trans>`/`t`) in UI; runner copy is plain English like the runner's other errors | Matches each layer's existing convention. |

### 1. `packages/ee/src/integrations/connections.ts`

```ts
/** Scopes the vendor said it granted, recorded by the callback from the token response
 * (`metadata.scopes`, comma- or space-separated). `null` when the connection predates
 * recording or the vendor does not report them — the caller must not flag those. */
export function grantedScopes(connection: Pick<IntegrationConnection, "metadata">): string[] | null
/** Required scopes the connection does not hold. Empty when grants are unknown. */
export function missingScopes(connection, required: readonly string[]): string[]
```
`createConnection` revive branch: `...(args.metadata === undefined ? {} : { metadata: args.metadata })`.

### 2. `packages/jobs/src/workflows/integrations/oauth.ts`

`export async function requiredScopesFor(pieceName): Promise<readonly string[]>` — `PIECE_ALLOWLIST[piece].oauth.scope ?? (await getPieceOAuth2Auth(piece)).scope`; `buildConsentUrl` unchanged (sync, already takes both) — the connect route keeps calling it; the new helper is for the three readers below.

### 3. Accounts tab

Loader (`integrations.$id.tsx`) adds `requiredScopes: await requiredScopesFor(integrationId)` to `connections`; `ConnectionRow` gains `metadata`. `ConnectionsTab` → `ConnectionItem` receives `requiredScopes`:
- `needsScopes = connectionUsable(c) && missingScopes(c, required).length > 0` → amber `Badge` "Reconnect needed" beside the status badge, copy: *"Connected before workflows needed extra {app} permissions. Reconnect to grant them — everything else keeps working meanwhile."*
- **Reconnect** button (icon `LuPlug`) for `needsScopes` OR `!connectionUsable(c)`: `connect.load(connectUrl?name=<c.name>)` through the same fetcher/effect the Add-account button uses (popup opens from the returned URL). Replaces today's "Add it again to reconnect" sentence for broken rows.

### 4. Options provider + builder

`connectionProvider`: `required = await requiredScopesFor(piece)`; `ready = usable.filter(r => missingScopes(r, required).length === 0)`; if `ready.length === 0 && usable.length > 0` → `{ options: [], errorCode: "reconnect", errorHref: \`${path.to.integration(piece)}?tab=connections\` }`; else options from `ready`, `emptyHref` as today.
`IntegrationNodeForm`: read `errorCode`/`errorHref` from `useWorkflowOptions` (extend the hook's return if it does not expose them — `OptionsField` already consumes them from the same fetcher data); when `errorCode === "reconnect"` render *"{app} is connected but needs to be reconnected before workflow steps can use it."* + button **Reconnect {app}** → `errorHref` (new tab); the existing "isn't connected yet / Connect {app}" branch stays for the truly-empty case.

### 5. Card health (`settings.server.ts` `getIntegrationHealth`)

After `status` is computed and before caching: if `status && PIECE_ALLOWLIST[integration.id]` → `rows = await readConnections(getCarbonServiceRole(), companyId, integration.id)`, `required = await requiredScopesFor(integration.id)`, `status = !rows.some(r => connectionUsable(r) && missingScopes(r, required).length > 0)`. Comment why it lives here (ee cannot see the allowlist).

### 6. Runner (`packages/jobs/src/workflows/actions/integration.ts`)

Before `getPieceAction`: `const missing = missingScopes(connection, await requiredScopesFor(pieceName)); if (missing.length > 0) { log missing; return { ok: false, error: reconnectCopy(label) } }` where
`reconnectCopy = (label) => \`The ${label} connection needs to be reconnected to grant the permissions this step uses — Settings → Integrations → ${label} → Accounts → Reconnect.\``.
In the run `catch`: if `/missing_scope|insufficient_scope|insufficient.?permission/i.test(message)` → same copy.

### 7. Allowlist

`google-calendar`: `metadata: { scopes: "scope" }`.

## Data Model Changes

None (reads `metadata.scopes` written by v2; revive now refreshes `metadata`).

## API / Service Changes

`grantedScopes`, `missingScopes` (ee); `requiredScopesFor` (jobs, exported from the barrel); loader payload `connections.requiredScopes`; provider `reconnect` error for under-scoped apps; health includes the scope check; runner pre-check + mapping.

## UI Changes

Accounts row: "Reconnect needed" badge + copy + Reconnect button (also for Expired/Revoked rows). Builder: connection field shows the existing reconnect message with "Fix this"; node banner gets a reconnect variant. Card: Unhealthy while under-scoped. All new UI copy through Lingui.

## Acceptance Criteria

1. `grantedScopes` parses `"a,b"` and `"a b"` to `["a","b"]`, returns `null` when absent; `missingScopes(c, ["a","c"])` → `["c"]`; unknown grants → `[]`.
2. `createConnection` on an existing name with `metadata: { scopes: "x" }` leaves the row with `metadata.scopes === "x"` (test in `connections.test.ts`).
3. `requiredScopesFor("slack")` has 16 unique scopes; `requiredScopesFor("google-calendar")` equals the piece's own `scope`.
4. Dev DB (backfilled workspace, 10 granted): Accounts row shows "Reconnect needed" + Reconnect; the builder's Slack node shows the reconnect banner, not "Connect Slack"; the Slack card reads Unhealthy; a run of a Slack step fails **without calling Slack** with the reconnect copy.
5. After clicking Reconnect and approving: same row id, `metadata.scopes` now the 16-scope grant, badge gone, dropdown lists the account, card Healthy, step runs.
6. A revoked Slack row also shows the Reconnect button and revives through it.
7. Google Calendar behaviour unchanged (no scopes recorded on existing rows → never flagged); a new GCal connection records `metadata.scopes`.
8. Typecheck (`@carbon/ee`, `@carbon/jobs`, `erp`) and tests (`ee`, `jobs`) green; `check:workflow-catalog` ok (catalog unchanged apart from the GCal metadata map, which the generator ignores).

## Risks

- A vendor that reports scopes in an unexpected format would read as "missing everything" → flagged wrongly. Mitigation: parser accepts commas and whitespace; the flag only fires when at least one *known* scope parsed.
- The health check now reads connections on every uncached health resolution for piece cards — one indexed query per card, bounded by the existing 5-minute healthy cache.

## Open Questions

- [x] Should an under-scoped account also flip the card badge? — **Answer:** yes, Unhealthy while any usable account is under-scoped (user, 2026-09-01).
- [x] Hide or flag under-scoped accounts in the builder dropdown? — **Answer:** hide, with the existing `reconnect` error state (precedent: revoked accounts are hidden; decided from codebase).

## Changelog

- 2026-09-01 — Draft.
- 2026-09-01 — Implemented; run log at `.ai/runs/2026-09-01-connection-reconnect-prompts.md`.
