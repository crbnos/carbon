# Thermo-nuclear review — feat/active-pieces-integration

Target: the full branch diff `d29d84c07a…HEAD`. It has 270 files and about 13,000 lines of code
outside docs and `.po` files. The uncommitted working tree holds only `packages/database/src/types.ts`.
That change is a regen reorder of three FK relations. Do not commit it.

Four read-only reviewers covered four areas:

1. ee connections and migrations
2. jobs integrations and the catalog
3. ee workflow definition and runtime
4. erp UI and services, and the react Date components

Each reviewer re-opened every finding at its `file:line`. The lead re-checked the items marked **[V]**.
Nobody ran typecheck, tests or a build, because of the RAM limit. This review does not claim a green build.

Nobody has fixed any finding below.

---

## Blockers

### B1 [V] Pluck on a field the type does not declare still "succeeds" with `list<null>`
`packages/ee/src/workflows/runtime/filter.ts:160-202`. When `walkPath` misses, `declared` is
`undefined` and the card does not refuse. Every `pick` returns null. The node returns Succeeded
and types the list from a sample as `list<null>`. The build side (`definition/data-operations.ts:170-171`)
declares no output for the same card. So the builder builds downstream steps against nothing.
The validator never checks drafts or test runs, so this reaches real runs.
`data-consistency.test.ts` misses it: only its primitive lists get the bogus field (`:121-122`).

Fix:
1. Add `if (declared === undefined) return { ok: false, reason: … }`.
2. Add `list<record>` and `list<entity>` with `"nope"` to the test matrix.
3. Delete `sample`, the nested ternary (`:194-202`) and `typeOfValue` (`:297-314`). They are then dead code.

### B2 [V] The Settings card says "Healthy" for up to 5 h after a token dies at run time
`apps/erp/app/modules/settings/settings.service.ts:2697-2705` caches a healthy result for
`INTEGRATION_CACHE_TTL * 5`. The TTL is 3600 (`:2082`), so the cache lasts 5 hours.
The comment says that every path that changes health clears the key.
`markExpired` (`packages/ee/src/integrations/connections.ts:697-711`) does not clear it.
The comment at `integrations.connections.tsx:70` also says "five minutes", which is wrong.

Fix: clear the key from the caller of `markExpired`, or cut the healthy TTL to minutes. Correct both comments.

### B3 [V] A failed connections lookup tells the author the app "isn't connected" and hides the step
`apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx:325-344` checks
only `connectionsError !== "reconnect"`. A lookup can fail with `errorCode: "failed"`
(`api+/workflows.options.ts:93`) or a 500. Then the form shows the Connect banner.
It also hides the step picker and every input of an existing node, and it offers no retry.

Fix: branch on `"failed"`. Show the same error and "Try again" that `OptionsField.tsx:97-135` shows,
and use the `retry` that the hook already returns.

### B4 [V] A vendor call that succeeded can be reported as failed (→ duplicate sends on re-run)
`packages/jobs/src/workflows/actions/integration.ts:115-153` has three problems in one block:

1. `JSON.stringify(result)` sits in the same `try` as `action.run`. A circular or BigInt result
   lands in the catch as "`<label>` rejected this: …". By then the email or message already went out.
2. For Gmail, `result` stores the raw `GaxiosResponse`. That object includes `config`, with the
   base64 request body. It holds no token today only because gaxios serializes `Headers` to `{}`.
   `redactForLog` matches keys, so it cannot see inside the string.
3. The code matches `SCOPE_ERROR` against the `HttpError` message, and that message embeds the
   request body. This is prior MINOR 19, still open.

Fix:
1. Treat only a throw from `action.run` as a vendor failure.
2. Serialize with a replacer that drops `config` and `request`. Run `redactForLog` on the object first.
3. Match a scope error on the status or error code, not on the message text.

### B5 [V] `connect.ts` re-implements `oauth-popup.ts` — and reintroduces the bug that file exists to prevent
`packages/ee/src/integrations/connect.ts:16-49` awaits `fetch` and then calls `window.open`.
The canonical `beginOAuthPopup` (`packages/ee/src/oauth-popup.ts:5-30`) opens the popup inside the click.
It does this because Chrome blocks a popup opened after an await.
When Chrome blocks it here, the fallback navigates the whole page away. `connect.ts` also copies the popup geometry.

Fix: build `startIntegrationConnect` on `beginOAuthPopup()`. Open it in the click, then call
`navigate(url)` or `close()`. Delete `popupFeatures` and `openConsentPopup`.

### B6 [V] Untranslated user-facing copy (Lingui-from-day-one)
- `packages/react/src/Date/TimeCombobox.tsx:195` "No matching time"; `DateTimePicker.tsx:156` `aria-label="Time"`.
- `ConnectionsTab.tsx:219` renders the raw status enum.
- The `t` fallback at `ConnectionsTab.tsx:105-108` never runs, because `connect.ts:46` always
  throws English. The tab also toasts the connect route's own English strings
  (`integrations.connections.$piece.connect.ts:37,46,60`). This is prior MINOR 23.
- `useIntegrationInstall.ts:78` toast moved over still untranslated.
- `ui/Runs/DataDetail.tsx` renders engine English (`filter.ts:125,206,226` "Counted N.").
- `nodes/meta.ts:179,185` uses `DATA_OPERATIONS[op].label` (English) while the form uses the
  translated `useDataOperationLabel` — card and form can disagree.
Fix: throw/return codes and word them in the UI; `t`/`Trans` for the rest.

### B7 Non-atomic writes and a per-row loop the root AGENTS.md forbids
- `disconnectConnection` (`packages/ee/src/integrations/connections.ts:375-400`) makes two writes:
  a vault RPC, then a row UPDATE. Its `secretRef: null` is also redundant, because
  `delete_connection_secret` already sets it to null (migration `…120101:98`).
- `revokeConnectionsForPiece` (`:412-430`) runs that pair once per row, in a loop.

Fix: add one `revoke_connection` RPC. It deletes the secrets and sets `Revoked` in one statement.

### B8 New route action written the legacy way, with no service function
`apps/erp/app/routes/x+/settings+/integrations.connections.tsx:21-92` calls `assertIsPost`, then
`requirePermissions`, then the ee building blocks directly. `conventions-forms.md` says not to write
new actions this way. The action also takes `pieceName` for cache invalidation from the client
(`:65-76`, `ConnectionsTab.tsx:274`).

Fix:
1. Add `renameIntegrationConnection` and `disconnectIntegrationConnection` as `defineServiceFn` in
   `settings.server.ts`, with `permission: { update: "settings" }`.
2. Let the service functions clear the cache and read `pieceName` from the row.

### B9 [V] Forked `toPlainValue`
`packages/jobs/src/workflows/integrations/properties.ts:140-160` (`toPlain`) is
`actions/values.ts:9-27` again; `workflow-actions.md` says "Don't fork it." Import it.

### B10 Test theater in `connections.test.ts`
`packages/ee/src/integrations/connections.test.ts:47-200` is a hand-written in-memory Supabase.
It has its own `or`, `lt` and vault logic. The "two callers race" test (`:319`) proves the fake,
not READ COMMITTED. `.claude/rules/testing-no-mock-theater.md` names this pattern.

Fix:
1. Keep the pure tests.
2. Export `sameAccount`, `accountIdentity` and `expiringSoon`, and test them directly.
3. Stub only `fetch` for the token-endpoint branches.

---

## Code-judo / simplification

1. **One per-operation rule, not four.** "pluck needs record/entity", "field must resolve",
   "a list field needs flatten", "join needs text" are re-derived in `operationsFor`
   (`data-operations.ts:106-117`), `cardResultType` (`:147-188`), `checkTypes`
   (`data-node.ts:152-198`) and `runCard` (`filter.ts:143-216`). Make `cardResultType` return
   `{ type } | { refusal }`; validator emits the refusal, `operationsFor` filters on it, the runtime
   calls it for refusal + declared type. ~60 lines of parallel guards and their "a draft is never
   validated" comments go. The three flags (`loops`, `usesClauses` identical everywhere; `usesField`
   ≡ `=== "pluck"`) collapse to one `accepts(of)` per entry.
2. **Drop the flat `operation` / `field` / `flatten` filter-node fields.** They were added on this
   branch alongside `operations` (base `filterNode` had only `source/combinator/clauses`), so they
   are back-compat for a shape that never shipped. Synthesize card-0 in `cardsOf`; `operationOf`'s
   flat path, the probe at `variables.ts:299-304` and test-helper noise disappear. (Caveat: unless a
   preview env holds drafts with them.)
3. **Action and integration executors/kinds are near copies.** Input resolution
   `runtime/integration.ts:37-60` ≈ `runtime/action.ts:25-50` → one `resolveStepInputs(inputs,
   declared, ctx)` (make `linkState` take `(inputs, declared, name)`). Node kinds
   `nodes.ts:716-772` ≈ `:662-714` → one `stepNodeKind` factory; give `BatchableStep` `outputs`.
4. **One connection-auth resolver.** `integration.ts:66-113` (read, piece check, refresh, three
   error classes) is re-implemented in `workflows.service.ts:861-927` (`propertyProvider`), which
   has already drifted — it never calls `missingScopes`. Extract `resolvePieceAuth(companyId,
   piece, connectionId)` returning a tagged outcome. (Also: `readConnection` / `requiredScopesFor`
   at `integration.ts:66,77` throw outside any `try`.)
5. **Single-pass props.** `integration.ts:119-127` walks `action.props` three times
   (`omittedProps`, filter, `pinnedValues`) then `toPropsValue` repeats "fall back to pin" ×3
   (`properties.ts:181,187,194`) and re-checks MARKDOWN (`visibility.ts:50`). One
   `toPropsValue(piece, action, props, inputs)` loop deletes `pinnedValues`, `omittedProps` and ~60 lines.
6. **One walk over the output schema.** `toOutputTypes` + `toOutputPaths` (`outputs.ts`) and
   `project.ts:36-37` recompute both per run → `describeOutputs(schema)`; fold `project.ts` into
   `outputs.ts`. `project.ts:65`'s `.slice(0, MAX_LIST_ITEMS)` is redundant with `listValue`.
7. **Pieces as data.** `gmail/config.tsx`, `google-calendar/config.tsx`, `slack/config.tsx` and
   `hooks.server.ts` repeat id/logo/`settings: []`/`z.object({})`/`onClientInstall` and three
   identical `onUninstall` lambdas. A `PIECES` const + `definePieceIntegration(piece, {...})` + one
   `map` for hooks.
8. **Second OAuth-state mechanism.** HMAC signer in `settings.service.ts:8715-8785` beside the
   cookie-bound single-use `issueOAuthState` / `consumeOAuthState`
   (`packages/auth/src/lib/oauth-state.server.ts:179,192`, which already has an `extras` hook).
   Extend `OAuthStateExtras` and drop the signer — or document why two exist.
9. **`MappedProperty` re-spread.** `integrations/catalog.ts:66-128` copies every field with
   conditional spreads and casts, then `ee/catalog/build.ts:168-194` strips undefined again. Have
   `toValueType` return `ActionInputLike`; rename allowlist `links.when.prop` → `input` so `links`
   passes through.
10. **FilterForm decomposition.** `FilterForm.tsx` 233 → 533 lines, mostly one ~280-line
    `cards.map`. Extract `<SourceListPicker>` and `<OperationCardEditor>` (with `<FieldPicker>` /
    `<ClauseList>`).
11. **`renderStepInput` is a 15-argument function.** `StepInput.tsx:54`; both callers pass the
    same hook value and resolve labels identically (`ActionForm.tsx:386-397`, `IntegrationNodeForm`
    ×2). Make it `<StepInput …/>` that calls `useChoiceOptions()` itself. `hint` is dropped for
    Pairs/MultiChoice/Options. `IntegrationNodeForm`'s three banners (`:267-344`) → one
    `<ConnectBanner>`; add `path.to.integrationAccounts(piece)` (string repeated 3× + `workflows.service.ts:805`).
12. **Slack reader outside the "ONLY place".** `slack/lib/service.ts:282,289` re-inlines
    `SELECT_COLUMNS` and an `as unknown as` cast; `:246` hand-filters `Active` instead of
    `usableConnections`; `readConnectionAccessToken` (`connections.ts:636-655`) repeats
    `resolveConnectionAuth`'s read + guard (prior MINOR 12/15/16, still open).

---

## Risks / questions

- **Refresh race** `connections.ts:549,564,584` — tokens read before the claim, exchanged after;
  a vendor that rotates refresh tokens gets `invalid_grant` → `markExpired` condemns a healthy
  connection. Latent today (Google doesn't rotate, Slack doesn't expire). Re-read after winning the claim.
- **Slack `team_id` in two companies** — nothing at connect time refuses it; afterwards every
  inbound interaction for the first company throws `AmbiguousSlackWorkspaceError`
  (`slack/lib/service.ts:274-295`).
- **CDN logos for non-piece integrations** — jira/linear/xero/quickbooks/stripe-connect cards
  now load from `cdn.activepieces.com` (`piece-logo.tsx:18`): third-party dependency, viewer IP +
  Referer leak (incl. `CONTROLLED_ENVIRONMENT`), and out of scope. `alt={piece}` renders the slug.
- **Vendor JSON goes through the column coercer** `values.ts:109-125` via `project.ts:66,70`:
  `Boolean("false") === true`, `String(obj)` → `"[object Object]"`, `new Date(raw)` (banned by
  `date-handling.md`). The rule promises "null for anything mistyped". Needs a strict `fromJson`.
- **Flattened pluck drops items past 100 and misreports** `filter.ts:203-206` — `listValue`'s
  `dropped` is discarded ("Took 2000 values" holding 100).
- **`ItemRef.card` never checked** against the card it sits in (`filter.ts:78-81`,
  `variables.ts:138`); card ids not unique/non-empty (`schema.ts:93-104`) while `dataLoopList` uses
  `findIndex`. Derive the card from position, or validate + `.refine` uniqueness.
- **[V] `operationOf`'s "falls back" can never fire** — `dataOperationSchema` is a strict enum
  (`schema.ts:95,117`), so removing an operation later makes saved workflows unparseable. Pick one
  policy (`.catch("filter")` or delete the claim). `in DATA_OPERATIONS` also matches prototype keys.
- **Run-level error not redacted/capped** `engine/execute.ts:640,656-660` (`firstError` raw;
  step row gets `redactText`). A batch with `failedItems > 0` carries `error: null` (`:262`).
- `accountLabelFor` (`integrations.connections.callback.ts:219`) has no timeout; a stalled identity endpoint hangs the callback.
- `markIntegrationInstalled` read-then-insert race (`settings.service.ts:2523-2555`, prior MINOR 11).
- `workflows.service.ts:947` `String(option.value)` on object-valued dropdowns, hidden by the cast at `:937-942`.
- `workflows.options.ts:50` indexes `OPTIONS_PROVIDERS[providerId]` without `Object.hasOwn`
  (`?provider=constructor`); not exploitable today.
- `store.ts:272` `setNotices` lacks the empty→empty identity guard its siblings have; every debounce re-renders subscribers.
- Nested remapped output paths ignored (`outputs.ts:117-131`) though the comment says types and paths "can never disagree".
- `vendorText` doesn't escape `\` but the generator emits ``msg`${label}` `` raw; step labels skip
  `assertLabelIsSafe` (prior MINOR 18).
- Prior Q1 still open: backfilled 10 Slack scopes vs the required set → every legacy Slack card reads "Reconnect needed".
- Scope: `shared.service.ts:250-255` (`TEMPLATE_ASSET_PREFIX`, commit f48533564f) is a quote-PDF
  fix unrelated to integrations — split it out.

---

## Suggested improvements

- Dead exports: `packages/ee/src/index.ts` connections block (no importer; puts
  `exchangeAuthorizationCode` / `exchangeRefreshToken` in a client-reachable barrel); 20 of 32 names
  in `packages/jobs/src/workflows/integrations/index.ts` unused.
- Duplicated dot-path walkers `oauth.ts:94-108`, `outputs.ts:137-144` → `getPath`
  (`packages/ee/src/integrations/secrets.ts:132-140`). Duplicated option parsing
  `visibility.ts:32-41` / `properties.ts:55-61`.
- `registry.ts:93-108` `getPieceAction` re-implements `getPieceActions` and repeats `loadPiece`'s allowlist check.
- `check-workflow-catalog.ts`: diff is mostly re-indent (`-w` = +47/−4); keep a sync `check()`,
  extract `compareMap` for the three copy-pasted blocks (`:222-268`), drop the
  `WORKFLOW_ACTIONS` alias. Label text is never compared, only keys.
- `retention.ts:40-54` duplicates the generic key-capping branch (`:77-85`).
- Misplaced/orphan JSDoc: `data-operations.ts:92-102`, `connections.ts:106-109`, `:722-727` (also
  contradicts `callback.ts:121-122`), `hooks.server.ts:54-64`, `visibility.ts:28`,
  `workflows.service.ts:740,791`, `useIntegrationInstall.ts:13-21`; stale `connections.ts:14`.
- `workflows.service.ts:852` hardcodes `connectionId` — use `INTEGRATION_CONNECTION_INPUT`.
- `useWorkflowOptions.ts:8` imports a type from server-only `workflows.service` — move to models/types.
- `TimeCombobox.tsx:95,102-104` effect mirrors `committed` into `draft` — derive `isEditing ? draft : committed`.
- `OptionsProviderContext.client` and `search` are unused (`workflows.service.ts:753,759,941`).
- `integrations.$id.tsx:997-1026` awaits two independent reads serially — `Promise.all`.
- `date.ts:237-240` sets `hour` twice; `parseTypedTime` (`:319,337`) dead `isInteger` checks and accepts `3.5` as 3:05.
- `data-node.ts:168` empty-string field gets a double message; `notices.ts:93` redundant `String()`;
  `integration.ts:141` `JSON.stringify(undefined)` → use `?? null`.
- Tests: `data-consistency.test.ts:155` name doesn't match what it exercises; pervasive `as never` /
  `as unknown as` casts (`:39-112`).
- `packages/jobs/manifests/schema.json` reorders two unrelated columns — local churn.
- `OutputHandle.tsx`: IIFE in JSX → `<FieldList>`; timers typed via `as unknown as number`.

Not a finding: one reviewer said two files grew past 1,000 lines. Both were already over 1,000 at the base:
`integrations.$id.tsx` (1679 → 1734) and `IntegrationForm.tsx` (1119 → 1136).
No file crosses 1,000 lines on this branch. The closest are `workflows.service.ts` (713 → 956)
and `ee/workflows/catalog/build.ts` (723 → 923).

---

## Docs freshness

- **[V] Specs.** `.ai/specs/2026-08-31-workflow-integration-outputs.md` still "draft" and
  `2026-08-31-data-node-operation-chain.md` "Approved (pending user sign-off)" though both are
  implemented; the four "implemented" specs (`2026-09-01-*` ×3 relevant, `2026-09-04-integration-datetime-inputs.md`)
  are not moved to `.ai/specs/implemented/` per `keep-sources-in-sync.md`.
- **[V] `.claude/rules/workflow-integrations.md`** points at `.ai/specs/2026-08-27-workflow-integrations.md`
  and `.ai/research/activepieces-integrations.md` — neither exists; its `paths:` includes
  `packages/workflows/src/runtime/integration.ts` (the engine moved to `packages/ee`). It also
  documents `connect.ts` / `openConsentPopup` as the shared entry point (see B5).
- **[V] `linkify`** still described in `packages/ee/src/workflows/AGENTS.md:361-365` and
  `.claude/rules/workflow-engine.md:204-205`; this branch replaced it with `links`.
- **[V] `.claude/rules/workflow-actions.md:30`** "2 integration steps" — the generated catalog has 7.
- `packages/jobs/AGENTS.md` calls `buildPieceActionDeclarations` the "fifth input"; the rule and code say sixth.
- `TestRunPanel.tsx` doc comment and footer ("not saved") contradict `workflow-run-history.md`
  (test runs write `isTest = true` rows) — user-facing copy is wrong.
- `packages/jobs/src/backups/schema.ts:40-42` comment is false since `get_connection_secret` reads by vault name.
- Migration `20261020120101…sql:39` policy comment quotes the old manifest rule.

---

## TLDR

**Blockers**
- B1 pluck on an undeclared field succeeds with `list<null>` (`filter.ts:160`)
- B2 health cache stays Healthy 5 h after `markExpired` (`settings.service.ts:2705`)
- B3 lookup failure shows "isn't connected" and hides the step (`IntegrationNodeForm.tsx:325`)
- B4 serialization in the vendor `try` → sent-but-"failed"; raw Gaxios response stored (`integration.ts:115`)
- B5 `connect.ts` duplicates `oauth-popup.ts` and opens after await
- B6 untranslated copy (TimeCombobox, DateTimePicker, ConnectionsTab status, connect errors, DataDetail, meta labels)
- B7 non-atomic disconnect + per-row revoke loop (`connections.ts:375-430`)
- B8 legacy-style connections action, no service function, client-supplied `pieceName`
- B9 forked `toPlainValue` (`properties.ts:140`)
- B10 mock-theater Supabase fake in `connections.test.ts`

**Code-judo**
- one per-operation rule table replaces 4 copies
- drop never-shipped flat filter fields
- shared `resolveStepInputs` + `stepNodeKind` for action/integration
- one `resolvePieceAuth` (erp copy already drifted on scopes)
- single-pass `toPropsValue`
- one `describeOutputs` walk, fold `project.ts`
- `PIECES` const + `definePieceIntegration`
- reuse `issueOAuthState` instead of a second HMAC state
- drop `MappedProperty` re-spread
- decompose `FilterForm`
- `StepInput` as a component + one `ConnectBanner`
- Slack reader back inside `connections.ts`

**Risks**
- refresh race (latent)
- Slack `team_id` across companies
- CDN logos for non-piece cards
- `fromColumn` coercion of vendor JSON
- flatten drops >100 silently
- `ItemRef.card` unchecked / duplicate card ids
- `operationOf` fallback can't fire
- run error not redacted
- no timeout on `accountLabelFor`
- install race
- `String(option.value)`
- `Object.hasOwn` on providers
- `setNotices` identity
- nested output paths
- label escaping
- legacy Slack scopes
- unrelated quote-PDF commit

**Suggestions**
- dead barrel exports
- duplicated path walkers / option parsing
- registry dup
- catalog-check `compareMap`
- retention dup
- misplaced JSDoc
- hardcoded `connectionId`
- server type import
- TimeCombobox derived state
- unused `client` / `search`
- `Promise.all`
- date helper nits
- test casts
- manifest churn

**Docs**
- spec statuses + not moved to `implemented/`
- `workflow-integrations.md` dead links/paths
- `linkify` in AGENTS/rule
- "2 integration steps"
- "fifth input"
- test-run "not saved" copy
- backups comment
- migration comment

## Verdict

**Block.** The branch has three correctness bugs that a user can see (B1–B3).
B4 can report a sent message as a failure. B5 copies a canonical helper and brings back the bug it prevents.
The branch also has untranslated copy and non-atomic writes, which the root AGENTS.md forbids.
Simplifications 1, 3, 4 and 5 are still open. Each one deletes a parallel copy of logic.
