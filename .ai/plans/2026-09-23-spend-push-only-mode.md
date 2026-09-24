# Push-only spend mode, uncoded (spec slice 4)

**Spec:** `.ai/specs/2026-09-23-spend-management-push-only-mode.md` §2, §3, §5, §7, §9
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
- [ ] Task 1: Declare the two install modes and their scope sets
- [ ] Task 2: Per-mode capabilities and the sync-config ceiling
- [ ] Task 3: Carry the mode through OAuth via a connect resource route
- [ ] Task 4: Stamp the mode, store granted scopes, verify the connection post-connect
- [ ] Task 5: Capability-gate converge, healthcheck and uninstall
- [ ] Task 6: Activate ledger delegation for push-only
- [ ] Task 7: Push item receipts
- [ ] Task 8: Decouple the cross-engine dependency
- [ ] Task 9: UI — mode picker, gated settings, locked posting, nav
- [ ] Task 10: Verification

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
- Create: `packages/ee/src/ramp/entities/item-receipt.ts`
- Modify: `packages/ee/src/ramp/lib/client.ts` — `POST /developer/v1/item-receipts`
- Modify: `packages/ee/src/accounting/core/subscriptions.ts` — add
  `{ table: "receipt", operations: ["INSERT", "UPDATE"] }` to the Ramp set
- Modify: `packages/jobs/src/inngest/functions/events/sync-tables.ts` — add
  `receipt: "itemReceipt"`
- Copy from (precedent): `packages/ee/src/ramp/entities/purchase-order.ts` (slice 3)

**Steps:**
1. Adding to `AccountingEntityType` makes it a compile error for any provider's
   `build*SyncConfig` and for `DEFAULT_SYNC_CONFIG` to omit a decision — that is the
   intended totality property. Fix each by force-disabling it for the three accounting
   providers.
2. The syncer pushes `purchase_order_id`, `item_receipt_number`, `received_at`, and
   `item_receipt_line_items[].purchase_order_line_item_id`. It depends on the PO being
   mapped — use the deferral from Task 8, not a synchronous JIT call.
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
