# Ramp sandbox verification (Task 1)

**Date:** 2026-08-28
**Host:** `https://demo-api.ramp.com` (sandbox)
**Client id:** `ramp_id_nzJ0…` (sandbox; secret held in shell env only, never committed)

## Summary — BLOCKED on scope grants

The sandbox API client authenticates (a token mints) but is **granted none of the
required OAuth scopes**, so every resource endpoint returns
`DEVELOPER_7100: "These scopes are not allowed for this client"`. The field-shape
verifications the code's `// TODO(task-1)` markers depend on **cannot be run until
the scopes are enabled on the Ramp app** (Ramp developer dashboard → this API app →
enable/request scopes). This is a dashboard configuration, not an API-settable one.

## Verified / refuted

- **VERIFIED — token endpoint.** `POST /developer/v1/token` with HTTP Basic
  `clientId:clientSecret` and `grant_type=client_credentials` returns a Bearer token.
  `expires_in: 864000` (**10 days**, matches the plan). The response carries **no
  `scope` field**, and the token endpoint issues a token for ANY requested scope
  string — it does **not** validate scope grants at mint time. So a successful mint
  says nothing about which scopes the client actually holds; the resource call is the
  real gate.
- **REFUTED — client scope grants.** Every real resource call fails
  `DEVELOPER_7100 / HTTP 403: "These scopes are not allowed for this client: <scope>"`.
  Tested (single-scope token → matching real endpoint), all **DENIED**:
  `accounting:read` (`GET /accounting/all-connections`, `GET /accounting/connection` → 403),
  `transactions:read` (`GET /transactions` → 403),
  `bills:read` (`GET /bills` → 403),
  `vendors:read` (`GET /accounting/vendors` → 403),
  `reimbursements:read` (`GET /reimbursements` → 403),
  `transfers:read` (`GET /transfers` → 403),
  `purchase_orders:read` (`GET /purchase-orders` → 403),
  `statements:read` (`GET /statements` → 403),
  `cashbacks:read` (`GET /cashbacks` → 403),
  `receipts:read` (`GET /receipts` → 403),
  `entities:read` (`GET /entities` → 403),
  `business:read` (`GET /business` → 403).
  Note: an unknown PATH returns a Flask **404** *before* the scope check (e.g.
  `accounting/gl-accounts`), which briefly masked the denial — the authoritative
  signal is the 403 `DEVELOPER_7100` on a real path.
- **BLOCKED (pending scopes) — the field-shape questions.** All of the following
  `// TODO(task-1)` items remain UNVERIFIED because their endpoints are unreachable:
  - transaction/line-item `amount` shape (minor-unit integer vs decimal vs object),
    `sync_status` values, `accounting_field_selections[].external_id`/`type`
    (`GL_ACCOUNT`/`COST_CENTER`), `card_holder`, `user_transaction_time`/`accounting_date`.
  - bills `sync_status` (`NOT_SYNCED`/`BILL_SYNCED`), `remote_id`, nested `payment`
    object, `payment_method` enum (`CARD`/`ONE_TIME_CARD`/`AUTOMATIC_CARD_PAYMENT`),
    `status === "PAID"`, `invoice_number`, line `accounting_field_selections`.
  - reimbursements `sync_status`/`state` (paid vs manual), `updated_after` filter,
    `user` object shape.
  - repayments object shape, any sync-status field, `from_repaid_at` filter,
    `funding_method`, `repayment_amount` shape.
  - transfers `amount`/`bank_account_id`/`statement_id`/`sync_status`.
  - `POST /accounting/connection`, `POST /accounting/accounts`, `POST /accounting/syncs`
    body key names + `error_v2` shape.
  - `POST /bills/drafts` (does it accept `remote_id`? draft→submit → Pending approval?),
    the id `submit` returns.
  - `POST /purchase-orders` accepted fields (`remote_id`?).
  - `POST /webhooks` returned `secret`, the challenge delivery shape, and the
    `X-Ramp-Signature` encoding (hex vs base64).

## Cleanup

No test objects were created (every write also requires a scope the client lacks), so
there is nothing to delete — no verification connection, webhook, draft bill, or PO
was created.

## Action required (user)

Enable/request these scopes on the sandbox API app in the Ramp developer dashboard,
then re-run this verification:
`accounting:read accounting:write transactions:read bills:read bills:write vendors:read
vendors:write reimbursements:read purchase_orders:read purchase_orders:write
transfers:read statements:read cashbacks:read receipts:read entities:read business:read`.
Until then, the integration's install (`client.getBusiness()` validation in
`rampOnInstall`) will fail with a clear 403 — which the hook already surfaces as a
credentials error.
