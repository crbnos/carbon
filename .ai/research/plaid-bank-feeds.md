# Plaid Bank Feeds — Research Notes (Bank Reconciliation Phase 2)

> Date: 2026-07-02 · Feeds spec: `.ai/specs/2026-07-02-plaid-bank-feeds.md`
> Builds on `.ai/research/bank-reconciliation.md` (Part 2 had Plaid facts from model knowledge only — the deep-research verification pass died at a usage limit). This file re-verifies the load-bearing Plaid mechanics directly against plaid.com/docs (fetched 2026-07-02).

## Verified Plaid API facts

### /transactions/sync — [docs](https://plaid.com/docs/api/products/transactions/)

- First call: cursor null/empty → response carries `next_cursor`; subsequent calls pass it. Cursor is ≤256 chars base64, **valid ≥1 year after the final pagination page**.
- Response: `added` / `modified` / `removed` arrays + `has_more`; loop with `next_cursor` until `has_more = false`.
- **`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`**: if the Item's data mutates mid-pagination, the **entire loop must restart from the first cursor of the update** — not just the failed page. ⇒ Persist the cursor only after a *complete* loop; buffer pages in memory (or staging) until then.
- Pending: `pending: true` rows; posted rows carry `pending_transaction_id` linking back; the pending row later appears in `removed`. Pending details may change before settlement.
- **Amount sign: positive = money OUT of the account** (debit purchases positive; deposits negative) — invert at ingest for Carbon's positive-=-inflow convention.
- `transactions.days_requested`: default **90**, range 1–730 (**production minimum 30**), and **cannot be changed after the Transactions product is active on the Item** — the backfill window is fixed at link time.

### Webhook verification — [docs](https://plaid.com/docs/api/webhooks/webhook-verification/)

- JWT arrives in the **`Plaid-Verification`** header (treat header name case-insensitively). `alg` MUST be `ES256` — reject anything else.
- Fetch the public key from **`/webhook_verification_key/get`** using the JWT header's `kid`; cache keys by `kid`.
- Validate the body via the JWT claim **`request_body_sha256`** against a SHA-256 of the *raw* body using a **constant-time comparison**; reject webhooks with `iat` **older than 5 minutes** (replay protection).

### Transactions webhooks — [docs](https://plaid.com/docs/transactions/webhooks/)

- **`SYNC_UPDATES_AVAILABLE`** is the only webhook a /sync integration needs. Payload: `initial_update_complete` (≥30 days ready), `historical_update_complete` (full `days_requested` history ready).
- It **only starts firing after `/transactions/sync` is called at least once on the Item** ⇒ prime each Item with an immediate sync right after token exchange.
- Legacy webhooks (`INITIAL_UPDATE`, `HISTORICAL_UPDATE`, `DEFAULT_UPDATE`, `TRANSACTIONS_REMOVED`) still fire in some paths (e.g. `/transactions/refresh`) — ignore them; act only on `SYNC_UPDATES_AVAILABLE` + `ITEM` webhooks.

### Link update mode (re-auth) — [docs](https://plaid.com/docs/link/update-mode/)

- Create a link_token with the **`access_token`** param (no `products` needed); user re-authenticates in Link.
- Triggers: **`ITEM_LOGIN_REQUIRED`** error/webhook, **`PENDING_EXPIRATION`** (consent expires within 7 days), **`PENDING_DISCONNECT`**.
- **The access_token does not change** — no re-exchange after update mode completes.

### /link/token/create — [docs](https://plaid.com/docs/api/link/)

- Required: `client_name` (≤30 chars), `language`, `country_codes` (ISO-3166-1 alpha-2), `user`. `products: ["transactions"]`. Optional `webhook` URL per Item. `transactions.days_requested` set here (see above — immutable later).

### Sandbox — [docs](https://plaid.com/docs/sandbox/)

- Credentials `user_good` / `pass_good` at any sandbox institution.
- **`/sandbox/public_token/create`** bypasses the Link UI entirely — ideal for automated tests.
- **`/sandbox/item/fire_webhook`** triggers webhooks on demand (needs a reachable webhook URL).
- **`/sandbox/item/reset_login`** forces `ITEM_LOGIN_REQUIRED` (tests the re-auth flow). Sandbox Items also auto-enter `ITEM_LOGIN_REQUIRED` 30 days after creation.

## Carbon context (verified this session)

- Integration framework: `packages/ee/src/index.ts` `integrations` array; per-integration `config.tsx` + `hooks.server.ts` (registered in `packages/ee/src/hooks.server.ts`); `companyIntegration` (PK (id, companyId), `metadata` JSON, `active`); OAuth/webhook route precedents `api+/integrations.xero.*` / `api+/webhook.xero.ts`; Inngest `sync-external-accounting` + `accounting-backfill` job precedents; `trigger()` mapping in `packages/lib/src/trigger.ts` + typed events in `packages/lib/src/events.ts`; env via `packages/env` `getEnv` (integration hides itself when unset).
- **`companyIntegration.id` FKs to an `integration` registry table** — check how Xero's row is seeded (migration vs runtime upsert) and mirror for `plaid`.
- **Vault: NOT verified.** No `vault`/`pgsodium` references anywhere in `packages/database/supabase/migrations/` or `config.toml`. The master spec's accepted decision (Plaid tokens in Supabase Vault) needs an environment probe (`SELECT 1 FROM vault.secrets LIMIT 0`) across local crbn stack, Docker deploy, and cloud before it's real. Fallback: app-layer AES-256-GCM with a `PLAID_TOKEN_ENCRYPTION_KEY` env secret, same metadata shape (`tokenCiphertext` instead of `tokenSecretId`).
- Local-dev webhook reachability: portless `*.dev` is local-only — Plaid cannot deliver webhooks to a dev machine. Dev loop = manual "Sync now" + scheduled catch-up; webhook path testable against a deployed env (or tunnel) with `/sandbox/item/fire_webhook`.
- Phase 1 already shipped (or ships) everything the feed lands on: `bankAccount` (plaidItemId/plaidAccountId/connectionStatus/lastSyncedAt), `bankTransaction` (externalId unique per account, `pendingExternalId`, `needsReview`, Pending status), `bankAccountBalance`, `run_bank_matching` RPC.

## Design takeaways

1. Cursor persistence is transactional-per-loop: never store `next_cursor` from a partial loop (mutation restart rule).
2. Prime `/transactions/sync` immediately post-exchange or webhooks never fire.
3. Webhook route = pure verifier + dispatcher (JWT verify, dedupe, fire Inngest event); all real work in the job — Xero webhook precedent already works this way.
4. Backfill window is a connect-time, per-Item, irreversible choice — surface it in the connect UI (90 default / 180 / 365 / 730).
5. Re-auth = banner → update-mode link token → done (no re-exchange, no remapping).
6. Sandbox supports fully automated e2e (public_token/create → exchange → sync → reset_login → update mode) without a browser Link flow.
