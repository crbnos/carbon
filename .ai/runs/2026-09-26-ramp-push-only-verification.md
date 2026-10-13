# Ramp push-only mode — live verification (slice 4, Task 10)

**Date:** 2026-09-26 (started 2026-09-25 evening)
**Branch:** `rillet-ramp-accounting-provider` (worktree `dublin`)
**Company:** `daphdosqs0g046qdc4ig` ("Carbon Development")
**Ramp:** sandbox (`demo-api.ramp.com`), business `38004155-…` ("Brad's Company")

## What was set up

The point of push-only is "another system holds Ramp's accounting seat", so the
test needed a real non-Carbon incumbent rather than an empty seat.

1. Captured the baseline: Carbon held connection `06c58d3c-…`, `status: linked`.
2. Uninstalled Ramp through the UI.
3. Created a connection with `remote_provider_name: "Rillet"` directly against the
   sandbox (`remote_provider_name` is client-supplied — `ensureRampConnection`
   passes `"Carbon"`). This stands in for a real peer.

Resulting sandbox state — **the realistic push-only situation**:

| provider | status | active | id |
|---|---|---|---|
| Rillet | linked | true | `06a4b305-674b-4770-b67b-c2a9597f1d43` |
| Carbon | unlinked | false | `06c58d3c-a4d3-4f5e-b2f1-fd4b95822389` |

## Honest scope: what was NOT exercised

**The browser consent leg — SUPERSEDED, see below.** For the first pass, Ramp's
sign-in needed Brad's credentials, so the install was seeded by calling exactly
what the OAuth callback calls (the peer read, then `patchRampOAuthCredentials`,
then convergence via a real settings save through the app). That reused token
still carried `accounting:write` from the previous provider-mode grant, which made
sections 2 and 3 a STRONGER test: they show Carbon's own gating refusing to use a
scope it held, rather than Ramp refusing on Carbon's behalf.

**Brad then completed the real consent himself**, so the flow is now verified end
to end on a genuinely narrow token — see "RESOLVED" below. Both readings are kept:
the seeded pass proves the gating, the real pass proves the grant.

## Verified

### 1. The mode dialog and the authorize URL

The dialog renders both modes with their copy and the "cannot be changed later"
warning. Choosing "Another system posts my ledger" → Continue reached
`demo.ramp.com` with:

```
scope=accounting:read bills:read bills:write vendors:read vendors:write
      purchase_orders:read purchase_orders:write entities:read business:read
      offline_access
```

**No `accounting:write`. No `item_receipts:write`.** `state` is a plain
`crypto.randomUUID()` (the signing lives in the cookie, not the parameter).

### 2. Push-only never claims the seat — CORE INVARIANT

After the install AND after a full settings-save convergence (`rampOnUpdate` →
`convergeRamp`), the sandbox is unchanged:

```
Rillet  status=linked    active=True   06a4b305-…
Carbon  status=unlinked  active=False  06c58d3c-…
```

`metadata.connectionId` is EMPTY. Carbon created nothing.

### 3. No `accounting:write` call was made

Coding-master mapping timestamps after convergence:

| entityType | last touched |
|---|---|
| `account` (82 rows) | 2 days ago |
| `costCenter` (8) | 2 days ago |
| `costCenterField` | 2 days ago |
| `projectField` | 2 days ago |

All four would be seconds old had `pushChartOfAccounts` / `pushCostCenters` /
`pushProjects` run. They did not — with a token that could have.

### 4. Peer detection names the live connection, not the tombstone

`accountingConnectionProvider` = **`Rillet`**, chosen from a response containing
BOTH Rillet (linked) and Carbon (unlinked). See finding B below for why this was
a bug until this run.

### 5. Settings UI is gated, and still saveable

The drawer offers exactly three settings — **Entity ID, Purchase orders,
Invoices**. The whole Accounts group is gone, as are Charges / Bills /
Reimbursements. Header shows `ANOTHER SYSTEM POSTS MY LEDGER` + `Ledger held by
Rillet` + "Chosen when you connected and fixed for this install."

Update saved successfully and redirected — proving the `cardLiabilityAccountId`
schema relaxation works. Had it stayed `.min(1)`, the hidden field would have made
the entire tab unsaveable.

Stored values of hidden settings were **preserved, not cleared**:
`cardLiabilityAccountId` still `acct_Y8128…`, `pullTransactions` still `true` —
and inert, because the mode ceiling is checked before the toggle.

### 6. Subscriptions converged

`purchaseOrder` + `purchaseInvoice`, INSERT/UPDATE, active — exactly
`REQUIRED_SYNC_SUBSCRIPTIONS[ramp]`.

### 7. Outbound push runs in push-only

Touching `po_JG5ActRUYspP8RGiDcAPh6` produced a fresh operation at
**04:00:42 2026-09-26** that reached Ramp's API and returned
`400 DEVELOPER_7063: Purchase order number already exists`.

That error is at the WIRE, downstream of everything the mode controls — so it
proves: subscription fired → operation enqueued → `buildSpendSyncConfig` permitted
`purchaseOrder` in push-only → spend provider resolved → capabilities resolved
from push-only metadata → vendor resolved → payload built → `POST /purchase-orders`
called. It is the **known pre-existing unmappable-PO gap** (all four POs exist in
Ramp from earlier runs but were never mapped; the fix is search-before-create by
`external_id`), unrelated to mode.

### 8. Ledger delegation resolves from live metadata

Driving the real `buildIntegrationTopology` with the real Ramp resolver and the
real stored row:

```
spend: ramp  ownsRemoteCodingSurface=false  ownsLedgerFamilies=["ap"]
ar            carbon
ap            EXTERNAL -> ramp
creditMemo    carbon
vendorCredit  carbon
```

That is the exact input the Posting tab's AP lock and `applyLedgerDelegation` read.

## Bugs found and fixed during this run

### A. `rampOnUninstall`'s entire remote teardown was dead code

`integrations.deactivate.$id.tsx` deactivates the row (line 39) and THEN calls
`onUninstall` (line 58). `rampOnUninstall` → `getRampIntegration` →
`readStoredRampMetadata` returns null on `!data.active`, so the whole
`if (integration)` block never ran.

**Proven, not inferred:** after the UI uninstall, the Ramp webhook
`01a0d162-…` was still `active` and the accounting connection still `linked` —
both exactly the ids Carbon had just cleared locally. A manual
`DELETE /accounting/connection` returned 204, so the endpoint was never the problem.

Consequences: every Ramp uninstall left an orphaned webhook delivering to Carbon
forever, and **left Carbon holding Ramp's single accounting seat** — precisely the
failure push-only exists to prevent. A customer uninstalling Carbon to switch
providers would find the seat still taken.

**Fix:** `readStoredRampMetadata` / `getRampIntegration` take
`{ includeInactive }`, used only by the teardown path.

### B. Peer detection read deleted connections as live

`DELETE /accounting/connection` returns 204 but does NOT remove the record. It
leaves a tombstone that still carries the provider name:

```json
{ "status": "unlinked", "is_active": false, "settings": null,
  "remote_provider_name": "Carbon", "id": "06c58d3c-…" }
```

`readAccountingConnectionProvider` took the first connection with a
`remote_provider_name` regardless of status, so any business that had EVER
connected would report that stale provider as its ledger holder — naming a
system that is not connected, and hiding that nobody is.

**Fix:** new leaf `ramp/lib/connection-status.ts` shares ONE liveness predicate
between the healthcheck and the callback (`isConnectionLinked`,
`extractConnections`, `linkedConnections`, `resolveConnectedProviderName`). Pinned
by `connection-status.test.ts` (8 tests) whose fixtures are the REAL captured
sandbox responses, including the tombstone.

### C. (from Task 9, confirmed live here) `convergeRamp` returned before enqueuing

`if (!metadata.cardLiabilityAccountId) return;` sat before the sync enqueue. A
push-only install legitimately has no card account, so it would have pushed
nothing until the next hourly sweep. Now scoped to the seat-holder.

## RESOLVED — the open scope question, answered on a real narrow token

Brad completed the real push-only OAuth consent himself later on 2026-09-26. The
stored `grantedScopes` is exactly the 10-scope push-only set, with **no
`accounting:write`**. On that token:

| call | result |
|---|---|
| `GET /accounting/all-connections` | **200** — returned both connections |
| `DELETE /accounting/connection` | **403 `DEVELOPER_7100`: These scopes are not allowed for this token: accounting:write** |

So **a push-only token CAN read the connection list** — the open question is
answered yes, and the peer-owner display and healthcheck work in push-only
without the write scope. The write half is refused exactly as designed, which is
also the first direct proof that Carbon's narrow grant is real rather than merely
unused.

Consequence worth knowing: a push-only install **cannot delete the accounting
connection**, which is correct (it is not Carbon's) and is what the
`rampOwnsCodingSurface` guard on uninstall already encodes.

### D. Every install was shown one mode's copy (reported by Brad from the UI)

The drawer, the card, and the setup instructions all rendered
`integration.description` / `shortDescription` / a single static instructions
component. That copy was written for provider mode, so a **push-only** install was
told Carbon "pulls your charges, bills, and employee reimbursements into Carbon's
general ledger" and instructed to "Map the GL accounts under Accounts" — a tab
that mode does not render. It described the exact double-posting the mode exists
to prevent.

A second, narrower report: the header read "Ledger held by Rillet", which reads as
"your Rillet integration". It is a free-text name the PROVIDER returns and
routinely names a system Carbon has no integration for at all.

**Fixes:**
- `IntegrationInstallMode` gains `shortDescription`; an installed integration now
  renders its MODE's copy in both the drawer and the card. The card gets the mode
  id resolved server-side (`installMode`), so no metadata reaches the browser.
- `setupInstructions` receives the resolved `mode`, and Ramp's steps 2 and 3
  differ per mode. Its declared prop type was widened to the props the form was
  already passing behind two `@ts-expect-error`s — which is how it drifted.
- Ramp's integration-level copy is now genuinely MODE-NEUTRAL (it was provider-mode
  copy masquerading as generic, which is the root cause), and the Sync group
  description no longer claims data "flows into" Carbon.
- The peer line now reads "**Ramp** reports the ledger is held by X".
- Pinned by two new tests in `config.test.ts`: every mode must carry its own copy
  distinct from the generic blurb, and the push-only copy must not contain
  "pull" or "into Carbon's ledger".

### E. The peer name was a snapshot that could never be corrected

`accountingConnectionProvider` was written once at connect and never revisited, so
a peer that later disconnected left the drawer naming it indefinitely.

**Fix:** `convergeRamp` re-reads it on every install and settings save when Carbon
is not the seat-holder, via a new `patchRampAccountingConnectionProvider` that can
also CLEAR it. A failed read leaves the previous value alone — "Carbon could not
ask" is not "nobody is connected", and erasing on error would flap the drawer on
any transient Ramp outage.

### F. Provider mode ADOPTED another system's accounting connection (the serious one)

Found when Brad uninstalled and reconnected in provider mode against a business
whose seat was held by the stand-in "Rillet" connection. The drawer showed
"CARBON IS MY ACCOUNTING SYSTEM" next to "Ramp reports the ledger is held by
Rillet", and the stored `connectionId` was
`06a4b305-674b-4770-b67b-c2a9597f1d43` — **Rillet's connection id, not one Carbon
created.**

Cause: `POST /accounting/connection` RETURNS THE INCUMBENT when the single seat is
already taken, rather than refusing. `ensureRampConnection` stored whatever id came
back without checking whose connection it was — the response's
`remote_provider_name` was already parsed by the schema and simply ignored.

Carbon therefore believed it held the seat. It would push the chart of accounts,
cost centers and projects into another system's connection, confirm syncs against
it, report a green healthcheck — and **on uninstall DELETE it**, which is the
"worst possible uninstall side effect" the code's own comment warns about, and was
newly reachable because finding A had just made that delete actually run.

**Fix** (`ensureRampConnection`): read the live connections first. Adopt one that
is Carbon's (this also self-heals the documented reinstall/fresh-database case that
previously needed a manual metadata edit). Refuse a foreign incumbent with an
actionable message. Re-check the CREATE response the same way, so a seat taken
between the read and the write is still caught. Verified live — the guard now
returns:

> Ramp's accounting connection is held by Rillet. Disconnect it in Ramp, or
> reconnect Carbon in push-only mode so that system keeps posting your ledger.

The live install was repaired by clearing the adopted `connectionId`; Rillet's
connection is intact.

### G. Provider mode displayed a peer at all

`resolveInstallMode` returned `detail` unconditionally, and the refresh added in
finding E only runs for a non-seat-holder — so a provider-mode install rendered a
stale peer name from a previous push-only install indefinitely, contradicting its
own badge. `detail` is now omitted in provider mode, where Carbon holds the seat
and naming a peer is meaningless.

### H. A purchase order Carbon had already pushed could never sync again

The long-standing "unmappable PO" gap, now diagnosed properly. If the mapping was
lost after a create (a failure between the two writes, a restore, a re-seeded
database), the next push took the CREATE path, Ramp refused the duplicate with
`400 DEVELOPER_7063`, the mapping was still missing — and every attempt after that
repeated it forever.

The diagnosis that mattered: **`purchase_order_number` cannot be used to recognise
Carbon's own row.** Ramp normalizes it — `"PO000002"` is stored as `"2"`, and a
number with no numeric tail comes back suffixed (`"CARBONPROBE-ZZZ"` →
`"CARBONPROBE-ZZZ-1"`). `external_id` is the identity.

The `external_id` query filter is real, and was confirmed by the shape of the
failure rather than assumed: an UNSUPPORTED parameter on this endpoint is ignored
and returns the full first page (`?purchase_order_number=PO000004` returned all 20),
whereas `?external_id=<miss>` returns zero rows, and a known id returns exactly one.

**Fix:** `findPurchaseOrderByExternalId` on the client, called by `upsertRemote`
before a create (never for an archive, which `shouldSync` already gates). It
re-checks the returned `external_id` rather than trusting the filter, so a future
API change that dropped it cannot make Carbon adopt an unrelated document. Pinned
by 4 tests at the fetch boundary.

**Verified end to end:** `po_Mz6G8NqB4mMuyH9eWcGVMi` (in Ramp, no Carbon mapping,
failing `DEVELOPER_7063` since 2026-09-25) now reports **Completed**, with the
mapping written to `01a0d967-…` and its line items intact.

### I. The PATCH path sent a create-only field — and had never run

Fixing H immediately exposed it. `upsertRemote`'s update branch sent `vendor_id`,
which Ramp rejects on PATCH with
`422 DEVELOPER_7001 {"vendor_id": ["Unknown field."]}` — applying nothing, so the
line items never reached Ramp either. `line_items` alone PATCHes fine (200).

It had gone unnoticed because the branch was effectively unreachable: it needs a
MAPPED purchase order, and a purchase order Carbon had pushed but lost the mapping
for could only ever take the create path and die there. Two bugs were hiding each
other.

## The real acceptance criteria, tested against a genuine peer (2026-09-26, late)

Brad connected the **Rillet** integration in Carbon and connected Ramp **from
Rillet**, so `RILLET` genuinely holds Ramp's accounting seat. His stated bar:
"ramp bills come over CODED so they can sync to rillet without manual coding, and
the vendors show up in rillet."

Both now pass. Getting there exposed two more bugs, both of which made push-only
non-functional in exactly the scenario it was built for.

### J. Push-only coded every bill line with an id Ramp had never heard of

`loadPushedCoding(mappingService, "ramp")` reads the options CARBON pushed to
Ramp, and emits the Carbon `account.id` as `field_option_external_id`. That is
right only while Carbon holds the seat and published those options itself.

With RILLET holding it, Ramp's 147 GL options are Rillet's — **zero** are keyed by
a Carbon `acct_` id (Ramp only exposes the current connection's accounts, so
Carbon's earlier pushes are invisible). Every line therefore addressed nothing and
the bill arrived UNCODED, needing manual coding before Rillet could post it — the
exact outcome pushing it was meant to avoid.

**Fix:** `SpendPushedCoding` becomes `Carbon id -> wire id` MAPS rather than
membership Sets, and `loadPushedCoding` takes the integration whose identifiers
the platform expects plus `useExternalIds`. `RampProvider` carries
`codingIdentityIntegrationId`, resolved once in `resolveSyncProvider` from the
topology's existing `identityScope` — which already returned
`{ kind: "delegated", toIntegrationId: "rillet" }` for precisely this case.

**Verified in Ramp's own data.** The new draft bill's line:

```json
{"provider_name":"RILLET","external_id":"019fccb4-cab3-74e6-9ef7-b280a1dace3d",
 "external_code":"1210","name":"Raw Materials",
 "category_info":{"external_id":"Category","type":"GL_ACCOUNT"}}
```

The previous draft, in the same list, still reads `"provider_name":"Carbon"` with
`acct_XtoRXs2p7St3KHv4Vntrf5` — the before/after contrast, as Ramp sees it.

(Incidental: `GET /developer/v1/bills/drafts/{id}` DOES exist. The rules said a
draft could not be read back; that was wrong and is corrected.)

### K. The delegate was forbidden from receiving what was delegated to it

With Rillet installed, no bill operation was enqueued for Ramp AT ALL — while
purchase orders, which belong to no ledger family, pushed normally.

`applyLedgerDelegation` disables a delegated family's backing entities for every
integration, including the one that OWNS the family. Ramp in push-only owns `ap`,
so resolving Ramp's own config switched off Ramp's `bill` entity. The mechanism
that routes AP to the spend platform was also stopping it arriving.

**Fix:** `applyLedgerDelegation` takes the `integrationId` whose config is being
resolved and skips a family that integration owns; `reconcileEntities` passes
`providerId`. Callers that omit it are unaffected — an accounting provider never
owns a delegated family. Pinned by 3 tests.

### Verified end to end

| requirement | result |
|---|---|
| bills push in push-only with a real peer | draft `24896bad-…`, **Completed**, mapping written |
| bills arrive CODED against the seat-holder | `provider_name: RILLET`, code `1210` Raw Materials |
| vendors show up in Rillet | 8 suppliers mapped to Rillet ids, 9 vendor pushes Completed |
| AP not double-posted (entity level) | touching the invoice enqueues NOTHING for Rillet, while a supplier enqueues `vendor` → Completed (control) |
| AP not double-posted (journal level) | `je_8ro3hchaMCfFeG8gbWbDrg` **Excluded** — "Source type \"Purchase Invoice\" is excluded: its AR/AP family is set to \"none\"" |
| Posting tab AP lock | renders **HANDLED BY RAMP** with its explanation; AR keeps a live select |

The last two were the items this run could not reach earlier for want of an
installed accounting provider. Both are now closed.

## Still open

1. ~~Narrow-token `all-connections`~~ — resolved above.
2. ~~Surfacing the seat-conflict refusal~~ — done: `RampSeatConflictError` /
   `RAMP_SEAT_CONFLICT_CODE`, mapped by the callback to a `seat-conflict` message
   naming the two real remedies. The provider-supplied holder name is deliberately
   kept out of the URL.

3. **DECISION NEEDED — Carbon purchase-order numbers collide inside Ramp.**

   ### The `purchase_order_number` contract, mapped live 2026-09-26

   | sent | stored | note |
   |---|---|---|
   | `PO000002` | `2` | alpha prefix AND leading zeros stripped |
   | `PO999999` | `999999` | same |
   | `PO000123` | `123` | same |
   | `PO-000004` | *rejected* `DEVELOPER_7063` | a separator does NOT help — still normalizes to `4` |
   | `PO000004-1` | `PO000004-1` | content AFTER the digits ⇒ kept whole, and no collision |
   | `PO000004-A` | `PO000004-A-1` | same, with a numeric tail appended |
   | *(omitted)* | `100401` | Ramp assigns from its own sequence |

   Uniqueness is on the NORMALIZED value. **Archived purchase orders release their
   number** (re-creating an archived one returns 201).

   So there is no form that Ramp preserves EXACTLY equal to a Carbon readable id:
   `PO000004` can only ever display as `4`. The real choice is:

   | option | collides? | what the customer sees in Ramp |
   |---|---|---|
   | **A** status quo | yes, permanently | `4` |
   | **B** suffix the wire number (`PO000004-1`) | never — uniqueness follows from the Carbon id | `PO000004-1` |
   | **C** omit the number | never | Ramp's own (`100401`) |
   | **D** move Carbon's sequence | less likely, not never | `500001` |

   **RESOLVED — option B, approved by Brad and implemented.**
   `toRampPurchaseOrderNumber` (`ramp/entities/purchase-order.ts`) appends `-1`,
   unconditionally rather than as a retry after a collision: a conditional suffix
   would make the number a customer sees depend on what else happens to be in their
   Ramp account, so one customer would see `4` and another `PO000004-1` for the same
   Carbon document.

   **Verified end to end:** PO000001, PO000003 and PO000004 — all three permanently
   unsyncable (`DEVELOPER_7063` on every attempt since 2026-09-25) — now report
   **Completed**, are mapped, and appear in Ramp as `PO000001-1`, `PO000003-1`,
   `PO000004-1`.

   Two caveats, both deliberate:

   - **The transform could NOT be reduced to a rule.** `PO-2026-003` came back
     `2026-3` (leading `PO-` dropped, trailing zeros dropped) while `PO000004-1`
     came back untouched; no single predicate explains both. The fix is verified for
     the format Carbon's sequence emits by DEFAULT (`PO` + six digits). A customer
     using a customized purchase-order sequence may still see the number altered —
     never worse than without the suffix, but not guaranteed verbatim. The test pins
     only what was actually exercised rather than encoding the model.
   - **Purchase orders pushed BEFORE this fix keep their reduced number**
     (`po_Mz6G8NqB4mMuyH9eWcGVMi` still shows `2`), because a re-push takes the
     PATCH path and PATCH does not resend the number. Renaming a customer's document
     under them on every sync would be worse than the inconsistency.

   ### Why not adjust the `sequence` row (option D, considered)

   It works mechanically and is a fine way to unblock a specific install, but it is
   not the fix: it does not restore readability (`PO500001` still displays as
   `500001`), it is per-customer configuration nobody can be expected to anticipate
   (an account with purchase orders 1..N silently loses N of Carbon's), it cannot
   rescue documents already numbered in the colliding range, and any chosen start can
   still collide — this very sandbox holds 9873-9903 and 100100-100400.

   ### The original statement of the problem
   Ramp normalizes `purchase_order_number`, so Carbon's `PO000001` / `PO000003` /
   `PO000004` become `1` / `3` / `4` and collide with purchase orders that already
   exist in the customer's Ramp account (this sandbox has 1–8 from Ramp's own demo
   data). Those three are refused `DEVELOPER_7063` on a FIRST push and can never
   sync — search-before-create does not help, because they are genuinely not in
   Ramp.

   This is customer-facing: any Ramp account with existing purchase orders will
   silently reject that many of Carbon's. The fix is to send a number that cannot
   collide — but what the customer sees in Ramp's UI is a product decision, so it
   is left for Brad. Options, roughly: retry once on `DEVELOPER_7063` with a
   disambiguated number; or always qualify the number (e.g. a company or sequence
   prefix). `external_id` remains the identity either way, so the number is a
   label — but it is the label a human matches against a paper PO.
3. ~~`FAMILY_OFF` and the Posting tab AP lock~~ — both closed above.

## Environment left in this state

- Ramp installed on `daphdosqs0g046qdc4ig` in **push-only** mode, peer `Rillet`.
- The sandbox's **"Rillet" connection is a test artifact I created** — and it can no
  longer be removed from Carbon: the push-only token is refused
  `DELETE /accounting/connection` (403 `DEVELOPER_7100`). Remove it from Ramp's own
  UI, or reconnect in provider mode (which grants `accounting:write`) and uninstall.
  Leaving it is harmless and keeps push-only testing realistic.
- The old Carbon connection remains as an unlinked tombstone (Ramp never removes
  these).
- Webhook `01a0dbdd-…` registered fresh by the converge.
- `scripts/ramp-connection-probe.ts` added — read-only diagnostic, documents the
  tombstone behaviour and is how the open question in item 1 gets answered.
- **To restore provider mode:** uninstall, delete the Rillet connection, reconnect
  choosing "Carbon is my accounting system".

## Gates

`pnpm run test`, `pnpm run lint`, erp + ee typecheck — all green.
