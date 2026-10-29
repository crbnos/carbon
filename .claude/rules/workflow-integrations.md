---
paths:
  - "packages/jobs/src/workflows/integrations/**"
  - "packages/jobs/src/workflows/actions/integration.ts"
  - "packages/ee/src/integrations/connections.ts"
  - "packages/ee/src/integrations/connect.ts"
  - "packages/ee/src/integrations/piece-integration.ts"
  - "packages/ee/src/integrations/pieces.ts"
  - "packages/ee/src/google-calendar/**"
  - "apps/erp/app/routes/api+/integrations.connections*"
  - "apps/erp/app/routes/api+/workflows.options.ts"
  - "apps/erp/app/modules/settings/settings.service.ts"
  - "apps/erp/app/modules/settings/ui/Integrations/ConnectionsTab.tsx"
  - "apps/erp/app/modules/workflows/workflows.service.ts"
  - "apps/erp/app/modules/workflows/ui/Builder/fields/OptionsField.tsx"
  - "apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx"
  - "packages/ee/src/workflows/runtime/integration.ts"
---

# Workflow Integrations (Activepieces pieces)

Third-party steps inside the customer-facing Workflows feature — "create a Google Calendar
event" as an **integration** node, its own kind beside action and condition. The integration
code is not ours: each vendor is one published
[Activepieces](https://github.com/activepieces/activepieces) **piece** npm package.

Plan: `.ai/plans/2026-08-27-workflow-integrations.md`. Research:
`.ai/research/activepieces-integration-findings.md` and `.ai/research/activepieces-decisions.md`.
Specs of the later rounds: `.ai/specs/implemented/2026-08-31-workflow-integration-outputs.md`,
`2026-09-01-slack-workflow-piece.md`, `2026-09-01-gmail-workflow-piece.md`,
`2026-09-01-slack-single-source-of-truth.md`, `2026-09-01-connection-reconnect-prompts.md` and
`2026-09-04-integration-datetime-inputs.md` (same folder). Catalog: `workflow-event-catalog.md`.
Actions: `workflow-actions.md`.

## The split — the piece is a recipe, Carbon is the kitchen

A piece is one object: an auth **declaration** (the vendor's `authUrl` / `tokenUrl` /
`scope`) plus a set of actions, each being form-fields-as-data (`props`) and a `run()`
function. It contains **no UI, no database, no user model, no client id and no redirect
URI** — that omission is the whole boundary.

Carbon owns everything else: which company is connected, the OAuth app registered with the
vendor, the callback route, the encrypted token, the refresh and the lock around it.

## Curated, not a marketplace

`packages/jobs/src/workflows/integrations/allowlist.ts` is the single hand-written
declaration of what we expose — package, **exact** version, label, and the specific action
names. Not the piece: `getPieceAction` refuses an action the piece has but the allowlist
does not (`custom_api_call` is real and deliberately unreachable).

The ceiling is not engineering time. Every usable OAuth integration needs an app *we*
register and get verified with that vendor, so breadth is bounded by that. ~400 pieces
exist; the allowlist has three (Google Calendar, Slack, Gmail).

Versions are pinned exactly (`"0.10.3"`, no `^`) — an upstream release must never silently
change code we execute against a customer's account.

## An integration is its own NODE KIND, with its own catalog

`integration` is a workflow node type beside `trigger`, `condition`, `compute`, `lookup`,
`filter` and `action` — NOT an action. The node stores `{ piece, action, inputs }`; which
account it acts as is an ordinary input (`connectionId`), which is what lets the generic
options provider fill it like any other fetched list.

That separation is the point: `BuiltAction` has no `piece` field, `getActionRoute` returns
no piece, and `runAction` has no integration branch. An action is something Carbon does to
its own data, and nothing on that path has to ask whether it is really a vendor call.

Under a curated allowlist the set of steps cannot change at runtime, so they are emitted by
the ordinary build-time generator — not looked up per company.
`integrations/catalog.ts` `buildPieceActionDeclarations()` is the generator's sixth input,
and `buildCatalog` returns them as `built.integrations`, emitted as
`WORKFLOW_INTEGRATION_CATALOG` beside the action and operation maps. Both the generator and
the staleness check pass them the same way, so the check compares like with like.
Both validate them with the SAME input rules as an action — only how a step RUNS differs.

Ids are `integration.<piece>.<action>` —
`integration.google-calendar.create_google_calendar_event` — built by `integrationStepId`
in `@carbon/ee/workflows` (`definition/catalog.ts`), the one place that shape is written. Nothing parses an id: the
node holds `piece` and `action` separately, and `runIntegration` is handed the
`{ name, action }` block off the catalog entry.

Running one: `runtime/integration.ts` `integrationExecutor`, registered in
`runtime/executors.ts` like every other kind, resolves its inputs with `resolveStepInputs`
(`runtime/resolve.ts`, shared with `actionExecutor`) and calls `ctx.services.runIntegration`,
which `packages/jobs/src/workflows/actions/services.ts` implements over the existing
`actions/integration.ts`. A record in prose renders as a LINK only where the input's
catalog `links` declaration says the vendor renders one — Slack mrkdwn `<url|label>`,
Gmail `<a href>` gated on `body_type = html` — via `renderTemplate`'s per-dialect
renderers (`LINK_RENDERERS`) in `runtime/resolve.ts`, which also escape every other
value in that input for the dialect (`TEXT_ESCAPERS`); `linkState` (`definition/links.ts`)
is the one verdict, for the run and the builder hint alike. Everywhere else a record stays its plain name, and the
builder says so with a muted one-liner under the field (`definition/notices.ts`
`fieldNotices` → the store's `notices` → `Field`'s `hint`; copy in `noticeCopy.ts`).

In the builder it is one **Integration** palette entry, not one per vendor — you drop the
node, then pick the app and the step inside it. `config/forms/IntegrationNodeForm.tsx`
does that; `config/forms/StepInput.tsx` renders the inputs and is SHARED with `ActionForm`,
so the two kinds cannot drift apart as input kinds are added.

Picking the app is GATED on that app being connected: the form calls `useWorkflowOptions`
— the SAME hook `OptionsField` uses, so the "is this connected?" question and the connection
dropdown cannot disagree about how a provider is called (notably about `dependsOn`, which a
hand-rolled second fetcher was free to forget) — and an app with no connection renders one
"Connect …" button (to `path.to.integration(piece)`, in a new tab so the canvas survives)
instead of the step picker and inputs. Every step of an app shares one connection input, so
the FIRST step of the app answers for it — which is what lets the question be asked before a
step has been picked. The provider is read off that input rather than named in the builder,
so this stays a fetched list like any other. `INTEGRATION_CONNECTION_INPUT` is declared in
`@carbon/ee/workflows` (`definition/catalog.ts`) because both sides need it; `integrations/options.ts`
re-exports it as `CONNECTION_INPUT` (not part of the `@carbon/jobs/integrations` barrel).

Both scripts are `async function main()` wrappers rather than top-level `await`: `tsx`
transpiles them to CJS, which rejects it, and reading a piece's actions needs a dynamic
import.

## Property mapping — refuse, never degrade

`integrations/properties.ts` `toValueType` maps a piece property to a Carbon `ValueType`:

| Piece `type` | Carbon |
|---|---|
| `SHORT_TEXT` | `t.string` |
| `LONG_TEXT` | `t.string` + `template: true` — the multiline editor with inline variables, as Carbon's own message bodies get |
| `NUMBER` | `t.number` |
| `CHECKBOX` | `t.boolean` |
| `DATE_TIME` | `t.date` |
| `ARRAY` | `t.list(t.string)` — in the builder a chip field — type an entry, Enter, repeat — so "several recipients" is visible; STORED as a list (`fields/control.ts` `isWritableList`); a whole list from an earlier step is still `{` |
| `STATIC_DROPDOWN` | `t.string` + `choices` |
| `STATIC_MULTI_SELECT_DROPDOWN` | `t.list(t.string)` + `choices` |
| `DROPDOWN` | `t.string` + an `options` source |
| `MULTI_SELECT_DROPDOWN` | `t.list(t.string)` + an `options` source |

Anything else (`OBJECT`, `JSON`, `FILE`, `DYNAMIC`, …) throws `UnmappablePropertyError`
naming the piece, action and property. That **fails the generator**, which writes no files.
A half-described action must never reach a customer's canvas.

`toPropsValue` is the inverse at run time: ONE pass over the piece's own props, so a prop
the action no longer declares is never sent. Per prop, `visibilityOf` gives the pin (a hidden
prop's value, or a shown prop's allowlist `value`). An omitted prop sends its pin and nothing
else; otherwise a node value wins and the pin fills in only where the node supplied nothing
(an emptied multi-select counts as nothing). An absent optional input is **omitted**, not sent
as `null` — pieces branch on `undefined`.

## Connections — a new table, not `companyIntegration`

`companyIntegration` has composite PK `("id", "companyId")`: one row per integration per
company. A company may connect several Google accounts, so integration connections get
their own table.

`integrationConnection` (`20261026151302_workflow-integration-connections.sql`) —
`id('icn')`, `companyId`, `pieceName`, `name`, `authType`, `accountLabel`, `metadata`,
`secretRef`, `expiresAt`, `refreshingAt`, `status`, `lastError` + audit columns. Unique on
`(companyId, pieceName, name)`. RLS is `settings_view` to read and NO API-role writes
(`20261026151306`): a user-written row could claim another company's Slack `team_id` or
point `secretRef` anywhere. Every write — create, rename, disconnect, revoke — goes
through the service role, scoped by `companyId`. Rename and Disconnect are the service
functions `renameIntegrationConnection` / `disconnectIntegrationConnection`
(`settings.server.ts`, `update: settings`, not published); each reads the row by
`ctx.company.id` first, and Disconnect takes the piece from it to drop that card's health
cache.
`get_connection_secret` reads the vault by name (`connection:<companyId>:<id>`), never by
`secretRef`.

**The existing vault RPCs could not be reused** — `upsert_integration_secret` and friends
are hard-wired to `companyIntegration` and the `'integration:'` name prefix. The same
migration adds three parallel `*_connection_secret` RPCs with a `'connection:'` prefix, plus
a delete trigger (vault does not cascade). Two RPCs keep the row and its secret in step:
`save_connection` inserts or revives the row and writes the secret in one statement
(`createConnection`), and `revoke_connections` drops the secrets and marks the rows Revoked
in one statement. All of them are `service_role` only.

`packages/ee/src/integrations/connections.ts` is the service. **Tokens live in the vault and
never in `metadata`** — `connectionMetadataFrom` copies only the allowlist row's listed
paths, and `integrations/oauth.test.ts` (jobs) asserts no token reaches it.

`disconnectConnection(serviceRole, companyId, pieceName, connectionId, updatedBy)` (one
connection) and `revokeConnectionsForPiece` (every non-Revoked one of a piece) both call
`revoke_connections`, so the token and the status change together. Both **keep the row**:
a saved workflow node references the id, and a dangling id produces a worse error than a
clear "reconnect this".

A consent that lands on an existing row must be the SAME account. Reconnect carries the
row's id in the OAuth state; Add account and Install name the row by its unique name.
`createConnection` compares the stored and the new identity (Slack's `team_id`, else the
`accountLabel`) and refuses a different one — `ConnectionAccountMismatchError` for
Reconnect, `ConnectionNameTakenError` for a name. Without that check, every saved
workflow on the row silently started acting as whoever signed in. When either side has
no identity (the label read failed), the consent is accepted, and `save_connection` keeps
the stored `accountLabel` (a NULL label never overwrites it, or the check would pass for
anyone from then on). Card Install names the account after the card (`entry.label`), and an
earlier Uninstall leaves a Revoked row under that name: the callback passes
`renameIfTaken`, so a different account takes the next free name ("Gmail 2") instead of
`duplicate-name`. A name the user typed is still refused.

A vendor workspace belongs to ONE company. Before it saves, `createConnection` reads every
company's rows of that piece with the same `metadata.team_id` (`readConnectionsByTeamId`, the
one cross-company read) and refuses with `ConnectionWorkspaceTakenError` when a usable one
belongs to another company; the callback answers the `workspace-taken` code. An inbound Slack
event names only its workspace, so a shared one could not be routed:
`getSlackWorkspaceByTeamId` throws `AmbiguousSlackWorkspaceError` rather than pick. No unique
index spans companies, so the check is not race-proof.

### Scope drift — "Reconnect needed"

A connection records what the vendor granted in `metadata.scopes` (from the token response's
`scope`, declared on the allowlist row's `metadata` map; Slack's is comma-separated, the v2
backfill wrote spaces). `missingScopes(connection, required)` (ee, pure) compares it with
`requiredScopesFor(piece)` (jobs — the row's `oauth.scope` override or the piece's own list,
i.e. exactly what `buildConsentUrl` asks for). Unknown grants are never flagged. Four surfaces
say the same thing: the Accounts row ("Reconnect needed" + a **Reconnect** button that re-runs
the consent for that row's id — `createConnection` revives the row and refreshes its
metadata, and refuses with `ConnectionAccountMismatchError` when a different account
signed in), the builder (the connection provider returns `errorCode: "reconnect"` instead of
listing an under-scoped account, and `IntegrationNodeForm` shows a reconnect banner), the card
(`getIntegrationHealth` marks a piece card unhealthy while any usable account is under-scoped —
checked in erp because ee cannot see the allowlist), and the step runner (fails before the
vendor call with copy naming Settings → Integrations → App → Accounts → Reconnect, and maps a
vendor `missing_scope` to the same words).

**Google verification does a string match.** An app's registered scopes (Cloud Console → Data
Access) must equal what it actually sends in `scope=`, and any scope broader than the calls the
app makes is refused. So a Google row's `oauth.scope` is the narrowest scope per endpoint, and
changing it is never code-only: the Console list changes with it and a new consent-flow video
has to demonstrate every scope. Calendar asks for `calendar.events` (create + list events on the
chosen calendar) and `calendar.calendarlist.readonly` (name the calendars in the picker) — NOT
the piece's `calendar.readonly`, which reads every event on every calendar. Verification bounced
on exactly that in Sept 2026.

Gmail is deliberately **send-only** (`gmail.send` + `email`, an allowlist `oauth.scope`
override). The piece's own list adds `gmail.readonly` and `gmail.compose`, which Google
classes as *restricted*: an app holding them must pass an annual third-party CASA security
assessment before non-test users can consent. So the row omits `in_reply_to` (needs
`messages.list`), pins `draft` off (needs `drafts.create`) and omits `attachments` (file
objects — no Carbon input type yet). Widening to read/reply is a compliance decision first.
Spec: `.ai/specs/implemented/2026-09-01-gmail-workflow-piece.md`.

### The refresh claim

Two workflow steps hitting an expiring token would both refresh and one would clobber the
other. A Postgres advisory lock cannot fix it — it releases at the RPC's transaction end,
which is before the token exchange finishes. So `resolveConnectionAuth` claims the refresh
with a conditional UPDATE on `refreshingAt` (`IS NULL OR < NOW() - 30s`) and the loser polls
for the winner's token (250 ms × 20). Google omits the refresh token on a refresh response,
so the stored one is carried forward rather than overwritten with `undefined`.

A disconnect or uninstall can land while a refresh is in flight. `upsert_connection_secret`
locks the row and writes only onto an Active one (else `no_data_found`, which
`writeTokens` turns into `ConnectionRevokedError`), the settle UPDATE matches `status =
'Active'` only, and `markExpired` never touches a Revoked row. So a revoked account stays
revoked.

## Who reads the token

The vault RPCs are `service_role` only, so a user client cannot decrypt a token at all.
`resolvePieceAuth(serviceRole, companyId, pieceName, connectionId)` (`integrations/piece-auth.ts`)
is the ONE copy of "read the row, check it is this piece's, check its scopes, refresh it",
shared by `runIntegrationAction` and the builder's property options (`workflows.service.ts`).
It returns `{ ok: true, accessToken }` or a `reason` each caller words: `no-connection` (another
company's or another piece's row), `missing-scopes`, `refreshing`, `reconnect`,
`misconfigured` (the OAuth app, not the account) or `failed`. Both callers pass
`getCarbonServiceRole()` and a `companyId` from the run or the request.

Do not move the row read to the owner's client. The row's RLS asks for `settings_view`,
but the builder lists connections with the service role to anyone who can edit workflows
(`OPTIONS_PROVIDERS`, `workflows.service.ts`). An owner-client read refused a connection the author was
allowed to pick, so every run failed with "This step needs a connection." The tenancy
guarantee is the `companyId` filter: it comes from the run row, never from the definition.

Outside a workflow step, a vendor whose tokens never expire (Slack bot tokens) is read with
`readConnectionAccessToken(serviceRole, connection)`, which takes the row the caller already
read (`id`, `companyId`, `status`, `expiresAt`), so its guard judges exactly the connection the
caller picked. It refuses a non-usable connection and one whose `expiresAt` is inside the
refresh window — a refreshable vendor must
go through `resolveConnectionAuth`, which owns the refresh claim.

## OAuth round trip

- `api+/integrations.connections.$piece.connect.ts` — builds the consent URL with
  `buildConsentUrl` from the piece's own `authUrl`/`scope` (or the row's overrides) plus the
  app `resolveOAuthApp(piece)` returns.
  `access_type=offline` **and** `prompt=consent`: without both,
  Google returns no refresh token on a re-authorization. Returns `{ url }` like the Slack
  install route; the client opens a popup.
- `api+/integrations.connections.callback.ts` — the vendor redirects the browser here, so a
  failure redirects to the integrations page with an error **code** (the `connection` key in
  `integration-errors.ts`), never JSON and never the vendor's own message.

**The `state` is the cookie-bound one every OAuth integration uses**
(`@carbon/auth/oauth-state.server`). The connect route calls `issueOAuthState` with the
piece name as the integration id, plus the account `name` and, for Reconnect, the
`connectionId` (`OAuthStateExtras`), and returns its Set-Cookie on the `{ url }` response
(`startIntegrationConnect` fetches it same-origin, so the browser keeps the cookie). One
redirect URI serves every piece, so the callback cannot know the piece before it reads the
state: `consumeOAuthStateByValue` finds the pending entry holding that value, checks its
user, company and expiry against the session, and removes it, leaving other integrations'
entries alone. The piece, name and connection id come only from a valid entry, and every
reply carries the rewritten cookie. That binding is what stops a token being planted into
another company's connection — it must never be reduced to a bare query parameter. One
pending entry per piece: a second connect for the same account reuses a still-fresh state,
and a connect for another account (other extras) replaces it.
Malformed callbacks log parameter **names only**: `code` is a live credential.

## The host shim

`integrations/context.ts` `buildPieceContext` supplies the context a piece's `run()`
declares — `auth`, `propsValue`, plus `store`, `connections`, `project`, `flows`, `step`,
`files`. Every stub **throws** rather than returning empty: a piece that genuinely needs one
must fail loudly in development, not misbehave in production.

## Where piece code may live

`registry.ts` is the ONLY module that imports a piece package. Code outside `@carbon/jobs`
reaches it through the `@carbon/jobs/integrations` subpath, which is **server-only** (the
catalog scripts import `integrations/catalog.ts` and `allowlist.ts` by path). Pieces bundle
Node vendor SDKs, and `packages/ee/src/workflows` is bundled for the browser — it must
never see piece code. `piece-auth.ts` imports `@carbon/ee/integrations/connections`, the
deep subpath, because the `@carbon/ee` root barrel pulls in integration config files whose
`msg` macro is untransformed outside a Vite build (the root barrel no longer re-exports the
connections service at all).

## Fetched choices are a GENERIC catalog feature, not an integration one

An input whose values are only knowable at edit time carries an `OptionsSource`
(`packages/ee/src/workflows/definition/catalog.ts`) in place of `choices`:

```ts
options?: { provider: string; params?: Record<string, string>; dependsOn?: readonly string[] }
```

`provider` names a resolver, **never an integration**. `params` are fixed arguments decided
when the catalog is built; `dependsOn` names sibling inputs whose current values the
resolver needs, and the field stays unfetched until every one of them holds a value. There
is deliberately no boolean flag and no piece-shaped field anywhere on this path — a list
backed by Carbon's own data is the same declaration with a different `provider`.

Three parts, and only the last knows what a provider id means:

- `fields/OptionsField.tsx` — one field for every fetched list. It receives the provider id,
  the params and the dependency values, and renders a `Combobox` (or `MultiSelect` for a list
  type). `ActionForm` keys it on `${name}:${dependency values}`, so changing account remounts
  it — a calendar id from one account is meaningless in another. An empty list plus an
  `emptyHref` renders a link out rather than a dropdown the author cannot act on.
- `api+/workflows.options.ts` — provider-agnostic. It looks the provider up, applies **that
  provider's declared permission**, and returns `{ options, emptyHref? }`. An unknown
  provider still passes through `workflows_view` first, so it is not an unauthenticated
  probe. A failure never echoes the resolver's own message.
- `OPTIONS_PROVIDERS` in `modules/workflows/workflows.service.ts`, the only module that
  knows what a provider id means. Two entries today, both from
  `@carbon/jobs/integrations`'s `options.ts` constants: `integration.connection`
  (`workflows_view`, lists the company's connections) and `integration.property`
  (`workflows_update` — the same permission the action carries, so it cannot reach a vendor a
  user could not otherwise call — runs the piece's own `options()`).

Adding a Carbon-backed dropdown is one registry entry plus an `options` block on the input.
It touches neither the endpoint nor the field.

`build.ts` refuses an input that both fetches and lists its values, and one whose `dependsOn`
names an input the action does not have.

## The settings UI is the ordinary integration card

A piece is a NORMAL integration: `packages/ee/src/google-calendar/config.tsx` calls
`definePieceIntegration(piece, card)` (`integrations/piece-integration.ts`), an ordinary
`defineIntegration` in the ordinary `integrations` array, rendering the ordinary
`IntegrationCard` in the ordinary grid. There is no separate panel. The helper sets the `id`
to the piece name (so nothing has to map between the two), the logo, no settings and an
`onClientInstall` that calls `startIntegrationConnect`; the config supplies only the name,
category, `active`, and the two descriptions.

- `active: !!GOOGLE_CLIENT_ID` — an unconfigured server shows "Coming soon", the same
  as any other integration missing its credentials. (`GOOGLE_CLIENT_ID` is therefore in
  `getBrowserEnv()`; it is a public client id, never the secret.)
- `settings: []` and `schema: z.object({})` (set by `definePieceIntegration`), so the drawer
  shows no settings form and no Submit. Install runs `onClientInstall` → the connect route → the consent popup, exactly
  like Onshape and Slack.
- The callback calls **`markIntegrationInstalled`** with the service role (an RLS insert
  would need settings create; the route requires settings update, like every install),
  which inserts the `companyIntegration` row if absent or re-activates it, and **never
  overwrites metadata**. A new Slack install (not a Reconnect) then posts a welcome message
  in the webhook channel picked on the consent screen (`postSlackWelcome`, best-effort). That row is what
  "Installed" means to the grid; without it the card would keep offering Install for an
  already-connected account.
- **Slack's card IS the piece card.** The Carbon Assistant (slash commands, issue threads,
  notification fan-out) is a *consumer* of the company's Slack connection: `getSlackWorkspace`
  returns the OLDEST usable `slack` connection that carries a webhook channel, else the
  oldest usable one (token from the vault, `team_id` /
  `channel_id` / `bot_user_id` from its metadata) and `getSlackWorkspaceByTeamId` matches an
  inbound slash command to its workspace. One consent — the allowlist row's `scope` is the
  union of Assistant and workflow scopes — installs both. `companyIntegration.slack` holds no
  token and no workspace facts; the Assistant's private `@slack/oauth` install flow and
  `SLACK_STATE_SECRET` are gone. `SLACK_OAUTH_REDIRECT_URL` keeps its name and may keep its
  deployed value: `api+/integrations.slack.oauth.ts` is now a 302 forwarder onto the
  connections callback, so no environment or Slack-app redirect change is needed to ship. Migration
  `20261026151304_slack-connections-single-source.sql` backfilled existing installs. The
  builder's "Connect …" link deep-links to `?tab=connections`.
- `ui/Integrations/ConnectionsTab.tsx` is an `IntegrationFormTab` ("Accounts") on that card,
  listing the connected accounts with rename, Disconnect and Add account. It is the ONE place
  this integration differs from the others, and only because a workflow step picks which
  account it runs as.
- Uninstall goes through the standard deactivate route, whose `onUninstall` hook calls the
  generic `revokeConnectionsForPiece` — otherwise the uninstall would leave live tokens the
  customer can no longer see. `hooks.server.ts` builds that hook for every entry of
  `ACTIVEPIECES_PIECES` (`pieceHooks`), so a new piece needs no hooks entry and no hooks
  FILE: the behaviour is identical for every piece.
- The card and the Details drawer read the same install checks (`useInstallGate`): a
  withheld (coming soon) install, a provider role another integration holds, and a mode to
  choose. The drawer offers Install only when none applies; opened by URL it used to
  install past all three.
- Both Install (the card) and Add account (the drawer) go through
  `integrations/connect.ts` `startIntegrationConnect`, so the two entry points cannot
  drift into different failure behaviour. It opens the popup with `beginOAuthPopup`
  (`oauth-popup.ts`) inside the click, before the fetch, and throws an
  `IntegrationConnectError` carrying the connect route's `connection` code, which
  the UI words through `integration-errors.ts`.

## A vendor is named in ONE place, on the workflow side

`allowlist.ts` carries everything the workflow side needs, so no shared file has a
`if (pieceName === …)` in it. (A vendor still has its own `defineIntegration` card and its
three env vars in `@carbon/env` — see the checklist below.) Beyond the package and the
action names, a row declares:

- `label` — the app's OWN name. The generator emits it as the `integration.<piece>` label,
  so the builder reads it like any other catalog string, translated. Nothing derives a name
  by title-casing the package slug: that is only ever right by accident ("Hubspot",
  "Github", "Zoho Crm").
- `version` — the EXACT installed version. `assertPinnedVersions` compares it against
  `packages/jobs/package.json` from the catalog check, so the field is a gate rather than a
  comment.

- `oauth` — the **NAMES** of the three env vars holding Carbon's app for that vendor, never
  the values (this module is imported by build-time catalog scripts). `resolveOAuthApp` in
  `integrations/oauth.ts` reads them through `getEnv` and throws
  `No OAuth app is configured for ${pieceName}.` if any is unset — a half-configured vendor
  must fail before a customer reaches a consent screen that cannot come back. Optional
  `authUrl` and `scope` **override the piece's own**: Slack's piece bakes `user_scope=` (a
  personal user token) into its URL and asks for 30 bot scopes, and we request sixteen: the
  ten the Carbon Assistant already used plus the six the four workflow actions need. `buildConsentUrl` (same file) is the one place the URL is assembled;
  the connect route only calls it.
- `accountLabel` — optional `{ url, field }` (a GET on the vendor's identity endpoint) or
  `{ path }` (a dot path into the token response — Slack's `team.name`) for reading back
  which account authorized, so two connections are tellable apart. The callback's
  `accountLabelFor` is best-effort: a failure there must never lose a connection that
  already authorized.
- `metadata` — optional `{ metadataKey: tokenResponsePath }`: workspace facts to keep on the
  connection's `metadata` column. Slack's response carries `team.id`, `bot_user_id` and the
  `incoming_webhook` channel the person picked; `connectionMetadataFrom` copies exactly the
  listed paths and nothing else, so a token can never land there.

**Only OAuth2 pieces are supported.** `getPieceOAuth2Auth` refuses `SECRET_TEXT`,
`BASIC_AUTH` and `CUSTOM_AUTH` with `UnsupportedPieceAuthError`. That is deliberate and
commented in both files: an API-key piece needs a credential form instead of a consent
screen, no callback route and no refresh cycle, which is its own work rather than a branch
in this path.

## Adding a piece

1. `pnpm --filter @carbon/jobs add @activepieces/piece-<name>@<exact version>`
2. Add the entry to `PIECE_ALLOWLIST`: the exact `version` (no range — `assertPinnedVersions`
   compares it to package.json from the catalog check), `label` (the app's own name, which
   the generator emits as the `integration.<piece>` label — do NOT expect it to be derived
   from the slug), action names, the three `oauth` env var names, and `accountLabel` if the
   vendor has such an endpoint. Spell every scope the way the vendor REPORTS it granted —
   for Google that is the full `https://www.googleapis.com/auth/…` URL, never the `email`
   alias the pieces use — or the account reads "Reconnect needed" from its first second.
3. Register the OAuth app with the vendor and set those env vars (add them to
   `.env.example` too).
4. If the card is new: add the client id to `getBrowserEnv()` and the `Window.env`
   declaration in `packages/env/src/index.ts`. That list is fixed and cannot be looked up by
   name, and the settings card reads it client-side to decide "Coming soon" — this is the one
   step the allowlist row cannot carry for you. (Skip when the card already exists and is
   already gated, as Slack's is.)
5. Add the piece name to `ACTIVEPIECES_PIECES` (`packages/ee/src/integrations/pieces.ts`) —
   the allowlist's `Record` then refuses to compile until both agree, and `hooks.server.ts`
   gives the piece its uninstall hook from that list. Add a config that calls
   `definePieceIntegration("<piece>", { name, category, active, shortDescription, description })`
   and register it in the `integrations` array. **And a migration inserting the `integration` row** (`INSERT INTO "integration" ("id",
   "jsonschema") VALUES ('<piece>', '{"type": "object", "properties": {}}'::json) ON CONFLICT DO
   NOTHING`): `companyIntegration.id` is an FK to `integration.id`, so without it
   `markIntegrationInstalled` fails the callback with a bare PostgREST error after the token
   is already in the vault. The `INSERT INTO "integration"` at the end of
   `20261026151302_workflow-integration-connections.sql` is the shape (one row per piece).
6. Check every action you expose ships an `outputSchema` — the generator refuses one
   that does not, and coverage is all-or-nothing per piece. Then run the generator and read
   its refusals: each unmappable prop is a decision — `omit` it (optional, or required with
   a `value`) or drop the action.
7. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog`.

Step 3 is the real work and the real gate. The rest takes minutes — but none of the first
three pieces connected on the first try. The numbered **WHAT BIT US** block above
`PIECE_ALLOWLIST` in `allowlist.ts` is the list of exactly how each one failed (missing
`integration` row, Google scope aliases, Slack's `user_scope=`, unsent required defaults,
refresh-token conditions, PostgREST errors that log as empty, `window.env` gating, the
release-age policy, single-reader tokens, `markIntegrationInstalled`, test env). Read it
before step 1.

## Outputs come from the piece's own `outputSchema`

`integrations/outputs.ts` `describeOutputs` maps an action's `outputSchema` to Carbon
`ValueType`s, and keeps each output's declared field beside its type:
`listItems` → `list<record>`, `children` → a nested `record`, `format` → a primitive
(`datetime`/`number`/`boolean`; everything else is text). A `dynamicKey` field is
**omitted** — the vendor is declaring its keys cannot be enumerated, so naming one
would be a guess. An array inside an array is dropped too: `list.of` takes only a
scalar, so `list<list<T>>` has no representation.

Every step also gets `count` (a list's length — `compare` has no "is empty" operator,
so branching on "did anything come back?" needs it) and `result`, the raw JSON, kept
so already-saved workflows keep working and so a field the schema missed stays
reachable.

**An action with no `outputSchema` fails the generator** (`UnmappableOutputError`),
exactly as `UnmappablePropertyError` refuses an unmappable input. Coverage is
all-or-nothing per piece — ~100% on Google Calendar, Sheets, Airtable, Notion, GitHub
and Slack; **0%** on HubSpot, Salesforce, Jira, Shopify, Excel 365 and Xero — so this
is caught when a piece is allowlisted, never by a customer.

`outputSchema` is **authoring-time metadata, not a contract**: upstream scopes it to
presentation, `run()` returns `Promise<unknown | void>`, and nothing validates a
response against it. So `integrations/project.ts` shapes the real response field by
field: `readField` reads each declared field from its own path (`value`, else `key`) at
every depth, inside `children` and `listItems` too, and `fromJson` (`@carbon/ee/workflows`,
`runtime/values.ts`) coerces it against the declared type, strictly by `typeof`, so
anything absent or mistyped is `null`. It never throws, because a vendor disagreeing with
its own schema must not fail a step that really did call it.

## The form shows a curated subset

`integrations/visibility.ts` decides which props a person sees. Two generic rules cost
nothing per action and apply to every piece: a prop that is **required AND already has a
`defaultValue`** is hidden (nothing to decide — omitting it lets the piece apply its own
default), as is a dropdown with **exactly one** possible value. The allowlist's optional
`props` block is the rare exception, for a vendor default that is *wrong for us* rather
than merely uninteresting — `google_calendar_get_events.singleEvents` is the one case
today: it defaults to `false`, and an unexpanded recurring event carries the SERIES start
date, so "events tomorrow" silently misses every recurring meeting.

A pinned `value` is merged in by `toPropsValue` **at run time**, never stored on the node,
so changing a pin fixes every existing workflow at once. A node value always wins over a
pin — otherwise the Advanced section would be a lie.

`template: true` is the third override: prose the vendor declared a `ShortText` (Gmail's email
`body`) gets the multiline editor a `LongText` gets automatically. Without it the body of an
email is a one-line box.

`links` is the fourth: this prose reaches the vendor in a dialect that renders links
(`format: "slack" | "html"`, optionally gated by `when: { input, equals }` on a sibling
input — Gmail links only an html body). It asserts how THIS vendor renders text, so it is reviewed and
pinned like `omit`. Carbon's own Notify declares the same thing as `links: { format:
"markdown" }` in `catalog/actions.ts`; the old `linkify` flag is gone.

`omit: true` is the stronger override: the prop is in **neither** map. It is for a prop
whose non-default value needs a host capability the shim refuses (`mentionOriginFlow` reads
the flow context; `sendAsBot: false` needs a user token we do not request) or a type Carbon
cannot render (`FILE`, `JSON`). A pinned `value` is still sent at run time, and a required
prop must carry one (`sendAsBot: { omit: true, value: true }`). `MARKDOWN` props are omitted
automatically — Activepieces `Property.MarkDown` is help text and never collects a value.
Everything else unmappable still **fails the generator**: omission is a reviewed decision on
the allowlist, never a silent drop. The generator consults visibility BEFORE `toValueType`,
so a type is only ever an error for a prop a person would see.

Hidden inputs are emitted as **`advancedInputs`**, a second map beside `inputs`, and
rendered in the node's collapsed "Advanced properties" section. They are separate maps on
purpose: every `required` check and the validator itself iterate `inputs`, so a
hidden-but-present required input would have the validator demand a field the author was
never shown. A required prop hidden with no value to send — from us or from the piece —
**fails the generator**.

The connection field is hidden when the company has exactly one connection, but the id is
still **stored on the node**: a second account added later must not silently repoint every
existing workflow.

## Non-goals (v1)

Triggers (a piece's `triggers` need a webhook enable/disable lifecycle) and non-OAuth2
auth (`SECRET_TEXT`, `BASIC_AUTH`, `CUSTOM_AUTH`).
