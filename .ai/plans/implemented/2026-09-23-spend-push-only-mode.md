# Push-only spend mode, uncoded (spec slice 4)

**Spec:** `.ai/specs/implemented/2026-09-23-spend-management-push-only-mode.md` §2, §3, §5, §7, §9
**Research:** `.ai/research/spend-management-one-way-push.md`
**Depends on:** slice 2 (`provider-roles-topology`) and slice 3 (`spend-outbound-event-engine`)

> **Provisional.** Tasks 1–2 rest on the `InstallMode` / `SyncProviderCapabilities`
> shapes from slice 2 and the `RampProvider` from slice 3. **Re-read
> `packages/ee/src/sync/capabilities.ts`, `packages/ee/src/spend/sync-config.ts` and
> `packages/ee/src/ramp/lib/provider.ts` as they actually landed** before starting.

## Scope boundary

Push-only mode ships here **with bills uncoded**. Carbon requests a reduced scope set,
never claims the accounting seat, pushes purchase orders, item receipts and provisional
bills, and stops forwarding AP to the GL. The customer codes the bill in Ramp.

**Identifier swapping, `accounting_vendor_remote_id`, dropping `remote_id`, and GR/IR
verification are all slice 5** — they are the only parts the Ramp sandbox gates block,
and keeping them out means this slice ships without waiting on them.

## Progress
- [x] Task 1: Declare the two install modes and their scope sets
- [x] Task 2: Per-mode capabilities and the sync-config ceiling
- [x] Task 3: Carry the mode through OAuth via a connect resource route
- [x] Task 4: Stamp the mode, store granted scopes, verify the connection post-connect
- [x] Task 5: Capability-gate converge, healthcheck and uninstall — revoke resolved by decision (see below)
- [x] Task 6: Activate ledger delegation for push-only
- [~] Task 7: Push item receipts — **DROPPED 2026-09-25 (product decision), built then removed**
- [x] Task 8: Decouple the cross-engine dependency
- [x] Task 9: UI — mode picker, card wiring, gated settings, delegated-family locks, drawer mode display
- [x] Task 10: Verification — live against the Ramp sandbox with a non-Carbon incumbent; 2 open items (see `.ai/runs/2026-09-26-ramp-push-only-verification.md`)

## Landed so far (2026-09-25): Tasks 1, 2, 6

**Reconciliation with what slices 3–4 actually left behind**, per this plan's own
provisional warning:

- The scope constant is `RAMP_SCOPES` / `RAMP_OAUTH_SCOPES`, not the
  `RAMP_PROVIDER_SCOPES` this plan named. Renamed to `RAMP_PROVIDER_SCOPES` with
  `RAMP_SCOPES` kept as an alias for the legacy client-credentials path.
- `buildSpendSyncConfig` ALREADY took `min(ceiling, toggle)` — slice 3 built it that
  way, so Task 2 step 3 needed no change.
- **Task 2 step 4 was not implementable as written.** It asked to map the seven
  inbound families onto the resolved `GlobalSyncConfig` entities. They do not map:
  transactions, transfers, cashbacks AND repayments all post as `charge`, so routing
  through entities would collapse `pullTransactions` and `pullReimbursements` into one
  switch. The ceiling is therefore per-FAMILY, in Ramp's own vocabulary
  (`ramp/lib/modes.ts`), and `isRampInboundFamilyEnabled(family, metadata)` checks the
  mode's ceiling first and the stored toggle second.
- The family gate MOVED from `@carbon/jobs` to `@carbon/ee/ramp.server`, because it now
  needs the mode and the mode lives with its profile. `ramp-sync-policy.ts` re-exports
  it so the family modules are unchanged.

**Task 6 hit its STOP condition, and the plan's instruction was right.** Slice 2's
*derivation* is correct — but it sourced capabilities from the DESCRIPTOR, which is
static. Once modes exist that is false: the same integration installed two ways must
answer differently, and only the row knows which way. Fixed in slice 2's files, not
worked around here:

- `CompanyIntegrationRow` carries `metadata`; `ProviderDescriptor` gains
  `resolveInstallCapabilities(metadata)`; `pickActive` prefers it over the static
  declaration. The topology core still imports no provider — the resolver is injected,
  exactly as the registry slice already was.
- `loadIntegrationTopology` selects `metadata` (without it push-only resolves as
  provider — silently).

`topology.delegation.test.ts` then proves the whole chain through the real descriptor
resolver and the real `POSTING_POLICY` derivation: AP → `"none"`, `bill` AND
`reimbursement` disabled (which is only true if it reads POSTING_POLICY rather than a
hard-coded `"bill"`), AR untouched, `payment` NOT disabled, provider mode and
mode-less installs unchanged.

Gates: ee + jobs + erp typecheck, lint 37/37, test 31/31 (1690 ee tests).

## Tasks 3–4 landed (2026-09-25)

`api+/integrations.$id.connect.ts` builds the authorize URL SERVER-SIDE from the
descriptor's chosen mode, so the scope list is never assembled from anything the
browser supplied — that is the reason the route exists rather than the card building
the URL. The mode rides the signed, HttpOnly state cookie
(`OAuthStateExtras`); `consumeOAuthState` now returns the stored payload, but ONLY
when the state was valid, so an invalid state cannot hand the caller
attacker-supplied values. An unknown OR absent mode is an error redirect, never a
silent default — defaulting would request `accounting:write` against a customer who
chose push-only.

The callback stamps three new OAuth-owned metadata paths: `syncMode` (from the signed
state), `grantedScopes` (what the token response ACTUALLY returned — RFC 6749 §3.3
permits a narrower grant, so the requested set is an intention and this is the fact),
and `accountingConnectionProvider`.

Not in the plan, found while building:

- **`logger.warn` does not exist** — the logger exposes `warning`. Caught by a test
  whose mock only declared the real methods, which is the argument for that mock being
  narrow.
- **The role-conflict guard is currently unreachable for spend**, because Ramp is the
  only registered spend provider. The connect test's registry mock is role-aware and
  uses a stand-in second provider, or the guard would be untestable — and silently so.
- 7 connect-route tests + 3 new callback tests, including that a forged `?mode=` in the
  query string does NOT reach the stored install.

## Task 9 partial + LIVE VERIFICATION of the connect flow (2026-09-25)

`InstallModeDialog` renders one card per declared mode and hands the choice to the
connect route. `IntegrationCard` routes an integration declaring `modes` through it.

**Every OAuth integration now starts at the connect route.** A first pass left the other
five (jira, onshape, quickbooks, slack, xero) on the old client-built popup path, on the
theory that moving them was unnecessary blast radius. That was wrong, and checking the
callbacks showed why: none of the five references `window.close` or `opener`, and all
five end in a `redirect(...)` — so **none of them ever wanted a popup**. `window.open`
was the worse UX all along (new tab gets redirected, original tab goes stale).

So the abstraction is: the card asks ONE question — does this integration need something
answered before consent (`modes.length > 0`)? — and everything else is the connect
route's business. Three things improved for the other five as a side effect:

- The scope list is assembled server-side from the descriptor instead of in the browser.
- They get a SIGNED, HttpOnly, browser-bound, single-use state instead of an unsigned
  `crypto.randomUUID()` correlation value. Their callbacks still ignore it, but the card
  no longer has two notions of "state" and the groundwork is there.
- **`redirect_uri` now matches between authorize and token exchange BY CONSTRUCTION.**
  Xero, QuickBooks and Ramp already derived it from `getAppUrl()` at exchange time while
  the card built it from `window.location.origin` at authorize time; they agreed only
  because those happened to be equal. Four stale comments saying "IntegrationCard builds
  it from `window.location.origin`" were corrected.

The loader now issues no OAuth state at all, and `integrations.oauth-state.test.ts`
asserts both halves of that — reintroducing one would be a downgrade, not a convenience.

`integration-oauth.ts` moved out of `ui/Integrations/` to `modules/settings/`, since no
UI imports it any more.

**Pre-existing, surfaced by testing this:** `/api/integrations/xero/connect` reaches
Xero and is refused `invalid_request / Invalid redirect_uri`. Not a regression — the
redirect_uri is byte-identical to what the old path produced (in this dev env
`getAppUrl()` IS the browser origin); the Xero app simply is not registered for the
`erp.<branch>.dev` hostname. Ramp is, which is why it works.

The loader no longer issues Ramp's state; `integrations.oauth-state.test.ts` was
INVERTED to pin that, because a loader-issued state cannot carry a mode — an install
started from one would land with no mode and silently resolve to `provider`, i.e. the
customer picks "another system posts my ledger" and Carbon records the opposite.

**Live-verified against Ramp's real authorize endpoint** (sandbox, non-destructive — no
consent completed, nothing installed):

| Request | Result |
|---|---|
| `?mode=push-only` | Ramp accepted. Scopes: `accounting:read bills:read bills:write vendors:read vendors:write purchase_orders:read purchase_orders:write entities:read business:read offline_access` — **`accounting:write` ABSENT** |
| `?mode=provider` | `accounting:write` present, full inbound set |
| `?mode=nonsense` | Redirected back to settings; **did NOT reach Ramp** |
| mode omitted | Same |

That Ramp advanced to its sign-in page rather than answering `invalid_scope` also
confirms the console app is configured for every scope both modes request — consistent
with Brad's note that `item_receipts:write` was already there.

## Task 9 COMPLETE (2026-09-25)

The three remaining pieces are in, and each is declarative rather than id-branched.

**Gated settings — `IntegrationSetting.availableWhen`.** A setting declares a predicate
over the install's RESOLVED capabilities (`(c) => c.ownsRemoteCodingSurface`); the form
resolves those once via the descriptor's `resolveInstallCapabilities` and drops the
setting before grouping. **The Accounts group therefore disappears for free** — the form
builds its group list from the surviving settings, so there is no second group-level flag
to keep in step. Ramp tags four account settings + three pull toggles. Pinned by
`packages/ee/src/ramp/config.test.ts` (4 tests; verified non-vacuous — removing ONE gate
turns two of them red).

`ownsRemoteCodingSurface` is not a proxy for "does Carbon pull": Ramp sends activity to
whichever system holds its accounting-connection seat, and that seat IS this capability
(it is the single predicate behind all six `accounting:write` calls).

**Two things this uncovered, both real bugs, both fixed:**

1. `convergeRamp` returned early on `!metadata.cardLiabilityAccountId` — and that return
   sits BEFORE the sync enqueue. A push-only install legitimately has no card account, so
   it would have pushed nothing until the next hourly sweep. Now scoped to the seat-holder.
2. `cardLiabilityAccountId` was `z.string().min(1)`. With the field hidden, the whole
   settings form became unsaveable in push-only — a customer could not change a Sync
   toggle. Now `.optional()`, with requiredness enforced where the mode IS known
   (`convergeRamp` + `rampHealthcheck`, both behind `rampOwnsCodingSurface`). This is a
   deliberate weakening of form validation with the compensating control named.

A gated-out setting's stored value is PRESERVED, not cleared (the form omits the field and
the save merges over existing metadata). It stays inert because the runtime checks the
ceiling before the toggle, so a value left from another mode can never re-enable anything.

**Delegated families — the Posting tab.** Keyed over `LEDGER_FAMILY_KEYS`, never a
hard-coded `"ap"`: the loader resolves the topology and maps every family whose owner is
`external` to that integration's display name, and all four selects (AR, AP, Credit Memos,
Vendor Credits) render through one `FamilyRepresentationField`. A spend platform that
delegates AR or a memo family needs no change here. Delegated renders a read-only
"Handled by Ramp" notice **plus a hidden input carrying the stored value** — both halves
matter: the validator requires the field, so omitting it would make the tab unsaveable,
and posting `"none"` would destroy the customer's real choice. Uninstalling the delegating
integration restores exactly what they had.

Read from the TOPOLOGY, not from the integration's own metadata: the delegation is declared
by the spend install's mode while the select being locked belongs to the accounting
integration — never the same row.

**Mode in the drawer — `resolveInstallMode`.** A sibling of `resolveInstallCapabilities`
rather than a fixed metadata key, because the key is the integration's own (Ramp stores
`syncMode`) and shared settings UI should not know it. Returns `{ id, detail? }`; the form
looks the id up in the descriptor's declared `modes` and renders that mode's label, the
optional detail ("Ledger held by Rillet"), and "To change it, uninstall and reconnect in a
different mode." `detail` undefined means "Carbon could not tell" — a real state, since the
peer read is best-effort — and is never rendered as "nobody".

Per the plan, the Charges nav is deliberately untouched (`85735ce2c1` removed that gate).

Gates: `pnpm run test` 31/31, `pnpm run lint` 37/37, erp + ee typecheck clean.

### FOLLOW-UP this created: push-only's bill-payment pull is not toggleable

Gating `pullBills` hides the toggle that, in push-only, gates the one inbound family that
survives — bill payments, which is what tells a Carbon invoice it was paid. That is
deliberate: `pullBills` is ONE stored toggle covering bills AND their payments, and its
label describes the bills half, which push-only never does. Showing "Pull Ramp bills into
Carbon as purchase invoices" to the customer who chose "another system posts my ledger"
would read as the exact double-posting they installed this mode to avoid.

The cost is that the surviving pull has no customer control. Splitting the toggle into
`pullBills` + `pullBillPayments` is the fix; it needs a metadata migration for existing
installs, so it is not folded in here.

## ANSWERED (2026-09-26) — yes, a push-only token CAN read `/accounting/all-connections`

Verified on a real narrow grant (10 scopes, no `accounting:write`): the read
returns 200, while `DELETE /accounting/connection` returns
`403 DEVELOPER_7100: These scopes are not allowed for this token: accounting:write`.

So the peer-owner display and the healthcheck both work in push-only, and the
fail-soft "treat a refusal as UNKNOWN" path is a safety net rather than the
expected case. The original question and its reasoning are kept below.

## (original) OPEN QUESTION — can a push-only token read `/accounting/all-connections`?

**Unresolved, and it decides how push-only reports its own health.**

Push-only needs to know WHICH system holds Ramp's accounting seat, for two reasons:
`metadata.accountingConnectionProvider` (shown in the details drawer) and the
healthcheck's "is there a peer connected at all?" test. Both read
`GET /developer/v1/accounting/all-connections`.

What is known:
- The endpoint and path are live. Ramp's health badge reads HEALTHY, and
  `rampHealthcheck` only returns true after that call comes back with a linked
  connection (verified 2026-09-25, provider-mode token).
- Ramp enforces scopes at the RESOURCE call, not at token mint
  (`.ai/research/ramp-sandbox-verification.md`): a token mints for any requested scope
  string and the endpoint is the real gate, answering
  `403 DEVELOPER_7100 "These scopes are not allowed for this client: <scope>"`.

What is NOT known: whether `accounting:read` ALONE suffices, or whether Ramp treats
`/accounting/*` as provider-only and requires `accounting:write` — in which case a
push-only install can never see its peer.

Why it is still open: it needs a real push-only token, i.e. an actual push-only connect.
That is now possible with no Ramp Developer Console change (item receipts were dropped,
so push-only requests a strict subset of provider mode), so this resolves as soon as
Tasks 3–4 are testable end to end.

**Both outcomes must be handled, so the code should not assume either:**
- Works → record `accountingConnectionProvider`, and report unhealthy when no peer.
- 403 → Carbon cannot see the peer. `accountingConnectionProvider` stays undefined and
  the healthcheck must NOT treat that as unhealthy, or every push-only install reads
  broken. The drawer then says "managed by your accounting system" without naming it.

Task 4 therefore treats a failed read as UNKNOWN rather than as absent.

## STOP conditions — both hit, 2026-09-25

**Task 4 (sandbox gate 2) — PARTIALLY CLEARED.** `GET /accounting/all-connections`
works: Ramp's health badge reads HEALTHY, and `rampHealthcheck` only returns true
after that call returns a linked connection. So the endpoint and its path are live
(the `TODO(task-1)` on `getAccountingConnections` can be closed). What is still
UNKNOWN is the actual push-only question — whether a token WITHOUT
`accounting:write` may call it. That cannot be tested until the Ramp Developer
Console lists `item_receipts:write` and a push-only connect is possible, which is a
manual step outside this repo.

**Task 5 — FIRED, and RESOLVED by a product decision: accept the stale grant.**

Ramp exposes no token-revocation endpoint. Confirmed against two
independent sources (`docs.ramp.com/llms-api.txt` and the OpenAPI
`developer-api.json`): the only disconnect-shaped endpoint is
`DELETE /developer/v1/accounting/connection` ("only allows disconnecting API based
connections"), which retires the ACCOUNTING CONNECTION, not the OAuth grant — and in
push-only mode Carbon must not call it at all, because that connection belongs to the
other provider. There is no `/token` revocation sibling and the word "revoke" does not
appear in the spec.

Consequence: **uninstall cannot narrow what Carbon holds.** A customer who installs in
provider mode, uninstalls, and reinstalls "in push-only" may still hold a grant
carrying `accounting:write` while the UI says otherwise. Mode immutability is
enforceable in Carbon's own state but NOT at Ramp.

**DECIDED (Brad, 2026-09-25): accept the stale grant.** Carbon does not attempt to
revoke, and a reinstall may still HOLD `accounting:write`. The enforcement is therefore
that Carbon never USES it — which only holds if every write-scope call sits behind one
gate, so it is now exactly one predicate, `rampOwnsCodingSurface`, with the call list
kept in its doc comment:

| Call | Where |
|---|---|
| `POST /accounting/connection` | `convergeRamp` |
| `DELETE /accounting/connection` | `rampOnUninstall` |
| `POST /accounting/accounts` | `pushChartOfAccounts` |
| `POST /accounting/fields` | `pushCostCenters` / `pushProjects` |
| `POST /accounting/field-options` | same |
| `POST /accounting/syncs` | `confirmSyncs` |

**The confirm was the one this nearly missed.** `POST /accounting/syncs` needs
`accounting:write`, and push-only DOES reach it — it still pulls bill payments, which
confirm. Without the gate every run would 403. Gating inside `confirmSyncs` (which
already loads the integration) covers all four call sites at once, and skipping is safe
for the same reason repayments have never confirmed: idempotency is the
`externalIntegrationMapping`, not the confirm. It is also correct on the merits — the
sync status being cleared belongs to whichever system Ramp is connected to.

Other Task 5 outcomes:
- `rampOnUninstall` deletes the accounting connection ONLY when Carbon owns it.
  Deleting another provider's connection would silently break THEIR sync.
- `rampHealthcheck` requires `cardLiabilityAccountId` only when Carbon owns the coding
  surface (push-only never pulls a card charge), and requires a linked connection owned
  by ANYONE rather than specifically by Carbon. Push-only with no peer connected reads
  unhealthy — which is why the connect flow deliberately does not fail on it.
- Four hook tests pin the gating, verified non-vacuous (removing the gate turns the
  push-only test red).

## Task 7 DROPPED — item receipts are not wanted

Built, then removed the same day on Brad's decision. Recording why, because the
reasoning is what matters if it is ever revisited.

**The justification did not survive scrutiny.** The spec (§7) argued three-way match:
"bill, PO and item receipt reference the same line items". But Carbon pushes the PO with
`three_way_match_enabled: false`, so those cannot both be the reason. Tracing that
`false`: the research note records the field as REQUIRED by Ramp on create with its value
"a product decision — likely `false`". It was a guess to satisfy a required field, and
"Carbon owns receiving, not Ramp" was a rationalisation attached afterwards — including
in the comment the new syncer shipped with.

**Nothing about the feature was verified.** Four unverified links:

1. Ramp accepts `POST /item-receipts` with this payload.
2. `purchase_order_line_item_id` takes CARBON's line id — flagged VERIFY in code and
   expected to be wrong, since Ramp's own line ids are never returned to Carbon.
3. Ramp does anything useful with a receipt while three-way match is off.
4. **Ramp relays the receipt to the system holding the accounting seat.**

**Link 4 was the only real reason to want it.** The genuine need is GR/IR, not Ramp's UI:
Carbon receives goods and accrues goods-received/invoice-received, and in push-only the
OTHER system posts AP, so only that system can clear the accrual — and only if the
receipt reaches it. That is exactly what the spec's own Coupa → SAP analogy means. But
Carbon pushes to Ramp, not to Rillet, and whether Ramp forwards item receipts to its
connected provider was never checked.

**Removed in full rather than left dormant**, because a registered syncer with a
known-suspect contract reads as working: `RampItemReceiptSyncer`, `spend/item-receipt-source.ts`,
`createItemReceipt`, the `receipt` subscription and table-map entry, the
`SPEND_PUSHED_RECEIPT_STATUSES` gate, `itemReceipt` in `AccountingEntityType` /
`ENTITY_DEFINITIONS` / `DEFAULT_SYNC_CONFIG`, and both mode ceilings.

**Consequences:**
- `item_receipts:write` is gone from the push-only scope set, so push-only is now a
  strict SUBSET of provider mode. **CORRECTION (Brad, 2026-09-25): the "manual console
  step" this plan and an earlier draft of these notes described was never a real cost —
  Carbon's Ramp app is already configured for `item_receipts:write`.** So not requesting
  it is a choice (do not ask a customer to consent to a write scope Carbon never uses),
  not a workaround. `scopes.test.ts` keeps the subset assertion for the weaker but still
  useful reason: the modes differ only by removal, so push-only can never request
  something provider mode has not already exercised in production.
- The `XERO_DISABLED_ENTITIES` / `QBO_DISABLED_ENTITIES` lists I added existed only to
  force `itemReceipt` off; with it gone they were empty, so they went too. Rillet's
  pre-existing list is back to its original four.

If GR/IR is revisited (slice 5), start at link 4 — it decides whether any of the rest
is worth building.

## Dependencies
- Task 2 needs Task 1. Tasks 3–4 need Task 1. Task 5 needs Task 2.
- Task 6 needs Task 2 (it activates slice 2's dormant derivation).
- **Tasks 6, 7 and 8 are independent of each other.**
- Task 9 needs Tasks 1–6. Task 10 needs everything.

---

## Task 1: Declare the two install modes and their scope sets

**Depends on:** none (after slices 2–3)
**Files:**
- Modify: `packages/ee/src/ramp/scopes.ts` — replace the single list with per-mode sets
- Create: `packages/ee/src/spend/types.ts` — `InstallMode`, `SpendProviderDescriptor`
- Modify: `packages/ee/src/ramp/config.tsx` — declare `modes`
- Copy from (precedent): `packages/ee/src/ramp/scopes.ts` as it stands (the browser-safe,
  no-node-imports constraint is load-bearing — `config.tsx` is client-bundled)

**Steps:**
1. Keep `scopes.ts` browser-safe. Export:
   ```ts
   export const RAMP_PROVIDER_SCOPES = [...] as const;   // today's list verbatim
   export const RAMP_PUSH_ONLY_SCOPES = [
     "accounting:read",     // enumerates the ACTIVE provider's coding surface — keep
     "bills:read",          // bill payments and BILL_SYNCED
     "bills:write",
     "vendors:read", "vendors:write",
     "purchase_orders:read", "purchase_orders:write",
     "item_receipts:write",
     "entities:read", "business:read",
     "offline_access"
   ] as const;
   ```
   Push-only omits `accounting:write`, `transactions:read`, `transfers:read`,
   `cashbacks:read`, `statements:read`, `receipts:read`, `reimbursements:read` and
   `repayments:read`.

   **Take `RAMP_PROVIDER_SCOPES` verbatim from `scopes.ts` as it stands — do not
   reconstruct it from this plan.** `repayments:read` was added in `a4db1e4c79` after
   this plan was written, because without it Ramp answers
   `403 DEVELOPER_7100 "These scopes are not allowed for this token"`, the repayments
   family logs "drain failed" and returns nothing — every run, silently. A scope missing
   from either set fails quietly, not loudly.
   Grounded in the per-endpoint `security` blocks of
   `docs.ramp.com/openapi/developer-api.json`: `/bills/drafts`, `/purchase-orders`,
   `/vendors` and `/item-receipts` require only their own resource scopes.
2. `item_receipts:write` and the push-only set must be added to the **Ramp Developer
   Console** app's configured scope list, which stays the superset of both modes —
   Ramp returns `invalid_scope` "Requested scope not configured for app" otherwise.
   **This is a manual console step; note it in the PR and confirm before testing.**
3. Declare `modes` on the descriptor with user-facing `label`/`description`:
   `"Carbon is my accounting system"` / `"Another system posts my ledger"`. Run
   `/translate` for both.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=erp
# Expected: exit 0
pnpm --filter @carbon/ee test -- scopes
# Expected: a test asserting push-only omits accounting:write and includes
# accounting:read and item_receipts:write
```

**Out of scope:** using the modes.

---

## Task 2: Per-mode capabilities and the sync-config ceiling

**Depends on:** Task 1
**Files:**
- Modify: `packages/ee/src/ramp/config.tsx` — attach `capabilities` + `syncConfig` per mode
- Modify: `packages/ee/src/ramp/lib/provider.ts` — read capabilities from the stored mode
- Modify: `packages/ee/src/spend/sync-config.ts` — ceiling ∧ toggles
- Modify: `packages/jobs/src/inngest/functions/integrations/ramp-sync-policy.ts` —
  `isRampInboundFamilyEnabled` takes the resolved config

**Steps:**
1. `provider` mode: `ownsRemoteCodingSurface: true`, `ownsLedgerFamilies: []`, ceiling
   allows every entity Ramp syncs today.
2. `push-only` mode: `ownsRemoteCodingSurface: false`, `ownsLedgerFamilies: ["ap"]`,
   ceiling allows `purchaseOrder`, `bill`, `itemReceipt` outbound and — inbound — **only
   bill payments**. Every other inbound family is ceiling-false.
3. The ceiling is a **hard** gate: `buildSpendSyncConfig` takes `min(ceiling, toggle)`,
   so a settings save can narrow but never widen. Defaulting the toggles off instead
   would let a later save silently re-enable an inbound pull and recreate the
   double-count fixed on 2026-09-10.
4. `isRampInboundFamilyEnabled(family, resolvedConfig)` replaces the
   `(family, sync)` signature. Map the seven families onto the resolved entities the
   same way it maps them onto the three flags today.
5. An install with no stored `syncMode` resolves to `"provider"` — every existing
   install is untouched.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- sync-config
pnpm --filter @carbon/jobs test -- ramp-sync-policy
# Expected: push-only yields false for transactions/transfers/cashbacks/bills/
# reimbursements/repayments and true for billPayments, regardless of stored toggles;
# provider mode is unchanged from today for every family
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** the connect flow.

---

## Task 3: Carry the mode through OAuth via a connect resource route

**Depends on:** Task 1
**Files:**
- Create: `apps/erp/app/routes/api+/integrations.$id.connect.ts`
- Modify: `packages/auth/src/lib/oauth-state.server.ts` — `OAuthStatePayload` gains
  `mode?: string`; `consumeOAuthState` returns the stored payload
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx` — remove
  the `integration.id === "ramp"` special case; route through the new endpoint
- Modify: `apps/erp/app/routes/x+/settings+/integrations.tsx` — remove `oauthStates`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.ramp.oauth.ts` (the
  `requirePermissions` + `getAppUrl()` + redirect shape)

**Steps:**
1. The route is a `loader` with `config = { runtime: "nodejs" }`. It:
   `requirePermissions(request, { update: "settings" })` → rejects when the
   integration's `providerRole` already has a different active member (slice 2's
   topology) → validates `mode` against the descriptor's declared modes →
   `issueOAuthState({ integrationId, userId, companyId, mode })` → 302 to the authorize
   URL built **server-side** from that mode's scopes → sets the state cookie.
2. `consumeOAuthState` must return `{ valid, cookie, payload }`. Keep every existing
   check (expiry, nonce, integration/user/company match) and keep the session
   single-use regardless of match.
3. `IntegrationCard.handleInstall` for an integration declaring `modes` opens the mode
   dialog (Task 9) and then navigates to
   `/api/integrations/{id}/connect?mode={chosen}`. For an OAuth integration with no
   `modes`, behaviour is unchanged.
4. **An unrecognised or absent `mode` is a 400, never a silent default** — silently
   defaulting to `provider` would request `accounting:write` against a customer who
   chose push-only.

**Verify:**
```bash
pnpm --filter erp test -- integrations.$id.connect
# Expected: tests for happy path, unknown mode → 400, role conflict → redirect with
# role-conflict, missing permission → throws
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/auth
# Expected: exit 0
```

**Out of scope:** the dialog UI (Task 9).

---

## Task 4: Stamp the mode, store granted scopes, verify the connection post-connect

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/routes/api+/integrations.ramp.oauth.ts`
- Modify: `packages/ee/src/ramp/lib/state.ts` — add `syncMode`, `grantedScopes`,
  `accountingConnectionProvider` to the OAuth-owned path set
- Modify: `packages/ee/src/ramp/lib/models.ts` — add the three fields to
  `RampIntegrationMetadataSchema`
- Modify: `packages/ee/src/ramp/lib/connection.ts` — `exchangeRampOAuthCode` returns the
  token response's `scope`

**Steps:**
1. Read `mode` off the consumed state and write it as `metadata.syncMode` through
   `patchRampOAuthCredentials` — the same atomic patch, an additional owned path. Never
   a read/merge/write.
2. **Store the scopes the token response actually returned**, not the requested set.
   RFC 6749 §3.3 permits the authorization server to issue narrower scope than asked
   for, and it must then include `scope` in the response.
3. After a successful exchange, call `GET /accounting/all-connections` (needs only
   `accounting:read`) and record the active connection's `remote_provider_name` as
   `metadata.accountingConnectionProvider`.
4. In push-only mode, if no other provider holds an active connection — or Carbon does —
   complete the install but record the mismatch so `rampHealthcheck` reports unhealthy
   with that reason. **Do not fail the connect**: the customer may connect Rillet to
   Ramp afterwards, and failing here would strand a valid token.
5. **If `all-connections` returns 403 for a non-provider app, STOP and report** — that
   is sandbox gate 2 and it also decides slice 5.

**Verify:**
```bash
pnpm --filter erp test -- integrations.ramp.oauth
# Expected: tests asserting syncMode is stamped from the signed state (not a query
# param), grantedScopes comes from the token response, and a missing peer connection
# yields an unhealthy-but-installed integration
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** revoke-on-uninstall (Task 5).

---

## Task 5: Capability-gate converge, healthcheck and uninstall

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/ramp/hooks.server.ts` — `convergeRamp`, `rampOnUninstall`,
  `rampHealthcheck`
- Modify: `packages/ee/src/ramp/config.tsx` — `cardLiabilityAccountId` required only
  when the resolved config enables `charge`

**Steps:**
1. In `convergeRamp`, wrap `ensureRampConnection`, `pushChartOfAccounts`,
   `pushCostCenters` and `pushProjects` in a single
   `if (caps.ownsRemoteCodingSurface)`. Nothing can push coding masters without holding
   the connection, so one gate covers all four.
2. Keep `ensureRampWebhook` in both modes — the webhook is a latency nudge that fires
   `ramp-sync`, and push-only still pulls bill payments.
3. `rampHealthcheck`: require `cardLiabilityAccountId` only when the resolved config
   enables `charge`; require an active connection **owned by someone** rather than
   specifically by Carbon; and report unhealthy when push-only finds no peer provider
   (Task 4).
4. `rampOnUninstall`:
   - **must not** call `deleteAccountingConnection` when `ownsRemoteCodingSurface` is
     false — that connection belongs to the accounting provider;
   - **must revoke the Ramp grant**, not merely clear Carbon's row. Re-authorizing with
     a shorter scope list is not reliably a narrowing (Google requires an explicit
     revoke; Slack's scopes are purely additive; Ramp documents neither), so without a
     revoke a reinstall "in push-only" could still hold `accounting:write` while the UI
     says it does not.
   - **If Ramp exposes no token-revocation endpoint, STOP and report** — the mode
     immutability story depends on it, and the fallback (telling the customer to
     disconnect Carbon inside Ramp) is a product decision, not an implementation one.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- hooks.server
# Expected: push-only converge creates no connection and pushes no masters; uninstall
# does not call deleteAccountingConnection; provider mode is unchanged
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: exit 0
```

**Out of scope:** UI.

---

## Task 6: Activate ledger delegation for push-only

**Depends on:** Task 2
**Files:**
- Modify: none in the derivation itself — slice 2 built it; this task **activates** it
  by virtue of `ownsLedgerFamilies: ["ap"]` existing on the push-only mode
- Create: `packages/ee/src/sync/topology.delegation.test.ts`

**Steps:**
1. Confirm end to end that with a push-only spend integration installed,
   `resolveSyncConfig` returns `entities.bill.enabled === false` and
   `resolvePostingSyncSettings` returns `families.ap === "none"`, derived through
   `POSTING_POLICY` and not hard-coded.
2. Confirm `families.ar` is untouched and `isPaymentSyncbackEnabled(metadata, "ar")`
   still returns true — AR keeps pulling payments while AP stops.
3. Confirm a posted purchase invoice records `Excluded / FAMILY_OFF` and **not** a
   `DOC_SYNC_DISABLED` Warning. That pairing is the whole reason both knobs move
   together.
4. Confirm the `payment` entity is **not** disabled — `Payment` is a `per-line` family
   and disabling it wholesale would break the AR side.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- topology.delegation
# Expected: all four assertions pass
pnpm --filter @carbon/jobs test -- accounting-sync-operations
# Expected: a posted purchase invoice under delegation yields FAMILY_OFF
```
**If this requires any code change beyond adding the capability value, slice 2's
derivation is wrong — STOP and fix it there, not here.**

**Out of scope:** the Posting tab UI (Task 9).

---

## Task 7: Push item receipts

**Depends on:** Task 2
**Files:**
- Modify: `packages/ee/src/accounting/core/types.ts` — add `itemReceipt` to
  `AccountingEntityType`
- Modify: `packages/ee/src/accounting/core/models.ts` — add `itemReceipt` to
  `ENTITY_DEFINITIONS` (`dependsOn: ["purchaseOrder"]`) and `DEFAULT_SYNC_CONFIG`
  (`enabled: false`, `direction: "push-to-accounting"`, `owner: "carbon"`)
- Modify: `providers/{xero,quickbooks-online,rillet}/provider.ts` — add `itemReceipt`
  to each `*_DISABLED_ENTITIES`
- Create: `packages/ee/src/spend/item-receipt-source.ts` — the Carbon-side load
  (receipt + lines + the mapped purchase order), sibling of
  `purchase-order-source.ts` / `bill-source.ts`
- Create: `packages/ee/src/ramp/entities/item-receipt.ts` — the WIRE only
- Modify: `packages/ee/src/spend/gates.ts` — which receipt statuses push
- Modify: `packages/ee/src/ramp/lib/client.ts` — `POST /developer/v1/item-receipts`
- Modify: `packages/ee/src/accounting/core/subscriptions.ts` — add
  `{ table: "receipt", operations: ["INSERT", "UPDATE"] }` to the Ramp set
- Modify: `packages/jobs/src/inngest/functions/events/sync-tables.ts` — add
  `receipt: "itemReceipt"`
- Copy from (precedent): the slice-3 split — `spend/purchase-order-source.ts` (what to
  load, provider-neutral) paired with `ramp/entities/purchase-order.ts` (the wire).
  **Follow that split**: a third entity written the old way would put three copies of
  Carbon-side loading inside one provider's directory.

**Steps:**
1. Adding to `AccountingEntityType` makes it a compile error for any provider's
   `build*SyncConfig` and for `DEFAULT_SYNC_CONFIG` to omit a decision — that is the
   intended totality property. Fix each by force-disabling it for the three accounting
   providers.
2. **Split the work the way slice 3 landed**: `spend/item-receipt-source.ts` loads the
   receipt, its lines and the parent PO's mapping and decides eligibility;
   `ramp/entities/item-receipt.ts` maps that to `purchase_order_id`,
   `item_receipt_number`, `received_at` and
   `item_receipt_line_items[].purchase_order_line_item_id`, and writes. Nothing about
   which rows to read or which receipts qualify is Ramp-specific. It depends on the PO
   being mapped — use the deferral from Task 8, not a synchronous JIT call.
3. `receipt` already carries `attach_event_trigger`
   (`20260218000000_expand_audit_log_entities.sql:135`). **No migration.**
4. A table in `REQUIRED_SYNC_SUBSCRIPTIONS` with no `TABLE_TO_ENTITY_MAP` entry is a
   dead letter — slice 3 Task 9's test now catches that.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- item-receipt
pnpm --filter @carbon/jobs test -- subscriptions-mapping
# Expected: both pass; the mapping invariant covers receipt -> itemReceipt -> syncer
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs
# Expected: exit 0
```

**Out of scope:** three-way-match verification in Ramp (Task 10).

---

## Task 8: Decouple the cross-engine dependency

**Depends on:** none (after slice 3)
**Files:**
- Create: `packages/ee/src/sync/defer.ts` — `requireMappingOrDefer`
- Modify: `packages/ee/src/ramp/entities/bill.ts` and `purchase-order.ts`
- Modify: `packages/ee/src/accounting/core/types.ts` — extract
  `ensureDependencySynced` to a free `ensureEntitySyncedToAccounting`
- Modify: `packages/jobs/src/inngest/functions/integrations/accounting-sync-operations.ts`
  — re-reconcile on a mapping write
- Copy from (precedent): `packages/ee/src/accounting/core/types.ts:140-150`
  (`dependsOnMapping` — the shipped pull-side version of exactly this pattern) and
  `:1024-1090` (`ensureDependencySynced`)

**Steps:**
1. `requireMappingOrDefer({ kind, carbonId, accountingIntegrationId })` returns the
   remote id when the mapping exists; otherwise it **enqueues an ordinary
   `push-to-accounting` ledger operation** for that entity on the accounting
   integration and returns null. It never performs the push inline — the spend engine
   must not block on the accounting provider's HTTP round-trip, inherit its failure
   modes, or merge two retry policies.
2. **Bills wait** — `shouldSync` returns a skip reason and a
   `AWAITING_VENDOR_MAPPING` Warning. **Purchase orders do not** — a PO does not post
   to a GL, so it pushes with the vendor link absent and is patched on a later run.
   That asymmetry means the common case never blocks.
3. Lift `ensureDependencySynced` off `BaseEntitySyncer` into a free function over the
   public `SyncFactory.getSyncer(...).pushToAccounting(...)`, and retire the
   `(syncer as any).getRemoteId` cast. It is used by the *deferred enqueue*, not as an
   inline call.
4. On an `externalIntegrationMapping` write for `(vendor, X, <accounting provider>)`,
   re-reconcile the spend-pushable documents for supplier X. Turns "next sweep" into
   seconds.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- defer
# Expected: a bill with no vendor mapping is skipped with AWAITING_VENDOR_MAPPING and
# an accounting push op is enqueued; a PO with no vendor mapping is PUSHED
pnpm --filter @carbon/jobs test -- accounting-sync-operations
# Expected: a vendor mapping write re-enqueues the waiting bill
```

**Out of scope:** `accounting_vendor_remote_id` (slice 5).

---

## Task 9: UI — mode picker, gated settings, locked posting, nav

**Depends on:** Tasks 1–6
**Files:**
- Create: `apps/erp/app/modules/settings/ui/Integrations/InstallModeDialog.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationForm.tsx` — hide
  capability-irrelevant settings
- Modify: `apps/erp/app/modules/settings/ui/Integrations/PostingSyncSettings.tsx` —
  lock the AP select when delegated
- Copy from (precedent): `packages/ee/src/email/config.tsx:29-48` (the only
  `type: "cards"` chooser in the codebase) for the two-card layout;
  `IntegrationForm.tsx` `visibleWhen` for conditional fields;
  `IntegrationCard.tsx:125-135` for the disabled-with-copy treatment

**Steps:**
1. The dialog renders one card per declared mode using the descriptor's `label` and
   `description`, then navigates to the connect route. It is **not** a `ValidatedForm` —
   the mode is a redirect parameter, not persisted state at that point.
2. Details drawer: mode read-only with a line naming
   `metadata.accountingConnectionProvider`, plus a "Reconnect in a different mode"
   control whose copy says it requires uninstalling first. Hide the Accounts group and
   the three inbound toggles when the resolved config disables those families.
3. Posting tab: when `topology.ledgerOwnership.ap` is external, render the AP select
   disabled with "Payables are handled by {provider}". Leave AR alone.
4. **Do NOT touch the Charges nav.** An earlier draft of this plan said to gate it on
   the resolved spend config. That was written before `85735ce2c1` landed, which
   deliberately REMOVED the `integrations.has("ramp")` gate and recorded why in the
   code: "Charges are a first-class Carbon document with their own posting path, so the
   nav entry is NOT gated on a spend integration being connected — an empty list is
   discoverable, a missing nav entry is not." Re-gating it would revert a decision made
   on this branch.
5. Copy must say plainly that Ramp does not name this role — Brex, BILL and Coupa all
   do, Ramp does not, so Carbon is building on a well-evidenced affordance of Ramp's
   scope split rather than a documented product mode.
6. Run `/translate`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm run lint
# Expected: exit 0 for both
```
Browser-verify via `/test`: install in push-only, confirm the Accounts group and
inbound toggles are hidden and the Posting tab's AP select is locked with the provider
named. Charges stays visible — see step 4.

**Out of scope:** coding UI.

---

## Task 10: Verification

**Depends on:** Tasks 1–9
**Files:** none

**Steps:**
1. Run the gates below.
2. Against the Ramp sandbox with a non-Carbon provider holding the accounting
   connection: install push-only, confirm the authorize URL omits `accounting:write`,
   confirm no Carbon connection is created, release a PO and confirm it appears,
   receive against it and confirm the item receipt appears and Ramp's three-way match
   links PO + receipt, post an invoice and confirm an **uncoded** draft bill appears.
3. Confirm the posted purchase invoice produced no Rillet Bill and recorded
   `FAMILY_OFF`.
4. Write results to `.ai/runs/{today}-ramp-push-only-verification.md`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
pnpm run lint && pnpm run test
# Expected: all pass
pnpm db:check:datasets && pnpm db:check:backups
# Expected: both pass
```

**Out of scope:** coding, `accounting_vendor_remote_id`, `remote_id` removal, GR/IR —
slice 5.
