paths:
  - "packages/jobs/src/workflows/integrations/**"
  - "packages/jobs/src/workflows/actions/integration.ts"
  - "packages/ee/src/integrations/connections.ts"
  - "packages/ee/src/google-calendar/**"
  - "apps/erp/app/routes/api+/integrations.connections*"
  - "apps/erp/app/routes/api+/workflows.options.ts"
  - "apps/erp/app/modules/settings/connection-state.server.ts"
  - "apps/erp/app/modules/settings/ui/Integrations/ConnectionsTab.tsx"
  - "apps/erp/app/modules/workflows/options-providers.server.ts"
  - "apps/erp/app/modules/workflows/ui/Builder/fields/OptionsField.tsx"
  - "apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx"
  - "packages/workflows/src/runtime/integration.ts"

# Workflow Integrations (Activepieces pieces)

Third-party steps inside the customer-facing Workflows feature — "create a Google Calendar
event" as an **integration** node, its own kind beside action and condition. The integration
code is not ours: each vendor is one published
[Activepieces](https://github.com/activepieces/activepieces) **piece** npm package.

Spec: `.ai/specs/2026-08-27-workflow-integrations.md`. Research:
`.ai/research/activepieces-integrations.md`. Catalog: `workflow-event-catalog.md`.
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
exist; the allowlist has one.

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
in `@carbon/workflows`, the one place that shape is written. Nothing parses an id: the
node holds `piece` and `action` separately, and `runIntegration` is handed the
`{ name, action }` block off the catalog entry.

Running one: `runtime/integration.ts` `integrationExecutor`, registered in
`runtime/executors.ts` like every other kind, calls `ctx.services.runIntegration`, which
`packages/jobs/src/workflows/actions/services.ts` implements over the existing
`actions/integration.ts`. Nothing linkifies: a vendor's field is not Carbon prose.

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
`@carbon/workflows` (`definition/catalog.ts`) because both sides need it; `integrations/options.ts`
re-exports it as `CONNECTION_INPUT`.

Both scripts are `async function main()` wrappers rather than top-level `await`: `tsx`
transpiles them to CJS, which rejects it, and reading a piece's actions needs a dynamic
import.

## Property mapping — refuse, never degrade

`integrations/properties.ts` `toValueType` maps a piece property to a Carbon `ValueType`:

| Piece `type` | Carbon |
|---|---|
| `SHORT_TEXT`, `LONG_TEXT` | `t.string` |
| `NUMBER` | `t.number` |
| `CHECKBOX` | `t.boolean` |
| `DATE_TIME` | `t.date` |
| `ARRAY` | `t.list(t.string)` |
| `STATIC_DROPDOWN` | `t.string` + `choices` |
| `STATIC_MULTI_SELECT_DROPDOWN` | `t.list(t.string)` + `choices` |
| `DROPDOWN` | `t.string` + an `options` source |
| `MULTI_SELECT_DROPDOWN` | `t.list(t.string)` + an `options` source |

Anything else (`OBJECT`, `JSON`, `FILE`, `DYNAMIC`, …) throws `UnmappablePropertyError`
naming the piece, action and property. That **fails the generator**, which writes no files.
A half-described action must never reach a customer's canvas.

`toPropsValue` is the inverse at run time. An absent optional input is **omitted**, not sent
as `null` — pieces branch on `undefined`.

## Connections — a new table, not `companyIntegration`

`companyIntegration` has composite PK `("id", "companyId")`: one row per integration per
company. A company may connect several Google accounts, so integration connections get
their own table.

`integrationConnection` (`20260827044707_workflow-integration-connections.sql`) —
`id('icn')`, `companyId`, `pieceName`, `name`, `authType`, `accountLabel`, `metadata`,
`secretRef`, `expiresAt`, `refreshingAt`, `status`, `lastError` + audit columns. Unique on
`(companyId, pieceName, name)`. RLS is the `companyIntegration` shape: `settings_view` to
read, `settings_{create,update,delete}` to write.

**The existing vault RPCs could not be reused** — `upsert_integration_secret` and friends
are hard-wired to `companyIntegration` and the `'integration:'` name prefix. The migration
adds three parallel `*_connection_secret` RPCs with a `'connection:'` prefix, plus a delete
trigger (vault does not cascade). All three are `service_role` only.

`packages/ee/src/integrations/connections.ts` is the service. **Tokens live in the vault and
never in `metadata`** — `connections.test.ts` asserts that directly.

`disconnectConnection` drops the token and sets `status = 'Revoked'` but **keeps the row**:
a saved workflow node references the id, and a dangling id produces a worse error than a
clear "reconnect this".

### The refresh claim

Two workflow steps hitting an expiring token would both refresh and one would clobber the
other. A Postgres advisory lock cannot fix it — it releases at the RPC's transaction end,
which is before the token exchange finishes. So `resolveConnectionAuth` claims the refresh
with a conditional UPDATE on `refreshingAt` (`IS NULL OR < NOW() - 30s`) and the loser polls
for the winner's token (250 ms × 20). Google omits the refresh token on a refresh response,
so the stored one is carried forward rather than overwritten with `undefined`.

## Who reads the token

The vault RPCs are `service_role` only, so a user client cannot decrypt a token at all.
`runIntegrationAction` therefore does BOTH:

1. checks the connection exists in this company **through the owner's client** — RLS applies
   to that lookup, and the piece name must match;
2. reads the token with `getCarbonServiceRole()`, scoped by the run's own `companyId`.

Same guarantee `resolveIntegrationSecrets` already gives the 12 existing integrations. Do
not "simplify" this to one client: the owner's client cannot read the secret, and the
service-role client alone would skip the tenancy check.

## OAuth round trip

- `api+/integrations.connections.$piece.connect.ts` — builds the consent URL from the
  piece's own `authUrl`/`scope` plus the app `resolveOAuthApp(piece)` returns.
  `access_type=offline` **and** `prompt=consent`: without both,
  Google returns no refresh token on a re-authorization. Returns `{ url }` like the Slack
  install route; the client opens a popup.
- `api+/integrations.connections.callback.ts` — the vendor redirects the browser here, so a
  failure redirects to the integrations page with an error **code** (the `connection` key in
  `integration-errors.ts`), never JSON and never the vendor's own message.

**The `state` is HMAC-signed and verified** (`connection-state.server.ts`, keyed on
`SESSION_SECRET`, 10-minute lifetime), and the callback additionally re-checks its
`companyId` against the session. That signature is what stops a token being planted into
another company's connection — it is not decoration, and must never be reduced to a bare
query parameter. Malformed callbacks log parameter **names only**: `code` is a live
credential.

## The host shim

`integrations/context.ts` `buildPieceContext` supplies the context a piece's `run()`
declares — `auth`, `propsValue`, plus `store`, `connections`, `project`, `flows`, `step`,
`files`. Every stub **throws** rather than returning empty: a piece that genuinely needs one
must fail loudly in development, not misbehave in production.

## Where piece code may live

`registry.ts` is the ONLY module that imports a piece package, and everything else reaches
it through the `@carbon/jobs/integrations` subpath, which is **server-only**. Pieces bundle
Node vendor SDKs, and `packages/workflows` compiles for the browser at ES2019 — it must
never see piece code. `integration.ts` imports `@carbon/ee/integrations/connections`, the
deep subpath, because the `@carbon/ee` root barrel pulls in integration config files whose
`msg` macro is untransformed outside a Vite build.

## Fetched choices are a GENERIC catalog feature, not an integration one

An input whose values are only knowable at edit time carries an `OptionsSource`
(`packages/workflows/src/definition/catalog.ts`) in place of `choices`:

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
- `modules/workflows/options-providers.server.ts` — `OPTIONS_PROVIDERS`, the only module that
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

A piece is a NORMAL integration: `packages/ee/src/google-calendar/config.tsx` is an ordinary
`defineIntegration`, in the ordinary `integrations` array, rendering the ordinary
`IntegrationCard` in the ordinary grid. There is no separate panel. Its `id` is deliberately
the SAME string as the piece name, so nothing has to map between the two.

- `active: !!GOOGLE_OAUTH_CLIENT_ID` — an unconfigured server shows "Coming soon", the same
  as any other integration missing its credentials. (`GOOGLE_OAUTH_CLIENT_ID` is therefore in
  `getBrowserEnv()`; it is a public client id, never the secret.)
- `settings: []` and `schema: z.object({})`, so the drawer shows no settings form and no
  Submit. Install runs `onClientInstall` → the connect route → the consent popup, exactly
  like Onshape and Slack.
- The **callback upserts the `companyIntegration` row**. That row is what "Installed" means
  to the grid; without it the card would keep offering Install for an already-connected
  account.
- `ui/Integrations/ConnectionsTab.tsx` is an `IntegrationFormTab` ("Accounts") on that card,
  listing the connected accounts with rename, Disconnect and Add account. It is the ONE place
  this integration differs from the others, and only because a workflow step picks which
  account it runs as.
- Uninstall goes through the standard deactivate route, whose `onUninstall` hook calls the
  generic `revokeConnectionsForPiece` — otherwise the uninstall would leave live tokens the
  customer can no longer see. There is deliberately no per-vendor hooks FILE: that behaviour
  is identical for every piece, and a file per vendor is a file per vendor to forget.
- Both Install (the card) and Add account (the drawer) go through
  `integrations/connect.ts` `startIntegrationConnect` / `openConsentPopup`, so the two
  entry points cannot drift into different popup sizes and different failure behaviour.

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
  must fail before a customer reaches a consent screen that cannot come back.
- `accountLabel` — optional `{ url, field }` for reading back which account authorized, so
  two connections are tellable apart. The callback's `accountLabelFor` is best-effort: a
  failure there must never lose a connection that already authorized.

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
   vendor has such an endpoint.
3. Register the OAuth app with the vendor and set those env vars (add them to
   `.env.example` too).
4. Add the client id to `getBrowserEnv()` and the `Window.env` declaration in
   `packages/env/src/index.ts`. That list is fixed and cannot be looked up by name, and the
   settings card reads it client-side to decide "Coming soon" — this is the one step the
   allowlist row cannot carry for you.
5. Add an ordinary `defineIntegration` config whose `id` IS the piece name, with
   `onClientInstall: () => startIntegrationConnect(...)`, and register it in the
   `integrations` array. Its `hooks.server.ts` entry is one line —
   `onUninstall: (companyId) => revokeConnectionsForPiece(getCarbonServiceRole(), "<piece>", companyId)`
   — never a per-vendor hooks file; there is nothing vendor-specific in that behaviour.
6. Check every action you expose ships an `outputSchema` — the generator refuses one
   that does not, and coverage is all-or-nothing per piece.
7. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog`.

Step 3 is the real work and the real gate. The rest takes minutes.

## Outputs come from the piece's own `outputSchema`

`integrations/outputs.ts` maps an action's `outputSchema` to Carbon `ValueType`s:
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
field and yields `null` for anything absent or mistyped — it never throws, because a
vendor disagreeing with its own schema must not fail a step that really did call it.

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
