# Run log — third-party integration steps in Workflows (Activepieces-backed)

Plan: `.ai/plans/2026-08-27-workflow-integrations.md`
Spec: `.ai/specs/2026-08-27-workflow-integrations.md`
Branch: `feat/active-pieces-integration` · Executed 2026-08-27 · Nothing committed.

## What landed

| Task | Result |
|---|---|
| 1. Migration | `20260827044707_workflow-integration-connections.sql` — `integrationConnection` + 4 RLS policies + 3 `*_connection_secret` RPCs + delete trigger. Applied. |
| 2. Types | `pnpm db:migrate` regenerated; `integrationConnection` present in `packages/database/src/types.ts`. |
| 3. Env | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URL` in `packages/env/src/index.ts` + `.env.example`. |
| 4. Piece dep | `@activepieces/piece-google-calendar@0.10.3` (exact pin) + `allowlist.ts` + `registry.ts` + `types.ts`. |
| 5. Property map | `properties.ts` — 8 piece kinds mapped, everything else throws `UnmappablePropertyError`. |
| 6. Catalog route | `piece` block on `BuiltAction` / `ActionDeclarationLike`; `getActionRoute` returns it. |
| 7. Generator | Fifth input via `integrations/catalog.ts`; both catalog scripts now merge it. 16 → **18 actions**. |
| 8. Connections | `packages/ee/src/integrations/connections.ts` + `@carbon/ee/integrations/connections` subpath. |
| 9. OAuth routes | connect + callback under `api+/integrations.connections.*`, signed `state`. |
| 10. Settings UI | `ConnectionsPanel` on the integrations page + `integrations.connections.tsx` action. |
| 11. Executor | `actions/integration.ts` + one `route.piece` branch in `services.ts`. |
| 12. Options endpoint | `api+/integrations.connections.options.ts`, gated on `workflows_update`. |
| 13. Builder | `IntegrationFields.tsx` (connection picker + dynamic options) wired into `ActionForm`. |

## Verification run

```
pnpm db:migrate                                   → applied; RPCs + RLS confirmed via psql
pnpm run generate:workflow-catalog                → 106 events, 17 entities, 18 actions, 15 operations
pnpm run check:workflow-catalog                   → ok, no drift
pnpm exec biome check <changed files>             → 0 errors, 2 warnings (both deliberate, see below)
pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs \
  --filter=@carbon/ee --filter=erp --filter=@carbon/env   → 5 successful, 5 total
pnpm --filter @carbon/workflows test              → 25 files, 432 tests passed
pnpm --filter @carbon/jobs test                   → 35 files, 510 tests passed
pnpm --filter @carbon/ee test                     → 43 files, 562 tests passed
cd apps/erp && pnpm exec vitest run app/modules/workflows  → 15 files, 160 tests passed
```

Emitted catalog entry, read back from the committed file:

```
integration.google-calendar.create_google_calendar_event
inputs: connectionId,calendar_id,title,start_date_time,end_date_time,location,
        description,colorId,attendees,guests_can_modify,guests_can_invite_others,
        guests_can_see_other_guests,send_notifications,create_meet_link
piece:  {"name":"google-calendar","action":"create_google_calendar_event"}
calendar_id       → {"type":{"kind":"primitive","of":"string"},"required":true,"dynamicOptions":true}
send_notifications → {"type":{"kind":"primitive","of":"string"},"required":true,
                      "choices":["all","externalOnly","none"]}
```

The two remaining biome warnings are the `useExhaustiveDependencies` suppressions in
`IntegrationFields.tsx`, both with a `biome-ignore` explaining why including `fetcher`
would loop. Repo-wide `pnpm exec biome check` still reports its ~475 pre-existing
warnings and 17 pre-existing errors in files this branch does not touch.

## NOT verified — needs a human

**Every browser acceptance criterion is unverified.** They all require a Google Cloud
OAuth app that does not exist yet: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
and `GOOGLE_OAUTH_REDIRECT_URL` are unset locally, so the Connect button renders
disabled ("Not configured on this server") and no consent round trip can be started.

Unverified until that app exists:

- connect a Google account; add a second named connection; reject a duplicate name
- the builder's calendar dropdown listing the connected account's real calendars
- a real trigger creating a real calendar event
- run history showing Succeeded with no token in `input`/`output`
- an expired token refreshing exactly once against Google
- a disconnected connection failing with the reconnect message, then recovering

What IS proven without it: the piece loads and its actions resolve against the real
installed package (`registry.test.ts`); the property mapping produces the real
`send_notifications` choices and marks `calendar_id` dynamic (`properties.test.ts`);
the executor's success and all five failure sentences (`integration.test.ts`); the
concurrent-refresh claim refreshing exactly once with the loser observing the winner's
token, and tokens never reaching `metadata` (`connections.test.ts`).

## Deviations from the plan

**Task 10 renders its own panel rather than reusing `IntegrationCard`.** That component
is bound to the `Integration` config type — a logo component, a `settings` array, an
`onClientInstall` hook and a one-row-per-company install/uninstall model. A piece has
none of those and allows several named connections per company, so reusing the card
would have meant distorting the 12 existing integrations' model. `ConnectionsPanel`
sits above the integrations grid on the same page instead; the failure codes go through
the existing `integrationErrors` mechanism under a new `connection` key.

**Task 11 uses a service-role client for the vault read.** The plan said
`resolveConnectionAuth(serviceClient, …)` but the executor is handed the owner's client.
The vault RPCs are granted to `service_role` only, so a user client cannot decrypt a
token at all. The executor therefore checks the connection exists in this company
**through the owner's client first** (RLS applies to that lookup), and only then reads
the token with `getCarbonServiceRole()`, scoped by the run's own `companyId`. Same
guarantee `resolveIntegrationSecrets` already gives the 12 existing integrations.

**`STATIC_MULTI_SELECT_DROPDOWN` was missing from the plan's mapping table.**
`google_calendar_get_events.event_types` uses it. Mapped to `t.list(t.string)` with its
static choices, alongside the planned `MULTI_SELECT_DROPDOWN`.

**Both catalog scripts became `async function main()` wrappers.** `tsx` transpiles them
to CJS, which rejects top-level `await`, and reading a piece's actions requires a dynamic
import. No behaviour change.

---

# Revision — 2026-08-27, same branch

Two changes asked for after the first pass landed. Both are behaviour-preserving for the
run path (the executor, the connections service, the vault and the OAuth round trip are
untouched); everything that moved is the catalog's options declaration and the settings UI.

## 1. Fetched choices are generic, not an integration feature

`dynamicOptions?: boolean` is gone. An input that cannot list its values at build time now
carries an `OptionsSource` — `{ provider, params?, dependsOn? }` — where `provider` names a
resolver and never an integration. Piece dropdowns are simply the first two providers.

- `packages/workflows/src/definition/catalog.ts` — new exported `OptionsSource`; `CatalogInput.options`
  replaces `dynamicOptions`. Same swap in `catalog/actions.ts` (`ActionInputLike`) and
  `catalog/build.ts` (`BuiltActionInput`).
- `build.ts` gained two refusals: an input that both fetches and lists its values, and a
  `dependsOn` naming an input the action does not have.
- `packages/jobs/src/workflows/integrations/options.ts` (new) — `CONNECTION_INPUT`,
  `CONNECTION_PROVIDER`, `PROPERTY_PROVIDER`. The whole contract between the committed
  catalog and the app registry, in one file.
- `properties.ts` emits `options: { provider: "integration.property", params: { piece, action,
  prop }, dependsOn: ["connectionId"] }`; `catalog.ts` gives `connectionId` itself
  `options: { provider: "integration.connection", params: { piece } }` — so the connection
  picker is no longer a special case, just another fetched list.
- `apps/erp/app/modules/workflows/options-providers.server.ts` (new) — `OPTIONS_PROVIDERS`,
  the only module that knows what a provider id means. Each entry declares its own
  permission (`workflows_view` for connections, `workflows_update` for a vendor call).
- `api+/workflows.options.ts` (new) replaces `api+/integrations.connections.options.ts` and
  `api+/integrations.connections.ts`, both deleted. An unknown provider still passes through
  `workflows_view` before being refused, so it is not an unauthenticated probe.
- `fields/OptionsField.tsx` (new) replaces `fields/IntegrationFields.tsx`, deleted. One field
  for every fetched list, single or multi. `ActionForm` no longer reads `getActionRoute().piece`
  at all — the branch is `if (inputDef.options)`.

A Carbon-backed dropdown is now one registry entry plus an `options` block. No change to the
catalog format, the endpoint or the field.

## 2. Google Calendar is an ordinary integration card

The separate "Workflow connections" panel above the grid is gone.

- `packages/ee/src/google-calendar/config.tsx` (new) — an ordinary `defineIntegration` in the
  ordinary `integrations` array, `id` deliberately identical to the piece name.
  `active: !!GOOGLE_OAUTH_CLIENT_ID`, so an unconfigured server shows the standard
  "Coming soon" instead of a bespoke "Not configured on this server".
- `GOOGLE_OAUTH_CLIENT_ID` added to `getBrowserEnv()` and the `Window.env` declaration — the
  card reads it client-side. Public client id; the secret is untouched.
- The callback now upserts the `companyIntegration` row, which is what "Installed" means to
  the grid.
- `ui/Integrations/ConnectionsTab.tsx` replaces `ConnectionsPanel.tsx`: the same list, as an
  "Accounts" tab on the card's own Details drawer. Multi-account support is kept — a workflow
  step still picks which account it runs as.
- `google-calendar/hooks.server.ts` (new) `onUninstall` revokes every connected account, so
  uninstalling cannot strand live tokens.

## Verification

```
check-workflow-catalog: ok — 106 events, 9 moments raised, 17 entities, 18 actions, 15 operations
generate-workflow-catalog: 106 events, 17 entities, 18 actions, 15 operations, 59 help terms
typecheck: @carbon/workflows, @carbon/jobs, @carbon/ee, erp — 4 successful, 4 total
@carbon/workflows 432 · @carbon/jobs 510 · @carbon/ee 562 · erp workflows 160 — all passed
biome check <28 changed files>: 0 errors, 7 warnings (all pre-existing console.error in integrations.$id.tsx)
```

Still unverified in a browser, and still blocked on the same thing: a Google Cloud OAuth app
and its three env vars.

---

# Revision 2 — integrations as a first-class node + vendor config by table

Plan: `.ai/plans/2026-08-27-workflow-integration-node.md`. Both workstreams landed.

## A — a vendor is named in one place

`AllowlistEntry` now carries the vendor's own configuration: the NAMES of its three env
vars and an optional `accountLabel` (`{ url, field }`). `resolveOAuthApp` in
`integrations/oauth.ts` reads them via `getEnv` and replaced the
`if (pieceName === "google-calendar")` branch; the connect route and the callback both use
it, and `accountLabelFor` reads the allowlist row instead of hard-coding Google's userinfo
endpoint. New `oauth.test.ts` covers the resolution and both refusals.

The OAuth2-only limit is now commented in `allowlist.ts` and on `getPieceOAuth2Auth`, with
the reason: an API-key piece needs a credential form, no callback and no refresh, so it is
its own work rather than a branch. `.env.example` gained every previously-undocumented
integration variable (Slack, Onshape, Xero, QuickBooks, Jira, exchange rates).

One thing the allowlist row deliberately cannot carry: `getBrowserEnv()` is a fixed list,
so each new vendor's client id must be added there and to the `Window.env` declaration by
hand. That is step 4 of "Adding a piece" in the rule.

## B — `integration` is a node kind

- `definition/schema.ts` — a seventh variant, `{ piece, action, inputs }`. No
  `formatVersion` bump: adding a variant leaves every stored v3 document valid.
- `CatalogIntegration` + `WORKFLOW_INTEGRATION_CATALOG`, emitted beside the action and
  operation maps. `buildCatalog` takes a sixth argument and returns `built.integrations`;
  both catalog scripts pass it the same way. `buildDeclaredInputs` and `labelDeclaration`
  are now shared, so the two kinds are validated and labelled by the same code.
- **`piece` is gone from the action path**: off `BuiltAction`, off `getActionRoute`, and
  the `route.piece` branch is out of `runAction`. `runIntegration` is a separate service
  method handed the `{ name, action }` block off the step's own catalog entry.
- `runtime/integration.ts` `integrationExecutor`, registered like every other kind.
- `integrationStepId` in `@carbon/workflows` is the one place the id shape is written;
  `packages/jobs`' `integrationActionId` delegates to it.
- Builder: `NODE_KIND_META` (plug icon), the three `kinds.ts` maps, `nodeTypes`,
  `NODE_KIND_ORDER`, `createNode`, the default-name regex, and a new
  `IntegrationNodeForm` (app picker → step picker → inputs). `StepInput.tsx` was extracted
  from `ActionForm` and is shared by both, so input rendering cannot drift.

Counts moved as expected: **18 actions → 16 actions + 2 integration steps**.

## Verification

```
generate-workflow-catalog: 106 events, 17 entities, 16 actions, 2 integration steps, 15 operations, 59 help terms
check-workflow-catalog: ok — 106 events, 9 moments raised, 17 entities, 16 actions, 2 integration steps, 15 operations
typecheck: @carbon/workflows, @carbon/jobs, @carbon/ee, erp — 4 successful, 4 total
@carbon/workflows 436 · @carbon/jobs 513 · @carbon/ee 562 · erp workflows 160 — all passed
biome check <51 changed files>: 0 errors, 13 warnings (all pre-existing)
```

Still unverified in a browser. The Google OAuth env vars are set locally now, so the
connect flow and a real test run of an Integration node are the next thing to try by hand.
