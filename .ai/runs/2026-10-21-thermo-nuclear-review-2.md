# Thermo-nuclear review 2 — feat/active-pieces-integration

Target: base `d29d84c07a` → working tree (committed + the uncommitted fix pass + untracked
`20261021123105_revoke-connections.sql`). Four read-only reviewers (connections/auth, jobs/catalog,
ee engine, erp UI); the lead re-opened every blocker. No typecheck, tests or build were run (RAM rule).
No file crosses 1,000 lines except `ee/catalog/build.test.ts` (980 → 1026).

**Status:** blockers N1–N7 are fixed in `5a29c420be` and `57f8626806`. N4's palette and
`labelKeys` strings stay English, like every other node kind's. N5 folded the branch's connection
migrations into `20261021123100`, `…102` and `…104`. Code-judo, risks and docs below are open.

## Status of review 1 (same day)

- **Fixed:** B1, B2, B3, B5, B7, B8, B9, B10. Code-judo 1 (leftovers below), 3, 4, 5, 6, 7, 8, 10, 11, 12.
  Risks: refresh race, Slack `team_id` across companies, `fromColumn` on vendor JSON, flatten >100,
  `operationOf` fallback, run error redaction, `accountLabelFor` timeout, install race,
  `String(option.value)`, `Object.hasOwn`, `setNotices`, nested output paths, label escaping.
  Nearly all suggestions and docs items.
- **Partial:** B4 (error text — see N3), B6 (see N4), code-judo 9 (ee side still re-spreads),
  `ItemRef.card` (validator yes, runtime no).
- **Open:** code-judo 2 (flat filter fields), CDN logos for non-piece cards, legacy Slack scopes (Q1),
  quote-PDF change in scope, `manifests/schema.json` churn, migration `…123101:39` comment.

---

## Blockers

### N1 [V] A view-only user is navigated out of the builder by opening an integration node
`api+/workflows.options.ts:64` calls `requirePermissions(request, provider.permission)`; the property
provider needs `{ update: "workflows" }` (`workflows.service.ts:825`). On denial `requirePermissions`
throws a redirect with "Access Denied" (`packages/auth/src/services/auth.server.ts:433-439`).
The builder loads with `view` only. `useWorkflowOptions.ts:70-77` fetches even when the form is read-only.
So when a viewer opens a node with a dependent input (calendar, channel), the redirect sends them to the app root.
Fix: authenticate with `view`, check the provider permission against the returned `permissions`
and return `{ options: [], errorCode: "forbidden" }`; don't fetch while `isReadOnly`.

### N2 [V] A failed Accounts-tab connect closes the popup with no message
`integrations.connections.callback.ts:88` replies to `state?.integrationId ?? "connection"`.
If the state is invalid, expired or replaced, the reply goes to `"connection"`.
Every card listener drops a message for another integration id (`IntegrationCard.tsx:136`).
A replaced state is easy to get: Reconnect, then Add account for another account, replaces the pending entry.
Fix: one page-level listener in the integrations route for `"connection"`, or let each card also
accept `"connection"`.

### N3 [V] Vendor request bodies still reach run history (B4 remainder)
`actions/integration.ts:182-184` stores `cause.message`. An Activepieces `HttpError` message is
`JSON.stringify({ response, request: { body } })`. So the step row stores attendees and prose.
`execute.ts:646` (`firstError`) copies them into the run error too.
`integration.test.ts:233-284` only asserts the prefix.
Fix: word the failure from status / structured code; never store the message.

### N4 Untranslated copy, and one step named two ways (B6 remainder)
- `ui/Runs/DataDetail.tsx:17-19` falls back to the engine's English `card.summary`.
- `ui/Runs/runOutcome.ts:21-24` names data steps through `DATA_OPERATIONS[op].label` (English) while
  the step list uses the Lingui hook — breaks "never name one step two ways" (`workflow-run-history.md`).
- `ConnectionsTab.tsx:268-272` renders raw `lastError` (`connections.ts:68,590,644`, migration `…123102:80`).
- `nodes/meta.ts:121-195` palette strings; `labelKeys.ts:87,92` ("an object", "a list of objects").
- [V] "operation" msgids collide with routing operations: de "Add operation" → "Arbeitsgang hinzufügen",
  ja → "工程を追加" (`FilterForm.tsx:195`, `OperationCardEditor.tsx:138,142`). Add a Lingui `context`.

### N5 [V] `createConnection` still chains Supabase writes (AGENTS.md "Never")
Revive path: the vault write (`connections.ts:347`) runs before the row update (`:348-366`).
If the update fails, a Revoked or Expired row holds a live secret. Migration `…123102:16-17` forbids that.
Insert path: row, then vault, then a cleanup delete. The code ignores that delete's error (`:397-401`).
Fix: one `save_connection` RPC, the same shape as `revoke_connections`.

### N6 [V] An existing node loses its whole form when its only account is disconnected
With zero usable accounts, `connected` is false. The `connected` check hides the stored-account banner
(`IntegrationNodeForm.tsx:316-319`). The form says "{app} isn't connected yet" (`:364-376`).
`canConfigure` hides the step and every input (`:129`). `reference/workflows.mdx` promises an
"Open … accounts" banner here. Fix: `canConfigure ||= storedConnectionId !== undefined`; drop the
`connected` gate from the stored-account banner.

### N7 [V] Source comment in a test
`packages/ee/src/integrations/connections.test.ts:242` — "the exact contradiction a customer reported".
Reword neutrally ("the two surfaces disagreed").

---

## Code-judo / simplification

1. **Drop the flat `operation` / `field` / `flatten` filter fields** (still open). `schema.ts:117-123`;
   base `filterNode` never had them. `cardsOf` synthesizes card 0 from `combinator`/`clauses`;
   `operationOf` (`data-operations.ts:96-113`, applied unevenly — no-op at `:186`, `data-node.ts:71`,
   skipped at `data-node.ts:163-271`, `filter.ts:139,268`), the `variables.ts:299-304` probe, the
   "legacy rows" `summary` doc (`runtime/types.ts:134`) and test noise all go.
2. **One `declaredInputs(step)`.** `{ ...inputs, ...advancedInputs }` is written 5× —
   `batch.ts:47`, `nodes.ts:216`, `notices.ts:70-73`, `runtime/integration.ts:35`, `catalog/build.ts:880`.
   A missed copy makes validator, batch plan, hints and run see different inputs.
3. **One `runStep` body.** `runtime/action.ts:21-46` ≈ `runtime/integration.ts:28-54` (resolve, call,
   map to Succeeded/Failed); only the lookup, the GONE text and the service call differ.
4. **Split `connections.ts` client/server.** `ConnectionsTab.tsx:9-13` (browser) value-imports
   `@carbon/ee/integrations/connections`, which holds vault RPCs and the token exchange posting
   `client_secret` (`connections.ts:286-889`); no `.server` suffix, so `no-server-code-in-client`
   can't see it. Move the pure status helpers to `connection-status.ts`; rename the rest `connections.server.ts`.
5. **ERP stops knowing the piece's shape.** `workflows.service.ts:881-900` casts `property.options`
   and hand-builds `{ auth, propsValue }`; the `propsValue` loop (`:889-893`) is dead (every fetched
   prop `dependsOn` only the connection, `properties.ts:47`) under a false comment. Export
   `runPropertyOptions(piece, action, prop, token)` from `@carbon/jobs/integrations`.
6. **One options wire type and one error notice.** `OptionsProviderResult` (`workflows.service.ts:746-762`)
   is copied as `WorkflowOptions` (`useWorkflowOptions.ts:11-19`) → move to `types.ts`.
   `IntegrationNodeForm.tsx:340-361` copies `OptionsField.tsx:106-151`, and a failure fetches the
   connection list twice and shows two "Try again" buttons; the `"refreshing"` branch (`:343`) is
   unreachable. Extract `<OptionsErrorNotice/>`, share the fetcher key.
7. **One `revokeConnections(client, { companyId, pieceName, connectionId?, updatedBy })`** —
   `disconnectConnection` / `revokeConnectionsForPiece` (`connections.ts:428-461`) wrap the same RPC
   with `companyId`/`pieceName` in swapped positions.
8. **One health-cache path.** `settings.service.ts:2671-2709` re-implements `:2723-2760` with another
   policy; pass a `pieceHealthcheck` and a TTL into the shared path.
9. **Fold the unshipped migrations.** `…123103` and `…123105` into `…123101`; delete
   `delete_connection_secret` (no caller); drop `integrationConnection_companyId_idx` and
   `_companyId_pieceName_idx` (covered by PK / unique by left prefix).
10. **`build.ts` fakes declarations.** `:862-866`, `:877-882` pass spread fakes to helpers that read
    only `.inputs`; `buildDeclaredInputs` (`:176-191`) still re-spreads ~10 fields; tuple casts
    `:476-492`, `:511`. Take the inputs map directly.
11. Small indirections: `CONNECTION_INPUT` alias (`integrations/options.ts:17`) beside the real name,
    and `integration.ts:105` uses neither; `integrationStepId` relayed through `catalog/catalog.ts:146`
    and `catalog/index.ts:20`; `inputLabel` (`IntegrationNodeForm.tsx:152-156`) = `labelFor`
    (`StepInput.tsx:69-73`); dead `?? path.to.integrationAccounts(piece)` (`IntegrationNodeForm.tsx:308,334`).

---

## Risks / questions

- [V] **`ItemRef.card` unchecked at run time** — `resolveItem` (`runtime/resolve.ts:205-213`) ignores
  `ref.card`; drafts aren't validated, so a test run reads another list's item.
- [V] **`defaultValue` is now read at run time** — `effectiveLiteral` (`links.ts:28`) inside
  `resolveStepInputs`, against `catalog.ts:63-64` / `AGENTS.md:258-259` ("nothing reads it at run time").
- [V] **Advanced field with a default shows blank** — `LiteralControl.tsx:90-111` ignores `defaultValue`
  for choices/string/number; Gmail `body_type` shows "Select…" while the run sends `plain_text`.
- **Legacy Slack scopes (Q1)** — backfill wrote 10 (`…123102:77`), allowlist needs 16 (`allowlist.ts:241-261`):
  every migrated Slack card reads unhealthy at deploy. Product decision.
- **CDN logos for non-piece cards** — `piece-logo.tsx:18` used by jira/linear/xero/quickbooks/stripe-connect;
  `alt={piece}` is the slug; unrelated logo recolors (email, onshape, rillet, sage, paperless) in scope.
- [V] **`readConnection` throws outside any try** (`piece-auth.ts:56`) → step left Running, later
  "This step was interrupted"; return `{ reason: "failed", cause }`.
- [V] **`dropTransport` strips `config` / `request` at every depth** (`integration.ts:84-86`), not just
  the Gaxios top level.
- [V] **Swallowed, unlogged failures** — `integration.ts:154` (`auth.cause` dropped), `:161-164`
  `catch {}`, `settings.service.ts:2691`, `account.notifications.ts:37`, `send-slack.ts:30`.
- [V] **Rename to a taken name** reads as internal error (`settings.server.ts:1724-1726`), and the row keeps
  showing the rejected name (`ConnectionsTab.tsx:209,225-233`; also `useState` seeded from loader data).
- [V] One `connecting` flag spins every Reconnect / Add account (`ConnectionsTab.tsx:84,154`);
  Disconnect has no confirmation.
- [V] `DateTimePickerState.test.tsx` never renders `DateTimePicker` — reverting `granularity: "minute"`
  (`DateTimePicker.tsx:66-69`) keeps it green.
- [V] Test-run drawer mounted conditionally (`WorkflowBuilder.tsx:212,219`, `open` hard-coded) — cannot
  animate closed, against `packages/react/AGENTS.md`.
- `TimeCombobox` emits `onChange` on every blur, even unedited (`:106-112`).
- [V] Enum inference by id prefix could fire on integration inputs (`build.ts:193-201`).
- Scope: quote-PDF fix (`shared.service.ts:250-256`) and a version sort in `$id.tsx:98-104` (already
  sorted by `getWorkflowVersions`, `workflows.service.ts:118`) are unrelated — split them out.

---

## Suggestions

- Cut: `export { Gmail }` / `{ GoogleCalendar }` (`ee/index.ts:84-85`), `path.to.api.integrationConnectionCallback`
  (`path.ts:167`; `integrations.slack.oauth.ts:26` hardcodes it), public `TimeCombobox` export,
  `getPieceActions`' repeated allowlist check (`registry.ts:79-80`), default `integrations = {}` (`build.ts:366,682`).
- Leftovers in the operation rule: `usesField` ≡ `=== "pluck"` (`data-operations.ts:30`); "no field"
  twice (`:200`, `data-node.ts:272`); "not a list" three times (`data-node.ts:203`, `filter.ts:126,242`);
  dead pluck branches (`filter.ts:179-181,187-188`).
- Types: export `DataCardDetail`; `notices.ts:34` `typeOf` → `ValueType`; `FilterForm.tsx:120` cast;
  `data-node.test.ts` `as never` everywhere (type `EVENT` as `RecordType`; its `typeOf` stub returns the list type for every operand).
- No test pins `result` redaction (`integration.test.ts:408-425` re-tests `redactForLog`).
- `connections.ts:416` `new Date().toISOString()` → `datetime.timestamp()`.
- Orphan JSDoc: `connect.ts:7-16`, `allowlist.ts:11-29`, `hoverIntent.ts:5-13`. `log.ts:163-164` comment
  overclaims `redactText`. `noticeCopy.ts:18` extracts as `{0}`. `Button asChild isDisabled` on a Link
  only dims (`IntegrationNodeForm.tsx:68`). Split `build.test.ts` (now 1026 lines).

---

## Docs freshness

- `docs/.../workflow-apps.mdx:46` says emails are sent as HTML — default `body_type` is `plain_text`.
- `reference/workflows.mdx:49`, `workflow-apps.mdx:34` still say "Filter"; quoted "isn't connected" copy
  differs from the UI; "Advanced … pre-filled" false for non-boolean inputs.
- `apps/erp/app/modules/workflows/AGENTS.md:3,34,105,108` — six node kinds (now seven), "Four controls
  in ActionForm" (five, in `StepInput.tsx`).
- `packages/ee/src/workflows/AGENTS.md:68,98-135,114,116,258-262,373` — layout missing data-node /
  data-operations / links / notices / runtime integration; `WorkflowServices` without `runIntegration`;
  5-arg `buildCatalog`; no `WORKFLOW_INTEGRATION_CATALOG`; four `RuntimeValue` kinds (five); `record`
  ValueType absent; `rendersAsText` line.
- `.claude/rules/workflow-event-catalog.md:39,76,196,204,225` — 2 integration steps, 5-arg `buildCatalog`,
  integrations under Actions, "four maps", staleness check scope.
- `.claude/rules/workflow-actions.md:140` — `WorkflowServices` missing `runIntegration`.
- `.claude/rules/workflow-integrations.md` — `:512` says the default is omitted (code SENDS it,
  `visibility.ts:70-78`); `:127` `DATE_TIME` lacks `precision: "datetime"`; Connect goes to
  `integrationAccounts`, not `integration`; the options key is set in `StepInput.tsx:106`; `paths:` misses
  gmail/slack, `ConnectionsTab.tsx`, `settings.server.ts`, the `20261021123*` migrations.
- `.claude/rules/workflow-engine.md:159`, `workflow-run-history.md` — `detail` is not condition-only
  (`NodeDetail` `kind:"data"`); "never named two ways" now false (N4).
- `packages/ee/AGENTS.md` — `getSlackWorkspace` prefers the oldest Active connection with a webhook channel.
- Stale `@carbon/workflows` in `integrations/options.ts:14`, `registry.ts:12`, `dataOperationLabels.ts:13`.
- Migration `20261021123101:39` comment quotes the old manifest rule.

---

## TLDR

**Blockers**
- N1 viewer redirected out of the builder by the options route
- N2 invalid-state connect closes the popup silently (`"connection"` has no listener)
- N3 vendor request body stored as the step/run error
- N4 untranslated data-step copy, raw `lastError`, "operation" i18n collision, step named two ways
- N5 `createConnection` chains writes (live secret on a Revoked row)
- N6 disconnected-only-account node hides its whole form
- N7 source comment in `connections.test.ts:242`

**Code-judo**
- drop the flat filter fields
- one `declaredInputs`
- one `runStep`
- split `connections.ts` client/server
- `runPropertyOptions` in jobs + delete the dead loop
- one options type + one error notice
- one `revokeConnections`
- one health-cache path
- fold the migrations
- `build.ts` fakes
- small aliases/relays

**Risks**
- `ItemRef.card` at run time
- run-time `defaultValue`
- blank default in Advanced
- legacy Slack scopes
- CDN logos
- `readConnection` throw
- deep `dropTransport`
- unlogged swallows
- rename conflict
- shared `connecting`
- weak DateTimePicker test
- drawer mount
- TimeCombobox blur
- enum inference
- unrelated changes

**Suggestions**
- dead exports
- rule leftovers
- types/casts
- redaction test
- JS Date
- orphan JSDoc
- split `build.test.ts`

**Docs**
- workflow-apps / reference mdx
- erp + ee workflows AGENTS.md
- event-catalog / actions / integrations / engine / run-history rules
- ee AGENTS.md
- `@carbon/workflows` names
- migration comment

## Verdict

**Block.** The fix pass closed review 1's blockers B1, B2, B3, B5, B7, B8, B9 and B10. But this pass
found new user-facing bugs: N1, N2 and N6. Request bodies still leak into run history (N3). A chained
write still breaks the atomicity rule (N5). Code-judo 1, 2 and 3 are each small, and each deletes a
parallel copy of logic.
