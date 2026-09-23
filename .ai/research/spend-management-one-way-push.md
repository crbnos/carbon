# Spend management in one-way push mode: when Carbon is not the accounting provider

_Research date: 2026-09-23. All URLs accessed 2026-09-23 unless a publication date is shown._

## Scope of research

Carbon integrates with **Ramp** (corporate spend: cards, reimbursements, bill pay,
procurement) and, separately, with a **general ledger** (Rillet, QuickBooks Online, Xero).
Today Carbon is Ramp's *accounting provider*: it pushes its chart of accounts and cost
centers into Ramp, Ramp pushes coded charges/bills/reimbursements back, Carbon posts the
journals and forwards them to the GL.

Some customers want **Ramp → Rillet** to be the path for card charges, reimbursements and
bill payments instead. Ramp allows only one accounting connection, so in that topology
Carbon cannot hold `accounting:write`. Carbon must run **push-only / one-way**: it pushes
purchase orders and provisional vendor bills into Ramp, coded with identifiers *Rillet*
will recognise, and it must stop posting the same AP economics to the GL itself.

This file establishes what is **documented** about that arrangement, what competitors do,
and what the standard accounting treatment is, so the design is not invented from scratch.

Every claim is marked **DOCUMENTED** (with a URL), **SECONDARY** (partner / analyst /
vendor-blog), **INFERRED**, or **NOT FOUND / UNVERIFIED**. No API field names or endpoint
paths are invented. Where a vendor's docs are a JS-rendered SPA, the machine-readable spec
was fetched directly and is cited in preference to the rendered page.

Primary machine-readable sources fetched directly for this file:

- Ramp OpenAPI: <https://docs.ramp.com/openapi/developer-api.json> (176 paths; the
  per-endpoint `security` blocks give the exact OAuth scope for every Ramp call cited here)
- Ramp guides bundle: <https://docs.ramp.com/llms-guides.txt>
- Ramp API-reference bundle: <https://docs.ramp.com/llms-api.txt>
- Brex Accounting API spec: <https://developer.brex.com/_spec/openapi/accounting_api.yaml>
- Brex Fields API spec: <https://developer.brex.com/_spec/openapi/fields_api.yaml>

---

## 1. Ramp's accounting-integration model

### 1.1 One accounting connection per business — DOCUMENTED, stated three times

Ramp's ERP Integrations guide says it plainly:

> "The connection is **one customer to one provider**; multi-entity customers scope reads
> with `entity_id`."
> — <https://docs.ramp.com/developer-api/v1/erp-integrations>

> "**Multiple accounting connections cannot be active simultaneously.**"
> — same guide, migration-tool callout

And in that guide's FAQ, answering whether a business can run two connections:

> "**No. Only one connection can be active at a time**; this is the known limitation that
> motivates the Migration tool flow."

The data model matches. `GET /developer/v1/accounting/all-connections` returns a list of
connections, each with `is_active`, `connection_type` (`API | CSV | DIRECT`),
`remote_provider_name`, and a deprecated `status` (`linked | unlinked | revoked |
failed_to_auth`). Inactive connections persist — you address their objects by passing
`accounting_connection_id` — but only one is active. (OpenAPI, `AccountingProvider`
schema; `GET /accounting/all-connections` requires `accounting:read`.)

There is a supported *migration* path rather than coexistence: create an **inactive**
API-based connection, preload the chart of accounts against it with
`accounting_connection_id` on every write, `POST /accounting/connection/{id}/ready-to-migrate`,
and the customer flips providers from **Accounting → Settings → Danger Zone → Switch
Providers**. Preconditions include "the customer must have a separate active accounting
connection to migrate from" and "the customer cannot already have another ERP migration in
progress." (ERP Integrations guide, Migration tool.)

Rillet is a first-class option in Ramp's published list of accounting integrations —
alongside NetSuite, QuickBooks Online, Sage Intacct, Xero, Acumatica, Campfire, Digits,
Finaloop, Pilot, Puzzle and Universal CSV
(<https://support.ramp.com/integrations/set-up-accounting-integrations/>). Ramp's own
Rillet pages describe Rillet pushing the accounting structure into Ramp and pulling coded
spend back (<https://support.ramp.com/ramp-with-rillet>,
<https://ramp.com/integrations/rillet>). **INFERRED** from the two being alternatives in
the same list: Rillet occupies exactly the seat Carbon occupies today.

### 1.2 What `accounting:read` / `accounting:write` actually gate — DOCUMENTED per endpoint

The scopes guide describes them loosely ("Access accounting sync status and metadata" /
"Update accounting sync settings and connections",
<https://docs.ramp.com/developer-api/v1/authorization>). The OpenAPI `security` blocks are
precise. Extracted from <https://docs.ramp.com/openapi/developer-api.json>:

| Endpoint | Method | Scope |
|---|---|---|
| `/developer/v1/accounting/connection` | POST / DELETE | `accounting:write` |
| `/developer/v1/accounting/all-connections` | GET | `accounting:read` |
| `/developer/v1/accounting/accounts` | GET / POST | `accounting:read` / `accounting:write` |
| `/developer/v1/accounting/fields` | GET / POST | `accounting:read` / `accounting:write` |
| `/developer/v1/accounting/field-options` | GET / POST | `accounting:read` / `accounting:write` |
| `/developer/v1/accounting/vendors` | GET / POST | `accounting:read` / `accounting:write` |
| `/developer/v1/accounting/codings` | POST | `accounting:write` |
| `/developer/v1/accounting/syncs` | POST | `accounting:write` |
| `/developer/v1/bills`, `/developer/v1/bills/drafts` | POST | **`bills:write`** |
| `/developer/v1/purchase-orders` | POST | **`purchase_orders:write`** |
| `/developer/v1/item-receipts` | POST | **`item_receipts:write`** |
| `/developer/v1/vendors` (spend vendor) | POST | **`vendors:write`** |
| `/developer/v1/transactions` | GET | `transactions:read` |

**This is the load-bearing finding for the whole feature.** Writing the coding *master
data* (chart of accounts, custom fields, field options, accounting vendors), registering
the connection, coding an existing transaction, and marking objects synced are all
`accounting:write`. Creating a **purchase order**, an **item receipt**, a **bill / draft
bill** and a **spend vendor** are *not* — they sit behind their own resource scopes. An app
without `accounting:write` can still do all four.

Three further documented limits confirm the boundary:

> "**Chart of Accounts cannot be modified for Ramp accounts using a direct accounting
> connection.** This applies to GL accounts, custom fields, and vendors — they become
> read-only via API when a direct connection is active."
> — ERP Integrations guide

> "Specify an accounting connection. **This connection must be an accounting API based
> connection.** If not provided we default to the current active connection."
> — OpenAPI, `ApiAccountingGLAccountUploadRequestBody.accounting_connection_id`

> "API sync marking is intended for API-based accounting connections. **Direct accounting
> connections cannot mark objects as synced via API.**"
> — ERP Integrations guide

Ramp states the same thing customer-side: "If you use a direct accounting integration, such
as NetSuite, QuickBooks, Sage Intacct, or Xero, **your GL codes come from your ERP. In Ramp
you can only show or hide them**"
(<https://support.ramp.com/hc/en-us/articles/4434982407443-Overview-of-Ramp-Accounting>).

Note the asymmetry: the **read** side is not restricted the same way. `GET
/accounting/accounts` needs only `accounting:read`, and the GL account's `external_id` is
documented as "External ID of the account. **If connected to a direct integration, this
value is sourced from the remote ERP system**" (OpenAPI). Accounting field options and
vendors also carry `provider_name`, added specifically "to identify the accounting
connection source" (Ramp changelog, in `llms-guides.txt`). So a non-provider app holding
`accounting:read` can **enumerate the active provider's coding surface and learn its
external ids**. That is the mechanism that makes push-only coding possible at all.

### 1.3 What happens when a second app tries to be the accounting provider — PARTIALLY DOCUMENTED

Documented: only one connection can be active; `POST /accounting/connection` says "A
connection is required in order to use our accounting API functionality. If a Universal CSV
connection already exists, it will be upgraded to an API based connection." The documented
responses for that endpoint are only `201` and `400` — there is **no documented `409`**, and
no documented error code for "another connection is already active."

**UNVERIFIED:** the exact behaviour when an app POSTs a connection while a different
provider holds the active one — whether it 400s, silently creates an inactive connection,
or displaces the incumbent. Ramp's own guidance implies you must go through the migration
flow (create inactive → `ready-to-migrate` → customer switches in the UI), which strongly
suggests the direct POST does not silently take over. Needs a sandbox test before Carbon
relies on any particular failure mode. Contrast Brex, which documents the collision
explicitly (§2.1).

Also **UNVERIFIED:** whether `DELETE /accounting/connection` can remove another app's
connection. The description says "This endpoint only allows disconnecting API based
connections" — it says nothing about ownership. Carbon's `rampOnUninstall` currently
best-effort deletes the connection; in push-only mode it must not run that call at all.

### 1.4 Spend vendor vs accounting vendor — DOCUMENTED, and this is the most common error

Ramp's Data Relationships guide is explicit that there are **three** counterparty objects
and that "confusing them is the most common integration error"
(<https://docs.ramp.com/developer-api/v1/data-relationships>):

| | Merchant | Vendor (Bill Pay) | Accounting Vendor |
|---|---|---|---|
| What it is | card transaction counterparty | bill-pay payee | GL coding value |
| Created by | card network (automatic) | user / API | ERP sync / API |
| Scope | global (all businesses) | per-business | per-business (**per ERP connection**) |
| Mutable | no (read-only) | yes (full CRUD) | yes |
| Has bank accounts | no | yes | no |
| API path | (on Transaction) | `/developer/v1/vendors` | `/developer/v1/accounting/vendors` |
| Anchor product | Cards | Bill Pay | ERP Integrations |

The matching rules, verbatim from the same guide:

- **Merchant → Accounting Vendor (auto-match, conditional auto-create).** "Ramp attempts to
  match the merchant to an existing Accounting Vendor **by name**. If a match is found, the
  transaction is auto-coded. If no match exists, Ramp can auto-create a new Accounting
  Vendor from the merchant name — supported for QuickBooks, QuickBooks Desktop, NetSuite
  REST, and Xero only; defaults to ON; can be disabled per business."
- **Vendor → Accounting Vendor (explicit link).** "Creating a bill-pay vendor does **not**
  auto-create an accounting vendor. Link them explicitly via `PATCH /vendors/{id}` with
  `accounting_vendor_remote_id`, in the Ramp UI when setting up a bill-pay vendor, or
  during a CSV vendor import."
- **Accounting Vendor → Vendor (opt-in auto-create).** "When accounting vendors sync from
  an ERP, Ramp can optionally auto-create bill-pay vendors for them. Off by default; two
  modes (import all, or only those with bills in the ERP)."
- **Merchant ↔ Vendor: no direct link in the API.**

And the punchline: "**The Accounting Vendor is the bridge** — it unifies card spend and
bill-pay spend for accounting, even though Merchant and Vendor are separate objects in the
API."

### 1.5 Is `external_vendor_id` the export key? — DOCUMENTED, and the answer is *no*

This is worth being exact about, because the question as posed contains a trap. There are
**two different identifier fields on the spend vendor**, and they are documented as
independent:

| Field on `POST /developer/v1/vendors` | OpenAPI description |
|---|---|
| `external_vendor_id` | "Customer-defined external identifier for the vendor. **This is independent of accounting system remote IDs.**" |
| `accounting_vendor_remote_id` | "The accounting remote id of the vendor. At most one of `accounting_vendor_remote_id` or `vendor_tracking_category_option_id` should be provided. **The referenced accounting vendor must not already be linked to another Ramp vendor.**" |
| `vendor_tracking_category_option_id` | "Ramp unique identifier of the accounting vendor to link to this vendor." (same mutual-exclusion and uniqueness rules) |

So:

- **`external_vendor_id` is a caller's private handle.** It is filterable
  (`GET /developer/v1/vendors?external_vendor_id=…`, added to allow "deduplicating by
  `external_vendor_id` immediately after creating a vendor" — Ramp changelog). It is *not*
  what Ramp exports on.
- **`accounting_vendor_remote_id` is the export key**, and it is the *accounting vendor's*
  remote id — an identifier owned by whoever holds the accounting connection.

Carbon's existing integration already uses `external_vendor_id` as its spend-vendor match
key (`resolveOrCreateRampSpendVendor`, `.claude/rules/ramp-integration.md`). That remains
correct for finding *Carbon's own* vendor rows. It does **not** make the bill land on the
right GL vendor downstream — the `accounting_vendor_remote_id` link does.

**UNVERIFIED:** whether a caller holding only `vendors:write` (no `accounting:write`) is
permitted to set `accounting_vendor_remote_id` pointing at an accounting vendor that
*another* app (Rillet) created. The scope on the endpoint is `vendors:write`, and the field
is part of that endpoint's request body, so structurally it should be allowed — but the
uniqueness constraint ("must not already be linked to another Ramp vendor") means Carbon
could collide with a link Rillet already made. Sandbox test required.

### 1.6 Can a non-provider app write `accounting_field_selections`? — STRUCTURALLY YES, VALIDATION UNVERIFIED

Documented facts:

1. `POST /developer/v1/bills`, `POST /developer/v1/bills/drafts` and
   `POST /developer/v1/purchase-orders` all accept `accounting_field_selections` at header
   and line level. (OpenAPI request schemas.)
2. Those endpoints require **only** `bills:write` / `purchase_orders:write`. No
   `accounting:*` scope appears in their `security` block.
3. A selection is addressed by **external id, not Ramp id**:
   - `field_external_id` — "Remote ID of accounting field. This is the external ID, likely
     from ERP system."
   - `field_option_external_id` — "Remote ID of accounting field option. This is the
     external ID, likely from ERP system. Required if `free_form_text` is not provided."
   - `free_form_text` — "Free form text for the accounting field selection. For DATE-type
     fields, use ISO format (YYYY-MM-DD). Required if `field_option_external_id` is not
     provided."
   (OpenAPI field descriptions.)
4. By contrast, `POST /developer/v1/accounting/codings` — the *provider's* coding call —
   requires `accounting:write`, takes Ramp-internal UUIDs (`accounting_field_id`,
   `accounting_field_option_id`), and its `object_type` enum contains **only
   `TRANSACTION`**. It cannot code a bill or a PO at all.

Together these say: **the only documented way to code a bill or a PO is at creation time,
by external id, behind `bills:write` / `purchase_orders:write`.** The design does not
reserve that for the accounting provider.

**UNVERIFIED — and this is the single highest-risk unknown in the feature:** whether Ramp
*validates* a submitted `field_external_id` / `field_option_external_id` against the
currently-active connection's uploaded options, and what it does on a miss (reject the
request, drop the selection silently, or accept it). A silent drop produces uncoded bills in
Rillet with no error anywhere.

### 1.7 Four more documented constraints that shape the design

**`remote_id` on a bill belongs to the accounting connection's owner.** OpenAPI:

> `remote_id` — "An ID that identifies the bill on the client's side. **An accounting
> connection is required and `enable_accounting_sync` must be True when `remote_id` is
> provided.** Omit `remote_id` for bills that will not be synced to an accounting provider."

`enable_accounting_sync` defaults to `true` and is "A flag you can set to False to prevent
this bill from syncing to your ERP."

Carbon today sets `remote_id: invoice.id` on its draft bills and uses it as both the echo
guard and the bill-match key (live-verified 2026-09-11,
`.claude/rules/ramp-integration.md`; sending `enable_accounting_sync: false` alongside it
422s). In push-only mode that id would be handed to **Rillet** as "the id of this bill in
your system", which it is not. **INFERRED consequence:** Carbon must stop sending
`remote_id` and find another echo guard.

**Purchase orders are connection-agnostic.** ERP Integrations FAQ:

> "Yes. POs can be fetched and created via the API **regardless of accounting connection
> type** — they're a separate feature available to all users with API access."

**Item receipts are too**, by the same scope logic (`item_receipts:write`). `POST
/developer/v1/item-receipts` requires `purchase_order_id`, `item_receipt_number`,
`received_at` and `item_receipt_line_items[].purchase_order_line_item_id` (+ optional
`unit_quantity`). Ramp's documented three-way match is "bill, PO, and item receipt all
reference the same line items" (Bill Payments guide) — the match Carbon is uniquely
positioned to feed, since Carbon owns receiving.

**Scopes are chosen per authorization request.** The authorize URL takes a required
`scope` parameter, "Space-separated list of scopes"
(<https://docs.ramp.com/developer-api/v1/authorization>). The Developer Console
configuration is the *superset*; requesting a scope not configured for the app returns
`invalid_scope` → "Requested scope not configured for app". So Carbon **can** ask for a
reduced scope set at connect time based on a pre-consent mode choice. Refreshing does not
change granted scope; "If the refresh token expires or is revoked, restart the
Authorization Code flow."

---

## 2. How competing spend platforms model this

### 2.1 Brex — the only platform with a hard, quotable one-connection rule

Brex's human docs are a client-rendered SPA; the citable source is the raw OpenAPI spec at
<https://developer.brex.com/_spec/openapi/accounting_api.yaml> (fetched and grepped
directly for this file).

**One active connection — DOCUMENTED, verbatim** from the `POST /v3/accounting/integration`
description:

> "Create a new accounting integration. The behavior depends on the existing active
> integration:
> - If no active integration exists: Creates and returns new integration
> - If active integration exists with same vendor and vendor_account_id: Returns the existing active integration
> - If active integration exists with same vendor but different vendor_account_id: Returns 409 error
> - If active integration exists with different vendor: Returns 409 error
>
> **This ensures only one active integration exists per account.**"

The error codes are named in the spec's examples: `ACTIVE_INTEGRATION_EXISTS` ("Cannot
create or recreate integration. An active integration with a different vendor already
exists", with `details: { existing_integration_id, existing_vendor, requested_vendor }`)
and `VENDOR_ACCOUNT_ID_MISMATCH`. Disconnect/reactivate endpoints exist
(`/v3/accounting/integration/{id}/disconnect`, `/reactivate`); status enum is
`ACTIVE | DISABLED`. Confirmed customer-side: "If you're already connected to a different
accounting system (e.g., QuickBooks Online), disconnect it before proceeding"
(<https://www.brex.com/support/netsuite-integration>).

**Secondary / non-accounting app role — DOCUMENTED, and this is the best precedent in the
whole survey.** Brex's Fields API (<https://developer.brex.com/_spec/openapi/fields_api.yaml>)
splits coding dimensions into a `FieldGroup` enum — `ACCOUNTING | USER | ERP | TRAVEL` —
with verbatim descriptions:

> "`ACCOUNTING` — Fields used to categorize transactions for accounting purposes (for
> example, expense categories or cost centers) that are **managed directly within Brex**."
>
> "`ERP` — Fields that are synced with an external ERP/accounting system through an
> Accounting Integration. **Creating an Accounting Integration is a prerequisite for
> creating fields in the `ERP` group**, and each `ERP` field must reference that
> integration through `integration_id`."

So Brex has an explicit, named, first-class answer to "push coding without owning
accounting": you write `ACCOUNTING`-group fields (scopes `fields.write` /
`field_values.write`) and leave `integration_id` null. Spend **vendors** are likewise
independent — `POST /v1/vendors` in the Payments API, scope `vendors`, no accounting
integration required.

**Identifier contract — DOCUMENTED.** Brex carries a paired Brex-id/remote-id on every
coding object: `AccountingFieldValue` has `brex_field_id` + `remote_field_id`
("Remote system field identifier") and `brex_field_value_id` + `remote_field_value_id`;
`Field`/`FieldValue` have `brex_id` + `remote_id` ("Remote/external ID of custom field from
external system (e.g. ERP or HRIS system)") + `value_id`. Upsert-by-remote-id is
first-class: `UpdateFieldValueBody` is a `oneOf` over `ByBrexId | ByValueId | ByRemoteId`.
Export write-back is `POST /v3/accounting/records/export-results` with
`success: { reference_id, deep_link_url }`. Notably, **`CreateVendorRequest` has no
external-id field at all** — there is no documented way to stamp your ERP's supplier id on
a Brex vendor.

**One-way mode — DOCUMENTED in effect.** The accounting flow is a pull-then-report loop
(`PREPARE → REVIEW → READY_FOR_EXPORT → EXPORTED`, webhook
`ACCOUNTING_RECORD_READY_FOR_EXPORT`), and Brex's own Bill Pay sync is stated as one-way:
"This is a **one-way sync**, meaning we only sync data from Brex into your external
accounting platform" (<https://www.brex.com/support/syncing-bill-pay>). The Accounting API
is **Alpha** and access-gated by email request.

### 2.2 BILL (Bill.com) — a purpose-built de-scoped partner credential

BILL's developer docs are retrievable as markdown by appending `.md`
(<https://developer.bill.com/llms.txt>); the Salesforce-rendered help center is not
machine-fetchable, so several claims below are **NOT FOUND** rather than disproven.

**One accounting connection per org — NOT FOUND.** No retrievable official page states a
limit. <https://www.bill.com/integrations> says only that BILL "offer[s] automatic 2-way
sync with QuickBooks Online, QuickBooks Pro/Premier, QuickBooks Enterprise, Xero, Oracle
NetSuite, Sage Intacct, and Microsoft Dynamics."

**Secondary role — DOCUMENTED, and BILL's standout feature.** BILL ships an **AP & AR sync
token**: a deliberately de-scoped partner credential that is not the payments identity
(<https://developer.bill.com/docs/token-based-sign-in.md>, updated 2026-03-24):

> "As a BILL app partner, you can onboard your customers with an AP & AR sync token. Your
> customers can pull or push key financial data for reporting or ERP syncing. In addition,
> **BILL payment capabilities are not available** when your customers sign in with the AP &
> AR sync token."

Documented permission matrix: all vendor operations **except** vendor bank accounts; all
bill / recurring bill / vendor-credit operations and recording an AP payment, but **not**
paying, cancelling or voiding; **"You have permissions for all classification
operations"** (i.e. full GL/dimension push); full invoice/customer operations minus
send/charge; no MFA operations; read-only users; 48-hour idle session (vs 35 minutes for a
full credential). The token is minted by the *customer* in **Settings → Sync &
Integrations → Tokens**.

**Identifier contract — DOCUMENTED, and BILL-only.** v3 objects carry BILL-generated
prefixed ids with **no external-id column anywhere**: vendor `009…`, bill `00n…`, chart of
account `0ca…`, class `cls…`, department `0de…`, location `loc…`, item `0ii…`, job `job…`,
employee `emp…`, customer `0cu…`. A partner must create the classification objects first
(`POST /v3/classifications/*`), keep its own id map, then reference BILL ids on bills.
There is no "send my id and BILL will match it."

**One-way switch — DOCUMENTED (help-center; wording recovered via search snippets, not a
direct fetch).** BILL exposes **"1-Way Transactions Sync"**, which "prevents transactions
(bills, invoices, and payments) from syncing from your accounting system to BILL" — the
explicit lever for nominating a single originating system
(<https://help.bill.com/direct/s/article/360000044486>,
<https://help.bill.com/direct/s/article/115005969286>).

### 2.3 Coupa — a typed registry where a partner is a peer of the ERP

**One connection limit — NOT FOUND, and the data model argues against one.** Coupa's
`/integrations` resource is an explicit many-row registry with fields `business-object`,
`code`, `direction` (`to_coupa` | `from_coupa`), `end-system`, `end-system-type`
(`internal | payroll | erp | hr | third_party_partner | third_party_vendor | other`),
`integration-type`, `name`, `standard`
(<https://compass.coupa.com/en-us/products/product-documentation/integration-technical-documentation/the-coupa-core-api/resources/transactional-resources/integrations-api-(integrations)>).

**Secondary role — DOCUMENTED.** `third_party_partner` and `third_party_vendor` are
enumerated *distinct from* `erp`, and `direction` is per-integration. Permissioning is
scope-based in the form `service.object.right`, e.g. `core.accounting.read` /
`core.accounting.write`
(<https://compass.coupa.com/en-us/products/product-documentation/integration-technical-documentation/the-coupa-core-api/oauth-2.0-and-oidc/openid-connect-clients>).

**Identifiers — DOCUMENTED, mixed.** Supplier `number` ("Supplier number", unique) is the
mapping key; invoices key on `invoice-number` plus supplier name or number. A dedicated
`business_entity_external_references` child object exists (`name`, `type`, `value`) but is
scoped to business entities, not suppliers/invoices. `external-src-name` /
`external-src-ref` appear in an example response but their semantics are **NOT
DOCUMENTED** — do not build on them.

**One-way mode — DOCUMENTED.** The invoices-to-ERP orchestration is a push loop with no
reverse sync: retrieve `exported=false` and `status[in]=approved,voided`, process, then set
`exported=true`, with Integration History / Runs / Errors for monitoring
(<https://compass.coupa.com/en-us/products/product-documentation/integration-technical-documentation/the-coupa-core-api/orchestration-documents/invoices-integration-into-your-erp>).

### 2.4 Navan, Airbase / Paylocity, Expensify, Mesh, Center — NOT ESTABLISHED

**No verified findings.** Navan's Expense API must be enabled per account by Navan
(<https://developer.navan.com/>); Airbase's developer portal is account-gated
(<https://developer.airbase.io/>). Both have public *marketing* pages listing NetSuite /
Sage Intacct / QuickBooks / Xero GL integrations, but neither publishes a
machine-readable spec or a public statement about connection exclusivity or a secondary
app role. Treat this row as unresearched rather than as evidence of absence. The
highest-value unverified lead for a follow-up: Expensify's Integration Server "Update" job
type (categories/tags pushed with `partnerUserID`/`partnerUserSecret`), which is the
closest published analogue to a non-accounting coding-push role.

### 2.5 Comparison

| | One active accounting connection? | Secondary / non-accounting app role? | Identifier contract for reconciliation | Documented push-only mode |
|---|---|---|---|---|
| **Ramp** | **Yes — DOCUMENTED** ("only one connection can be active at a time"); no documented conflict error code | **Yes, implicitly** — `bills:write` / `purchase_orders:write` / `item_receipts:write` / `vendors:write` are independent of `accounting:*`; **no named role** | `accounting_vendor_remote_id` (the export key) vs `external_vendor_id` (caller's private handle); coding by `field_external_id` / `field_option_external_id` | Not named as a mode; the scope split makes it possible |
| **Brex** | **Yes — DOCUMENTED**, with `409 ACTIVE_INTEGRATION_EXISTS` / `VENDOR_ACCOUNT_ID_MISMATCH` | **Yes, NAMED** — `ACCOUNTING` field group vs `ERP` field group; vendors independent | paired `brex_*_id` + `remote_*_id`; `oneOf` upsert `ByBrexId \| ByValueId \| ByRemoteId`; write-back `reference_id` + `deep_link_url`. **No external id on vendors** | **Yes** — one-way sync; poll/webhook → `export-results`. Alpha, access-gated |
| **BILL** | **NOT FOUND** | **Yes, NAMED** — "AP & AR sync token": vendors + bills + **all classification ops**, no payments, no MFA | BILL-generated prefixed ids only (`009`, `00n`, `0ca`, …). **No external-id field anywhere** | **Yes** — "1-Way Transactions Sync" setting |
| **Coupa** | **NOT FOUND** — `/integrations` is a many-row registry | **Yes, NAMED** — `end-system-type` includes `third_party_partner` / `third_party_vendor` as peers of `erp` | supplier `number`; invoice `invoice-number` + `exported`; business-entity external refs | **Yes** — `exported=false` → process → `exported=true` |
| **Navan / Airbase / Expensify / Mesh / Center** | NOT ESTABLISHED | NOT ESTABLISHED | NOT ESTABLISHED | NOT ESTABLISHED |

**The pattern.** Three of the four platforms with public docs ship a *named*, first-class
role for "a partner that pushes coding data but is not the accounting system." Ramp is the
outlier: the capability exists (the scope split proves it) but it has no name, no
documentation, and therefore no stated guarantees. Carbon is building on an
inferred-but-well-evidenced affordance, not a documented product mode.

---

## 3. Industry practice for "who owns AP"

### 3.1 Headline: the ERP posts AP; the spend tool owns the AP *workflow*

**In every documented pairing found, the AP liability posts in the ERP/GL — never in the
spend tool.** The spend tool is the *system of entry* (capture, OCR, coding, approval,
payment execution); the ERP is the *system of record* and the only place a payable exists
as a ledger balance. The spend tool creates the AP record **inside the ERP via API**.

Double-counting is **not** avoided by the ERP suppressing its own AP posting. It is avoided
by **single-writer discipline plus explicit dedupe keys**.

| Pairing | Where AP posts | Who writes it | Documented anti-duplication mechanism |
|---|---|---|---|
| NetSuite + Ramp | NetSuite (Vendor Bill) | Ramp, via API | vendor + invoice-number import guard; write back payment only to imported bills; accrual date moved to reversal date; NetSuite Duplicate Detection & Merge |
| NetSuite + Brex | NetSuite (Vendor Bill / JE / credit-card transaction — configurable) | Brex, via API | one-way sync (Brex → ERP only) |
| Sage Intacct + Ramp | Intacct (Purchasing vendor invoice → AP bill) | Ramp, via API | `-ramp-matched` reference-number suffix |
| QBO + BILL | QuickBooks Online (Bill against AP) | BILL (default), bidirectional | "1-Way Transactions Sync" setting; Money Out Clearing account for payments |
| Acumatica + Ramp | Acumatica (Bill) | Ramp, via API | ERP-side *release* gate before payment sync |

Key citations:

- Ramp/NetSuite: reimbursements sync as Vendor Bills, card transactions as Credit Card
  Transactions, statement payments as checks, accruals as journal entries with automatic
  reversing entries — <https://support.ramp.com/netsuite-overview>. Bills post "to the GL
  as an AP liability" — <https://support.ramp.com/bill-pay-accounting>.
- Ramp import guard: Ramp will not import a bill "if a bill already exists in Ramp with the
  same vendor and invoice number" —
  <https://support.ramp.com/hc/en-us/articles/33844303915539-Importing-bills-from-your-accounting-provider>.
- Ramp/Intacct dedupe key: "Ramp prevents duplicates by adding a **`-ramp-matched` suffix
  to the reference number**" —
  <https://support.ramp.com/hc/en-us/articles/41102139615251-Sage-Intacct-PO-Importing>.
- Brex: "This is a **one-way sync**, meaning we only sync data from Brex into your external
  accounting platform"; "For all bills synced to NetSuite, an **Accounts Payable account
  must be defined in Brex**" — <https://www.brex.com/support/syncing-bill-pay>. Card spend
  export format is configurable (JE single / JE batched / credit card transaction / vendor
  bill) — <https://www.brex.com/support/netsuite-overview>.
- Acumatica: "Ramp cannot sync the bill payment to a bill until the bill is **released**" —
  <https://support.ramp.com/hc/en-us/articles/30437158529811-Acumatica-overview>.
- Intacct exception worth noting: Ramp does **not** sync statement payments or cashback to
  Intacct; the customer must run Intacct's **Charge Payoff**, "which creates an AP Bill that
  moves the balance from credit card accrual to accounts payable" —
  <https://support.ramp.com/sage-intacct-overview>.

**ERP suppression of its own AP posting: NOT FOUND.** No Ramp, Brex, BILL or Oracle doc
instructs you to disable the ERP's AP posting. The pattern is "don't key the bill twice",
which is process discipline, not a system toggle.

### 3.2 GR/IR when the invoice lands outside the ERP

**The single-system baseline is uniform — DOCUMENTED.** Receipt debits inventory/expense
and credits a temporary accrual; the invoice debits that accrual and credits AP.

| ERP | Account | Source |
|---|---|---|
| SAP | **GR/IR clearing account** — "Each goods receipt (GR) and invoice receipt (IR) is posted to a GR/IR clearing account… If the quantities and prices match, the system automatically clears these items"; unmatched items "must be cleared at the end of the period" | <https://help.sap.com/doc/8353d7531a4d424de10000000a174cb4/700_SFIN3E%20006/en-US/f47fd1538cdf4608e10000000a174cb4.html> |
| NetSuite | **Accrued Purchases** — "NetSuite uses the Accrued Purchases account to offset your A/P register… for inventory that has been received but not paid for"; variances cleared via **Post Vendor Bill Variances** | <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2408991.html>, <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2371184.html> |
| Acumatica | **PO Accrual / Purchase Accrual**; reconciled via Purchase Accrual Balance by Period | SECONDARY: <https://community.acumatica.com/financials-7/account-details-for-purchase-accrual-account-does-not-balance-to-purchase-accrual-balance-by-period-18601> |
| D365 F&SCM | **Purchase expenditure, un-invoiced** (Dr) / **Purchase accrual** (Cr); gated by the AP parameter **"Post product receipts to ledger"** and per-category "Accrue purchase expense on receipt" | <https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/purchase-order-posting> |

**The documented split-system pattern is: the split never reaches the GL.** In every
integration found, the receipt *and* the invoice both end up as postings inside the same
ERP, so GR/IR clears natively by PO reference. The spend tool relays documents; it does not
hold one leg of the clearing pair.

- **Coupa → SAP, the most explicit source — DOCUMENTED.** "When the item/service is received
  user enters a receipt in Coupa"; the receipt integration triggers, *in SAP*, a debit to
  P&L and "a credit to the balance sheet generating an accrual for **Goods Received Not
  invoiced (GRNI)**." Later the invoice is sent to SAP and "two automatic journal entries
  take place in SAP debiting the balance sheet GRNI Accrual and crediting the Supplier
  Vendor Account." The page also warns: "Customer would need to own and develop the process
  in their middleware to convert these transactions into appropriate accrual adjustments."
  <https://compass.coupa.com/en-us/products/core-platform/integration-playbooks-and-resources/erp-integration-playbooks/sap-integration-playbook/accruals-from-coupa-to-sap>
- **Ramp → Sage Intacct, the strictest documented sequencing rule.** On a three-way-matched
  bill sync: "Every bill line matched to a three-way match PO line must have an **item
  receipt line selected**", and "all matched bill lines must reference the **same item
  receipt**, and that item receipt (and its lines) **must already be synced to Sage Intacct
  before the bill can sync**."
  <https://support.ramp.com/hc/en-us/articles/41102139615251-Sage-Intacct-PO-Importing>
  That ordering requirement is exactly what keeps GR/IR clearable: the receipt leg must
  exist in the ledger *first*, so the invoice leg posts against it rather than alongside it.
- **Ramp → NetSuite** will *create* the receipt in the ERP if it doesn't exist: "When you
  sync an item receipt, Ramp creates a corresponding item receipt record in NetSuite and
  links back to it." <https://support.ramp.com/syncing-item-receipts-to-netsuite>

**A genuinely split GR/IR — receipt accrual posted in ERP A, AP posted in system B, clearing
done by manual/periodic JE — is NOT FOUND in any vendor documentation.** SAP, NetSuite,
Acumatica, D365, Coupa, Ramp, Brex and BILL all design the split *away* rather than
document how to live with it.

**INFERRED (flag as such):** if AP genuinely posts outside the ERP, the receipt-side accrual
in the ERP has nothing to clear it, and only three mechanisms exist — (a) suppress the
receipt-side GL posting entirely (D365's "Post product receipts to ledger" off; NetSuite
Advanced Receiving off), (b) feed the external AP posting back as a JE against the accrual
account — which Sage Intacct explicitly warns breaks the subledger (§3.3), or (c) clear the
accrual periodically by manual JE with a reconciliation report. All three are inferences
from the primitives, not documented recommendations. SECONDARY sources describe (c) as real
practice: <https://planergy.com/blog/grni-reconciliation-process-benefits/>,
<https://www.stampli.com/resources/grir-reconciliation/>.

### 3.3 Is there a documented "no AP posting / operations-only" ERP mode?

**NOT FOUND as a vendor-supported mode or a named industry pattern.** What exists is
weaker and narrower:

- **DOCUMENTED — non-posting transactions are a first-class ERP concept, but only for
  orders.** Oracle: "Transactions that don't impact the general ledger are called
  non-posting transactions. Some examples… are purchase orders, sales orders, and return
  authorizations." GL impact begins at item receipt.
  <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N1459499.html>
  So an ERP can legitimately carry the whole purchasing chain with zero GL impact *up to
  the receipt*. That is the closest documented analogue to "operations-only".
- **DOCUMENTED — receipt-side GL posting is switchable in D365** ("Post product receipts to
  ledger"). <https://learn.microsoft.com/en-us/dynamics365/finance/general-ledger/purchase-order-posting>
- **DOCUMENTED — Sage Intacct's stance is the opposite of "let another system own AP", and
  it says so:** "Journal entries made directly to the Accounts Payable GL account **don't
  flow to the Accounts Payable subledger**." Remediation is manual reconciliation of GL to
  the AP aging report.
  <https://www.intacct.com/ia/docs/en_US/help_action/Accounts_Payable/AP_reports/Troubleshooting/balance-AP-subledger-to-GL.htm>
  If an external system posts AP into Intacct as journal entries, the AP aging permanently
  diverges from the GL.
- **NOT FOUND — NetSuite/SuiteApp guidance telling a partner to suppress NetSuite AP.**
  Oracle's third-party AP guidance is the reverse: integrations *create* Vendor Bills, and
  Oracle ships duplicate detection to handle the collision risk.
  <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1021104845.html>
- **"System of record" vs "system of entry" — SECONDARY only**, and consistently assigns the
  ERP the system-of-record role (e.g.
  <https://www.stampli.com/blog/accounting/expense-controls-connected-to-ap-and-erp/>,
  <https://www.velosio.com/blog/streamline-ap-invoice-processing-using-your-erp/>). No
  accounting-practice source endorses "AP outsourced to spend tool" as a named topology
  where the ERP stops carrying the payable.

### 3.4 Three-way match across systems

Ramp is the most fully documented. **DOCUMENTED — configurable placement of each leg**
(<https://support.ramp.com/3-way-match-with-ramp-procurement>):

> Option 1: Ramp bills + NetSuite POs + NetSuite item receipts
> Option 2: Ramp bills + Ramp POs + NetSuite item receipts
> Option 3: Ramp bills + Ramp POs + Ramp item receipts

How the PO is passed: **PO number by OCR** ("Ramp will use OCR technology to scan the
invoice for the purchase order number"), **line-level routing for multi-PO invoices**
("When a PO number appears on an invoice line, Ramp routes that line item to the
corresponding PO before running amount-based matching"), then **line-to-line matching**
("Ramp will automatically match the bill line items with PO line items and then pull in item
receipts"). PO import is supported from NetSuite, Sage Intacct and QuickBooks Online.
<https://support.ramp.com/importing-and-matching-purchase-orders-pos-on-ramp-bill-pay>

Write-back closes the loop: "The PO will automatically close in Ramp as 'Full Billed' once
the amount of matched bills… meets the amount indicated on the PO… Once the Fully Billed PO
in Ramp is re-synced to Sage, NetSuite or QuickBooks, the PO will close out in the ERP."
<https://support.ramp.com/syncing-ramp-purchase-orders-into-accounting>

**Coupa** puts the match key on the invoice line itself: a `MatchReference` key for
3-way-direct invoice-line-to-receipt matching in its supplier cXML spec.
<https://compass.coupa.com/en-us/products/product-documentation/supplier-resources/for-suppliers/integration-resources/standard-invoice-examples/sample-cxml-invoice-with-matchreference-key-for-3-way-direct-invoice-line-to-receipt-matching>

**Brex, BILL, Acumatica+Ramp: NOT FOUND** — no documented PO import or three-way match for
those pairings.

---

## 4. Multi-mode integration UX precedent

### 4.1 Is there precedent for "pick a mode before consent, then request reduced scopes"?

**A product that shows an explicit "which direction does this run?" picker immediately
before an OAuth consent screen, with the scope set varying by the choice — NOT FOUND** as a
documented, named pattern. The mechanisms to build it are all documented; the UX pattern is
not written up anywhere.

**The strongest documented precedent is Plaid Link's product arrays** —
<https://plaid.com/docs/link/initializing-products/>. The app declares its intent *before*
consent via four arrays on `/link/token/create`, and that choice determines the consent
collected:

- `products` — "The user must connect an applicable institution and account. Item creation
  will fail if one or more listed products is unavailable." Also filters the institution list.
- `required_if_supported_products` — initialized if the institution supports it, otherwise
  ignored without failing.
- `optional_products` — best-effort; "Item creation will still succeed" if unavailable.
- `additional_consented_products` — "Plaid will collect the user's consent to retrieve this
  data" but "will not extract data for these products and Item creation will not fail."

That last one is the design worth stealing: **consent to the superset at connect time,
activate only the mode's subset.** Plaid states that without the consent, "your API call
attempting to add the product will fail and you will need to send the user through update
mode to obtain that consent" (<https://plaid.com/docs/link/update-mode/>). Its Data
Transparency Messaging rules restate it: "you can only add products by calling an endpoint
if you specified those products in the **Additional Consented Products** array when calling
`/link/token/create`, or if you already have the required permissions scopes"
(<https://plaid.com/docs/link/data-transparency-messaging-migration-guide/>). Several
products (Assets, Statements, Bank Income, Identity Verification, Payment Initiation,
Signal) cannot be added post-Link by endpoint call at all.

So Plaid's model is precisely: **declare the mode up front; the consent screen reflects it;
narrowing is free; widening costs a re-consent trip** — with one documented escape hatch for
*anticipated* mode change.

### 4.2 Incremental / partial scope: Google, Microsoft, Slack, Xero

- **Google — DOCUMENTED.** Recommends requesting scopes incrementally "in a context that
  identifies the reason for the request to the user"; incremental authorization "returns an
  authorization code that may be exchanged for a token containing **all scopes the user has
  granted the project**"
  (<https://developers.google.com/identity/protocols/oauth2/web-server>,
  <https://developers.google.com/identity/protocols/oauth2/resources/best-practices>).
  `include_granted_scopes=true` merges previously granted scopes so a second narrower
  request does not revoke the first. Granular permissions mean the user may grant a subset,
  and the app must detect it by inspecting the `scope` field in the token response
  (or `hasGrantedAllScopes()` / `hasGrantedAnyScope()` in the GIS JS library,
  `credentials.granted_scopes` in Python, `grantedScopes` in a Chrome extension); the
  recommended response to a partial grant is to **disable the relevant features**, not
  re-prompt (<https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions>).
  **Important correction to the naive reading: on Google a grant does NOT shrink by
  requesting fewer scopes.** "A record of user consent is maintained per user and Client ID,
  and persists across multiple calls… to remove scopes from your app… call
  `google.accounts.oauth2.revoke()` and initialize using `prompt=consent`"
  (<https://developers.google.com/identity/oauth2/web/guides/use-token-model>). Revocation
  is whole-grant, not per-scope.
- **Microsoft Entra ID — DOCUMENTED, and a hard constraint.** Delegated permissions support
  both **Static** ("configured list on app registration") and **Dynamic** ("request
  individual permissions at sign-in"); application permissions are **"Static ONLY"**
  (<https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview>).
  So a mode-varying scope request is structurally impossible for app-only access. The v2.0
  endpoint is what made dynamic scopes possible at all — v1.0 required permissions "specified
  in advance" and "set directly on the application registration… are **static**"
  (<https://learn.microsoft.com/en-us/previous-versions/azure/active-directory/azuread-dev/azure-ad-endpoint-comparison>).
  Microsoft's own design rule is the one Carbon should copy: "**In general, the permissions
  should be statically defined for a given application. They should be a superset of the
  permissions that the application requests dynamically or incrementally**"
  (<https://learn.microsoft.com/en-us/entra/identity-platform/consent-types-developer>) —
  exactly the Ramp Developer Console superset / per-authorize subset split in §1.7.
  A refresh "must be equivalent to or a subset of the scopes requested in the original
  `authorization_code` request leg"
  (<https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>).
- **Slack — DOCUMENTED, and the counter-example.** Separate `scope` (bot) and `user_scope`
  parameters; `bot_optional` / `user_optional` manifest fields let the installer choose;
  and scopes are **additive** across repeat OAuth runs — "any subsequent time(s) you send
  that same user through the OAuth flow, any new scopes you request will be added to that
  initial set" (<https://docs.slack.dev/authentication/installing-with-oauth>). On Slack,
  widening is free. Immutability is provider-dependent, not universal.
- **Xero — DOCUMENTED, and the closest direction-based precedent among accounting vendors.**
  Read-only `.read` variants exist per area — `accounting.transactions.read`,
  `accounting.settings.read`, `accounting.contacts.read`, `accounting.attachments.read`,
  plus read-only-only scopes `accounting.reports.read`, `accounting.journals.read`,
  `accounting.budgets.read` (confirmed from `xero_accounting.yaml` in
  <https://github.com/XeroAPI/Xero-OpenAPI>; the scopes doc page itself is JS-rendered).
  So a "you push to us, we only read" mode maps directly onto requesting only `.read` scopes.
  Xero's granular-scopes migration is server-rendered and readable
  (<https://developer.xero.com/faq/granular-scopes>): new scopes require explicit re-consent
  — "Because you are requesting a different set of permissions, the user must provide
  explicit consent… The granular scopes won't automatically be applied to any existing
  tokens" — scopes are **additive** ("they will then have both the broad and granular
  scopes"), forcing re-consent means removing the connection via the API, and the runtime
  signal for a missing scope is a **401 with `WWW-Authenticate: insufficent_scope`**, which
  Xero says should "prompt the user to 'Update Permissions'." Apps created on or after
  2 March 2026 must use granular scopes; older apps have until September 2027.
- **Stripe Connect — DOCUMENTED, and the only platform found that supports downgrade on
  refresh.** The authorize URL takes `scope` = "`read_write` or `read_only`, depending on
  the level of access you need. **Defaults to `read_only`**"; an invalid value returns
  `invalid_scope`. On the token exchange, `scope` accepts "any scope that has an **equal or
  lesser scope** as the refresh token"
  (<https://docs.stripe.com/connect/oauth-reference>). Separately, the connected **account
  type is immutable** — "After you create a connected account, you can't change its type"
  (<https://docs.stripe.com/connect/accounts>) — and Stripe's mitigation is a dedicated
  "Choose an account type" comparison page presented *before* the irreversible call. That is
  the only documented instance of pre-commitment education found anywhere in this survey.
- **HubSpot — DOCUMENTED.** The install URL takes required `scope` plus optional
  **`optional_scope`** (singular, space-separated). "Any scopes that you've checked off in
  your app's Auth settings will be treated as required… Optional scopes will be
  automatically dropped from the authorization request if the user selects a HubSpot account
  that doesn't have access to that tool… **If you're using optional scopes, you will need to
  check the access token or refresh token to see which ones were granted**"
  (<https://developers.hubspot.com/docs/apps/legacy-apps/authentication/working-with-oauth>
  — note the page is now labelled "legacy public apps"; whether the parameter survives
  unchanged on the new platform is NOT FOUND).
- **Shopify — DOCUMENTED, and the only platform with both a revoke path and a scope-changed
  webhook.** `shopify.app.toml` `[access_scopes]` has `scopes` (granted at install) and
  `optional_scopes` ("Any access scopes that your app can request dynamically after
  installation"); "optional scopes are granted separately, after installation, so an app's
  granted scopes can differ from the ones in its configuration". Runtime APIs are
  `shopify.scopes.query()`, `.request([...])`, `.revoke()`, plus the GraphQL mutation
  `appRevokeAccessScopes`. Changing the *required* set re-prompts: "Merchants are prompted
  to approve the updated access scopes when they open your app." The webhook topic is
  **`app/scopes_update`**.
  <https://shopify.dev/docs/apps/build/authentication-authorization/app-installation/manage-access-scopes>
- **Intuit QuickBooks Online — DOCUMENTED, one-way door.** Scope strings are granular
  (`com.intuit.quickbooks.accounting`, `.payment`, `.payroll`, plus OpenID scopes; confirmed
  from Intuit's official OAuth SDKs, e.g. <https://github.com/intuit/oauth-jsclient>), and
  an accounting-only connect is the normal case. But the **app record's** scope list is
  append-only: "You can add additional scopes, but you can't remove existing ones"
  (<https://developer.intuit.com/app/developer/qbo/docs/get-started/app-settings>).
- **Slack manifest `bot_optional` / `user_optional` — CONFLICTING.** One read of
  <https://docs.slack.dev/authentication/installing-with-oauth> reported these fields;
  an independent read of the same page did not find them. Do not cite without re-checking
  the manifest reference. What *is* consistently documented is that on Slack
  "**there is no way to remove scopes from an existing token without revoking it
  entirely**", and that granting new scopes requires reauthorization.

### 4.3 What the specs say about mode immutability

**RFC 6749 §3.3 — the authorization server may issue a narrower scope than requested, and
must say so.** <https://datatracker.ietf.org/doc/html/rfc6749#section-3.3>

> "The authorization server MAY fully or partially ignore the scope requested by the client,
> based on the authorization server policy or the resource owner's instructions."
>
> "If the issued access token scope is different from the one requested by the client, the
> authorization server MUST include the 'scope' response parameter to inform the client of
> the actual scope granted."

**Design consequence:** granted scope is authoritative, not requested scope. A mode
implementation must read back the `scope` response parameter and reconcile.

**RFC 6749 §6 — a refresh may narrow but never widen.**
<https://datatracker.ietf.org/doc/html/rfc6749#section-6> — refresh tokens obtain
"additional access tokens with **identical or narrower** scope."

**Design consequence:** this is the closest thing in the specs to a "mode cannot widen after
consent" rule. **Narrowing is free and spec-sanctioned; widening requires a new
authorization code flow.** A mode change that only *reduces* what Carbon touches needs no
re-consent; a mode change that adds capability does.

**RFC 8693 (Token Exchange)** supports narrower downstream tokens — "the new token might be
an access token that is more narrowly scoped for the downstream service" — but treats scope
negotiation as deployment policy, not a protocol requirement, and never uses the word
"downscoping". There is no normative MUST that the exchanged token be a strict subset of the
subject token. <https://datatracker.ietf.org/doc/html/rfc8693>

**RFC 6819 §5.1.5.1 "Limit Token Scope"** is the nearest spec-level sanction for
"the customer's chosen mode narrows the grant": the AS may reduce scope on the basis of
"a client-specific policy…; a service-specific policy…; **a resource-owner-specific
setting**". <https://datatracker.ietf.org/doc/html/rfc6819#section-5.1.5.1>

**RFC 9700 §4.14 (OAuth 2.0 Security BCP)** is the only explicit anti-escalation MUST found:
"If refresh tokens are issued, those refresh tokens MUST be bound to the scope and resource
servers as consented by the resource owner. This is to prevent privilege escalation by the
legitimate client." <https://datatracker.ietf.org/doc/html/rfc9700>

**Is there RFC/spec guidance that an integration MODE should be immutable after consent?
NOT FOUND.** No OAuth RFC has any concept of an integration "mode" (searched RFC 6749, 6819,
8693, 9700). Three constraints are easy to mistake for such a rule and are not: §6's
"MUST NOT include any scope not originally granted" (freezes one refresh token's ceiling,
not the client's configuration — a fresh `/authorize` resets it), §6's refresh-rotation
scope identity (token rotation only), and RFC 9700 §4.14 (binds the AS, not the client's
feature set). Both major platforms point the **opposite** way — Google "lets you request
scopes as they are needed", Microsoft "you can specify the scopes your app needs **at any
time**". Any immutability rule is a **product decision**, and the strongest available
argument for it is operational (Plaid's model: widening means re-consent, so decide up
front) rather than normative.

### 4.4 Product precedent for a sync-direction setting

**The dominant pattern is: connect first, configure direction second.** No vendor surveyed
gates OAuth on a direction question. A generic "which system is the system of record?" step
in an accounting integration setup wizard is **NOT FOUND**.

**Reversible, post-connect direction settings — DOCUMENTED:**

- **HubSpot Data Sync** — three options *per synced object*: bi-directional, "Data syncs
  only to HubSpot", "Data syncs only to your third-party app"; set on a post-connect
  Configure page. Warning given: "**Saving the sync will restart the initial sync**", and
  initial syncs "with millions of records may take several days."
  <https://knowledge.hubspot.com/integrations/connect-and-use-hubspot-data-sync>
- **HubSpot ↔ Salesforce**, *per field mapping*: `Two-way`, `Always use Salesforce`, `Prefer
  Salesforce unless blank`, `Don't sync`. Warning given is the **opposite** of the one
  above: "**Existing values in a newly created mapping will not retroactively sync**."
  <https://knowledge.hubspot.com/salesforce/map-hubspot-properties-to-salesforce-fields>
- **Unito** — direction chosen on a dedicated screen after both accounts connect, and
  reversible by clicking a single-direction arrow. Its config-change semantics are the
  clearest found: "**Changes to Unito flows will only affect newly created work items,
  unless you decide otherwise**", with an explicit "Sync all" for retroactive application
  and its costs stated up front.
  <https://guide.unito.io/how-to-change-flow-direction>,
  <https://guide.unito.io/how-to-sync-flow-changes-across-all-historical-work-items>

**Direction fixed by the product, not chosen — DOCUMENTED:**

- **Zendesk ↔ Salesforce** — one-way only, with the single best warning precedent found:
  "This is an advanced feature. **Once data is synced from Salesforce to Zendesk, it is not
  reversible.** We highly recommend that you test this feature first."
  <https://support.zendesk.com/hc/en-us/articles/4408828539290-Configuring-data-sync-from-Salesforce-to-Zendesk>
- **Zapier** — "**No. Zapier does not support two-way syncing between apps right now.**"
  Direction is implied by which app is the trigger.
  <https://help.zapier.com/hc/en-us/articles/8495908569613-Does-Zapier-support-two-way-syncing>

**Explicitly IMMUTABLE modes — the direct precedents for R3:**

| Vendor | Immutable thing | Quote | Source |
|---|---|---|---|
| Shopify ↔ QuickBooks Desktop | data sync mode (Summary vs Detailed), chosen at setup | "**You can't change the data sync mode later.**" | <https://help.shopify.com/en/manual/sell-in-person/quickbooks/integration> |
| BILL ↔ QuickBooks Desktop | 2-way bill sync | "**After being enabled, this setting cannot be changed.**" | <https://help.bill.com/direct/s/article/360047318931> |
| Stripe Connect | connected account type / country / controller | "After you create a connected account, you can't change its type." | <https://docs.stripe.com/connect/accounts> |
| Intuit QBO | app-record scopes | "You can add additional scopes, but you can't remove existing ones." | <https://developer.intuit.com/app/developer/qbo/docs/get-started/app-settings> |

**Four cross-cutting conclusions, all load-bearing for Carbon's design:**

1. **Nobody asks before OAuth.** Plaid (§4.1) is the only case where a pre-consent choice
   shapes the consent screen. Carbon asking the mode question pre-consent is *inventing* the
   pattern, not following one — though every mechanism it needs is documented.
2. **Direction is usually scoped narrower than the integration** — per object (HubSpot Data
   Sync), per field (HubSpot↔Salesforce, Zendesk↔Jira), per table map (Dynamics dual-write),
   per workflow tab (Ramp). A single integration-wide toggle is rare.
3. **Separate "direction" from "who wins".** Microsoft's dual-write is explicit: "The Master
   for initial sync value is used only to resolve conflicts. **It doesn't control the
   direction that data should move in.**"
   <https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/data-entities/dual-write/enable-entity-map>
4. **Where immutability exists it is asymmetric and trapdoor-shaped: BILL lets you go safe
   (one-way) → risky (two-way) but not back. Nobody makes the SAFE choice irreversible.**
   And the warnings vendors write are about **data**, not settings — and they contradict
   each other across vendors (and even within HubSpot), so there is no industry default a
   customer can be assumed to know.

---

## 5. Provider-agnostic identifier resolution

### 5.1 Every unified API models an account with BOTH an opaque unified id AND the provider's own id

Unanimous across all four vendors — **DOCUMENTED**.

| Vendor | Unified id | Provider id | Human account code/number |
|---|---|---|---|
| **Merge** | `id` | `remote_id` — "The third-party API ID of the matching object." | `account_number` — "The account's number." |
| **Rutter** | `id` — "The Rutter generated unique ID of the account." | `platform_id` — "The platform specific ID of the account." | `nominal_code` |
| **Codat** | `id` | (platform-generated record id returned on push) | `nominalCode` (≤10 chars) |
| **Apideck** | `id` | (connector-specific) | `nominal_code`, plus `code` |

- Merge Account object: `id`, `remote_id`, `created_at`, `modified_at`, `name`,
  `description`, `classification`, `type`, `account_type`, `status`, `current_balance`,
  `currency`, `account_number`, `parent_account`, `company`, `account_url`,
  `remote_was_deleted`, `field_mappings`, `remote_data`. <https://docs.merge.dev/accounting/accounts/>
- Rutter Account object: `id`, `platform_id`, `parent_id`, `account_type`, `category`,
  `status`, `balance`, `currency_code`, `name`, `nominal_code`, `subsidiaries`,
  `additional_fields`, `platform_url`, `platform_data`. <https://docs.rutter.com/rest/version/accounts>
- **Rutter is the only vendor that lets you ADDRESS an object by either identifier** — an
  `id_type` query parameter with values `rutter` (default) and `platform`, with the
  documented caveat that it is **not currently supported on Sage Intacct or Sage Business
  Cloud**. That exception is itself informative: the abstraction leaks on exactly the
  providers with the most idiosyncratic key model. <https://docs.rutter.com/rest/version/accounts>
- Codat documents a provider-specific requirement driven by the code field: when writing
  bank accounts to NetSuite, `nominalCode` is **required** if Chart of Account numbering is
  enabled. <https://docs.codat.io/integrations/accounting/netsuite/oracle-netsuite-integration-reference>
- Apideck states the sharpest form of the problem: **"Xero requires `ledger_account.code`
  specifically; other connectors use `id`."**
  <https://developers.apideck.com/guides/accounts-payable-automation>

### 5.2 Id or code? Both — and which is authoritative is provider-dependent

| Provider | Opaque record key | Human account number |
|---|---|---|
| **Xero** | `AccountID` (UUID) | `Code` (e.g. `"300"`) — invoice lines can reference by **either** `AccountCode` or `AccountId` (<https://developer.xero.com/documentation/api/accounting/accounts>; page is JS-rendered — re-verify exact wording before quoting) |
| **QuickBooks Online** | `Id` | `AcctNum` — exists but **is not a filterable query field**; documented workaround is to fetch all accounts and match client-side (<https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account>) |
| **Sage Intacct** | `RECORDNO` (system-generated) | `ACCOUNTNO` (user-defined) — required on create, key for `readByName` (<https://developer.intacct.com/api/general-ledger/accounts/>) |
| **NetSuite** | `internalId` | account number, only when Use Account Numbers is on |

**Practical consequence:** the account *code* is the only identifier a human recognises and
the only one portable in meaning across providers — but it is not reliably queryable (QBO),
not always present (NetSuite), and length-capped (Codat: 10 chars). The opaque id is always
authoritative but meaningless across providers and unstable across reconnects. **Store
both.**

### 5.3 Vendors

- **Merge** models vendors and customers as ONE `Contact` model with booleans: "A `Contact`
  is a Vendor/Supplier if the `is_supplier` property is true". **Documented leak:** on Xero
  those flags are set automatically by transaction activity and cannot be assigned directly
  via the API — the same logical concept has different mechanics per provider.
  <https://help.merge.dev/articles/3803104115-posting-contacts-with-merge-s-accounting-unified-api>
- **Rutter** uses separate `/vendors` endpoints; bills reference `vendor_id` and lines
  reference `account_id`. <https://docs.rutter.com/guides/ap-automation>
- **Apideck** suppliers carry `id`, `company_name`, `display_name`, `tax_number`,
  `currency`, `status`, …; transactions reference `supplier_id`.
  <https://developers.apideck.com/guides/accounts-payable-automation>
- **Codat's `*Ref` field names (`supplierRef`, `accountRef`) — NOT VERIFIED** at the URLs
  checked. Do not cite them without confirming.

### 5.4 Is the cross-provider identifier problem documented, with a resolution strategy?

**The problem is documented. A canonical resolution strategy is not — the universal
recommendation is "make the customer map it, in a UI."**

**Codat is the most explicit**, with a dedicated best-practices page titled *Implementing an
account mapping user interface*
(<https://docs.codat.io/using-the-api/best-practices/implementing-a-mapping-page>): enable
Chart of Accounts on connection, subscribe to `chartOfAccounts` webhooks, render
`account.name` / `account.id` in a dropdown filtered by `status=active` and type. Its most
operationally important warning, verbatim:

> "validate account mappings periodically because customers may continue changing their list
> of accounts after they have set up your integration."

**Mappings rot.** Codat is the only vendor to say so out loud, and it is the most actionable
warning in the whole corpus.

Codat also states the per-customer variance directly: "Every SMB customer has its own
preference on how an individual expense should be represented in their accounting
software… You can retrieve these options using the Mapping options endpoint"
(<https://docs.codat.io/expenses/config-and-categorize/>) — and its recommendation there is
to **cache the mapping options and have the customer choose at configuration time** rather
than maintaining static mappings. Per-provider required-field divergence is handled with
"Get create model" endpoints — "Each integration may have different requirements to the body
of a write request" (<https://docs.codat.io/using-the-api/push>).

**NOT FOUND:** none of the four vendors documents a persistence schema for
"caller's internal id ↔ provider id". Apideck comes closest with "store the returned
supplier `id` alongside internal vendor records" and "cache ledger account IDs by nominal
code" — a documented resolve-by-code strategy, but not a named pattern.

### 5.5 Passthrough escape hatches

- **Merge**: three tiers, with documented guidance on which to use
  (<https://help.merge.dev/en/articles/5779316-when-should-i-use-remote-data-a-passthrough-request-or-a-custom-field>).
  **Remote Data** (raw third-party payload; "Merge does not normalize Remote Data, so the
  data structure may vary between integrations"; assert on the `path` variable, never the
  array index), **Authenticated Passthrough** (requests "directly to an integration's API"),
  **Field Mappings** (requires Remote Data enabled).
- **Apideck**: `pass_through` ("allows unmapped key/values that will be passed through to
  downstream", <https://developers.apideck.com/guides/pass-through>) and `custom_mappings`.
- **Rutter**: `platform_data`, `platform_url`, `additional_fields` on the object. A
  general-purpose passthrough endpoint was **NOT FOUND**.
- **Codat**: "Get create model" endpoints serve the analogous role (discovering per-provider
  required fields). A raw passthrough endpoint was **NOT FOUND**.

---

## What this means for Carbon

### R1. Detect the mode; do not make the customer declare it blind

`GET /developer/v1/accounting/all-connections` needs only `accounting:read` and returns
`connection_type` (`API | CSV | DIRECT`), `is_active` and `remote_provider_name` for every
connection. Carbon can read that at connect time and *know* whether some other provider
holds the seat, and which one. Present the mode choice pre-filled from that read rather than
as a naked question — the customer already told Ramp the answer.

### R2. Two OAuth scope sets, chosen before consent, and treat the granted set as truth

Ramp's authorize URL takes `scope` as a space-separated list; the Developer Console holds
the superset. So:

- **Provider mode** (today): `accounting:read accounting:write transactions:read bills:read
  bills:write reimbursements:read vendors:read vendors:write purchase_orders:write` + whatever
  else Carbon already requests.
- **Push-only mode**: the same **minus `accounting:write`**, plus `item_receipts:write`.
  Keep `accounting:read` — it is what lets Carbon enumerate Rillet's chart of accounts and
  field options (R4).

Per RFC 6749 §3.3, read back the `scope` in the token response and store it; do not assume
the request was honoured. Per §6, **narrowing a token is free, widening needs a fresh
authorization code flow** — so "push-only → provider" must re-run OAuth. Say so in the UI.

**But do not assume the reverse is free either.** On Google, an existing *grant* does not
shrink by requesting fewer scopes — the documented path is `revoke()` plus
`prompt=consent`; on Slack, scopes are purely additive and never shrink via the OAuth flow.
Whether Ramp narrows a grant on a re-authorization with a smaller `scope`, or unions it with
what was previously consented, is **UNVERIFIED**. So "provider → push-only" should
**revoke/disconnect and re-authorize**, not merely re-run `/authorize` with a shorter list —
otherwise Carbon may still hold `accounting:write` while telling the customer it does not.
That is the honest-consent failure R2 exists to avoid.

Follow Microsoft's design rule for the Developer Console side: the statically configured
allowed-scope list should be a **superset** of every mode's request set
(<https://learn.microsoft.com/en-us/entra/identity-platform/consent-types-developer>) — which
is also exactly what Ramp's `invalid_scope` → "Requested scope not configured for app"
error enforces.

The Plaid precedent suggests an alternative worth considering: request the *superset* at
connect time and gate on a stored mode flag. That makes mode switching free, at the cost of
a scarier consent screen and of holding a write scope Carbon promises not to use. **Given
that the whole point is that the customer wants Rillet to own accounting, asking for
`accounting:write` and promising not to use it is the wrong trade.** Recommend the reduced
scope set — the honest consent screen is the feature.

### R3. Immutability: make the mode changeable, but make the consequences explicit

Nothing in the specs requires immutability, and Slack proves it need not be universal. But
in Carbon's case, switching modes changes *what has already been posted*: a period run in
provider mode has Carbon-originated AP journals; the same period in push-only mode does not.
Recommend: **mode is changeable, but gated behind an explicit confirmation naming the
accounting-period boundary, and never silently** — the risk is a period with AP counted
twice or not at all, not a broken token.

Two precedents shape the copy. First, §4.4's asymmetry rule: BILL and Shopify make the
*risky* choice irreversible and the safe one free; nobody makes the safe choice
irreversible. Push-only is Carbon's safe choice, so "provider → push-only" should be the
cheap direction and "push-only → provider" the one that warns. Second, the vendors' warnings
are about **data**, not settings, and they contradict each other — so Carbon must state its
own semantics explicitly rather than assume the customer knows: does switching re-post
history, or only affect documents created afterwards? Unito's line is the model to copy:
"changes will only affect newly created work items, unless you decide otherwise."

Follow Microsoft dual-write's separation too: **direction and who-wins are two settings, not
one.** Carbon's mode says where AP is posted; it should not silently also decide conflict
resolution for anything else the integration syncs.

### R4. Resolve coding identifiers by reading Ramp, not by guessing Rillet

The mechanism is documented and clean:

1. `GET /accounting/fields` + `GET /accounting/field-options` + `GET /accounting/accounts`
   with `accounting:read` → the active provider's fields and options, each with its
   `external_id` (sourced from the remote ERP for direct connections) and `provider_name`.
2. Map Carbon's accounts and cost centers onto those external ids and **persist the mapping**.
3. Send `accounting_field_selections: [{ field_external_id, field_option_external_id }]` on
   the PO and the draft bill.

Carbon already has the right storage shape: `externalIntegrationMapping` with
`entityType = "account"` carries **both** `externalId` and `externalCode` per integration
(`packages/ee/src/accounting/core/account-mapping.ts`). That is exactly the "store both
identifiers" conclusion every unified-API vendor converges on (§5.1), and it is already why
Carbon can address QBO by `AccountRef.value` (id) and Xero/Rillet by `AccountCode` /
`account_code` from one model. Reuse it — add a Ramp-scoped mapping row keyed on the
*accounting-provider-sourced* external id, distinct from the mapping Carbon writes when it
IS the provider.

**Take Codat's warning seriously: mappings rot.** The customer keeps editing the chart of
accounts in Rillet. Re-read the field options on every sync run, not only at install, and
surface a mapping-drift state rather than silently pushing a stale `field_option_external_id`.

### R5. Stop sending `remote_id` on the bill; find a different echo guard

`remote_id` is documented as "an ID that identifies the bill on the client's side", where
"client" means the accounting-connection owner. In push-only mode that is Rillet. Carbon
must omit it. `enable_accounting_sync` defaults to `true`, which is what Carbon wants — the
draft should flow onward to Rillet.

That removes Carbon's current dedupe key. Options, in order of preference:

1. **`invoice_number`** — Ramp's own documented dedupe for bill import is "same vendor and
   invoice number", and Ramp widened `invoice_number` to 84 characters specifically to
   accommodate longer numbers from accounting providers. Following Ramp's own key is the
   least surprising choice.
2. **`memo`** carrying a Carbon reference — weaker, human-visible, and free-text.
3. A Carbon-side `externalIntegrationMapping` row keyed on the Ramp bill id returned by the
   create call — authoritative on Carbon's side, useless for detecting a bill a human
   created in Ramp.

Recommend (1) plus (3): match on vendor + invoice number, record the returned Ramp id.

### R6. Push item receipts — this is Carbon's strongest differentiator and it is free

`POST /developer/v1/item-receipts` needs only `item_receipts:write` and takes
`purchase_order_id`, `item_receipt_number`, `received_at`, and
`item_receipt_line_items[].purchase_order_line_item_id`. Carbon owns receiving; Rillet does
not; Ramp's documented three-way match is "bill, PO, and item receipt all reference the same
line items." Ramp/Intacct even *requires* the item receipt to exist before a matched bill
can sync. Carbon pushing PO + item receipt into Ramp makes Ramp's three-way match work
against real manufacturing receipts, which is a capability neither Ramp nor Rillet can
produce alone.

This is also the industry-standard answer to the GR/IR problem (R8): Coupa → SAP works
precisely because the receipt event reaches the system that posts both legs.

### R7. Suppress Carbon's AP posting with the lever that already exists

Carbon already has `companyIntegration.metadata.settings.postingSync.families.ap` with the
enum `documents | journals | none`
(`packages/ee/src/accounting/core/models.ts`, `posting.ts`). Push-only mode should set
**`ap: "none"`** on the GL integration. Note the documented side effect:
`isPaymentSyncbackEnabled` returns true only in `documents` mode, so `ap: "none"` also stops
pulling AP payments back — which is correct, since Ramp/Rillet now owns the payment.

This also means Carbon must **not** run its existing inbound `ramp-bills` /
`ramp-reimbursements` / `ramp-charges` pulls in push-only mode. Ramp is exporting those to
Rillet; pulling them into Carbon and posting them would recreate the exact double-count the
`DOC_BACKED` policy was introduced to fix
(`.ai/docs/ramp-card-charge-rillet-flow.md`: "that double-count was a real bug, fixed
2026-09-10"). Push-only should hard-disable `pullTransactions`, `pullBills` and
`pullReimbursements`, not merely default them off.

### R8. GR/IR is the unsolved problem, and it needs a deliberate decision

Carbon's `post-receipt` credits `accountDefault.goodsReceivedNotInvoicedAccount` on receipt;
`post-purchase-invoice` debits it when the supplier invoice posts
(`packages/database/supabase/functions/post-receipt/index.ts`,
`post-purchase-invoice/index.ts`). In push-only mode the invoice never posts in Carbon, so
**the GRNI credit never clears.** It grows monotonically.

The research found **no vendor documentation for a split GR/IR at all** — every integration
studied avoids the problem by putting both legs in one ledger. So Carbon must pick, and own,
one of three positions:

1. **Carbon keeps posting receipts AND the AP invoice locally; only the *GL forwarding* of
   AP stops.** GRNI clears in Carbon; Rillet receives AP from Ramp; Carbon's ledger and
   Rillet's ledger disagree on AP by construction. Rejected — two ledgers, one truth.
2. **Carbon suppresses the receipt-side GL posting in push-only mode.** Precedent exists
   (D365's "Post product receipts to ledger" is a documented switch; NetSuite's Accrued
   Purchases only exists with Advanced Receiving). Carbon's receipts become non-posting
   operational events, and Rillet books expense/inventory when the bill arrives. Clean, but
   it loses the accrual and therefore the period-end cut-off — a manufacturer receiving
   heavily at month-end would understate cost.
3. **Carbon posts the GRNI accrual and reverses it on a documented trigger** — the Ramp bill
   reaching `BILL_SYNCED`, read back via `GET /bills?sync_status=BILL_SYNCED` with
   `bills:read`. Carbon never posts AP; it only clears its own accrual against the receipt
   when it can prove the invoice was posted elsewhere. This is the only option that keeps
   the accrual *and* clears it, and it is the Coupa→SAP shape rotated: Carbon owns the
   accrual leg, and the external system's own posting is the clearing signal.

**Recommend (3)**, with (2) as an explicit fallback setting for customers who do not want
the accrual at all. (3) depends on Ramp's `sync_status` being readable and reliable for a
non-provider app — **UNVERIFIED**, and it should be the second thing tested in the sandbox
after §1.6.

### R9. Name the mode, and say what Ramp does not guarantee

Brex names it (`ACCOUNTING` vs `ERP` field group), BILL names it (AP & AR sync token), Coupa
names it (`third_party_partner`). Ramp does not. Carbon is building on an
inferred-but-well-evidenced affordance of Ramp's scope split, not a documented product mode.
The setting should say so plainly — something like "Ramp's accounting integration is owned
by <provider>. Carbon will push purchase orders, receipts and provisional bills only." — and
the health check should degrade (not error) if Ramp's behaviour changes under it.

### R10. Do not delete the connection on uninstall in push-only mode

`rampOnUninstall` currently best-effort deletes the accounting connection. In push-only mode
that connection is Rillet's. Whether Ramp permits it is **UNVERIFIED**; that Carbon must not
attempt it is not.

---

## Unverified / needs live confirmation

Ordered by how much of the design depends on the answer.

1. **Does Ramp validate `field_external_id` / `field_option_external_id` on a bill or PO
   against the ACTIVE connection's uploaded options — and what happens on a miss?** Reject,
   silent drop, or accept? A silent drop produces uncoded bills in Rillet with no error
   anywhere. *(§1.6. Test first.)*
2. **Can a non-provider app read the active provider's coding surface at all?** `GET
   /accounting/accounts` / `/fields` / `/field-options` require only `accounting:read`, and
   the GL account `external_id` is documented as ERP-sourced for direct connections — but no
   doc says an app that does not own the connection may read it. R4 collapses without this.
   *(§1.2)*
3. **Is `sync_status` / `BILL_SYNCED` readable by a non-provider app with `bills:read`?**
   R8's recommended GRNI clearing trigger depends on it. *(§1.2, R8)*
4. **Can a caller with only `vendors:write` set `accounting_vendor_remote_id` on a spend
   vendor, pointing at an accounting vendor Rillet created?** And what happens when Rillet
   has already linked that accounting vendor to a different Ramp vendor (the documented
   uniqueness constraint)? *(§1.5)*
5. **What does `POST /accounting/connection` actually do when another provider holds the
   active connection?** Documented responses are only 201/400; there is no documented
   conflict code (contrast Brex's `409 ACTIVE_INTEGRATION_EXISTS`). Carbon must not rely on
   a guessed failure mode. *(§1.3)*
6. **Can `DELETE /accounting/connection` remove another app's connection?** Ownership is not
   mentioned in the description. *(§1.3, R10)*
7. **Is Rillet's Ramp connection `connection_type: API` or `DIRECT`?** It matters: the
   chart-of-accounts read-only rule is phrased for *direct* connections, and
   `accounting_connection_id` writes require an *API* connection. Rillet's presence in Ramp's
   supported-integration list alongside both kinds does not settle it. *(§1.1)*
8. **Does omitting `remote_id` on a draft bill change anything downstream in Ramp's export to
   Rillet?** Carbon's current behaviour is live-verified only for the Carbon-as-provider
   case. *(§1.7, R5)*
9. **BILL: is there a one-accounting-connection limit?** The help-center articles that would
   settle it are login/JS-gated. Do not infer a limit from BILL's UI. *(§2.2)*
10. **Navan, Airbase/Paylocity, Expensify, Mesh, Center** — no verified findings on any of the
    four questions. API docs are account-gated. *(§2.4)*
11. **Does re-authorizing Ramp with a SMALLER `scope` actually narrow the grant, or union it
    with what was previously consented?** Google and Slack both union (narrowing requires
    revoke); Stripe narrows on refresh. Ramp documents neither. R2's "revoke and
    re-authorize" advice is a safe default precisely because this is unknown. *(§4.2, R2)*
12. **Codat's `*Ref` field names (`supplierRef` / `accountRef` / `customerRef`)** — named in
    secondary sources, not confirmed on a fetched Codat page. **Apideck `downstream_id`** —
    appeared in search summaries only, NOT CONFIRMED. **Slack manifest `bot_optional` /
    `user_optional`** — two independent reads of the same page disagreed; unresolved.
    *(§4.2, §5.3)*
13. **Pages that are JS-rendered and were read via search index rather than DOM**, so exact
    wording should be re-checked before quoting: Xero's Accounts element reference and its
    scopes page (scope names were instead confirmed from the XeroAPI OpenAPI repo), Intuit's
    developer docs, Brex's rendered API reference (the OpenAPI YAML was fetched directly
    instead), and BILL's Salesforce-rendered help center. *(§2.1, §2.2, §4.2, §5.2)*
