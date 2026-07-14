# Plaid Bank Feeds & Cash Position (Bank Reconciliation Phase 2)

> Status: in-progress
> Author: Claude (with Brad Barbin)
> Date: 2026-07-02
> Research notes: `.ai/research/plaid-bank-feeds.md` (Plaid mechanics verified against plaid.com/docs 2026-07-02)
> Parent spec: `.ai/specs/2026-07-02-bank-reconciliation.md` (Phase 2 of its phasing table)

## TLDR

Phase 1 gives Carbon bank reconciliation with manually uploaded statements; Phase 2 removes the manual step and adds daily cash visibility. A **Plaid integration** (following the Xero integration architecture exactly: `packages/ee` registry entry, `companyIntegration` row, webhook route, Inngest jobs) lets a controller connect their banks through Plaid Link, map each Plaid account to a Carbon `bankAccount`, and from then on statement lines flow in automatically: a webhook-driven **`bank-feed-sync`** job runs the `/transactions/sync` cursor loop (restart-on-mutation semantics, cursor committed only after a complete loop), inverts Plaid's outflow-positive sign, swaps pending lines for posted ones via `pending_transaction_id`, flags feed-removed-but-matched lines for review, snapshots balances into `bankAccountBalance`, and finishes by running the Phase 1 auto-matcher. Item health is managed end-to-end: ES256-JWT-verified webhooks, `ITEM_LOGIN_REQUIRED`/`PENDING_EXPIRATION` → a Requires Reauth banner → Link **update mode** (same access token, no re-exchange), plus a daily scheduled catch-up sync as webhook-loss insurance. Access tokens are stored Vault-backed per the parent spec's resolved decision — with an explicit environment probe and an app-layer AES-GCM fallback if Vault turns out to be absent from the self-hosted stack (it is currently unverified there). On top of the feed, a **Cash Position** page becomes the Banking landing: per account, the latest bank balance vs GL balance with the drift decomposed into unmatched statement lines, outstanding GL items, and an unexplained residual — the "your books are wrong" signal, daily instead of at month-end. **Cross-account transfer detection** proposes matches for opposite-signed equal-amount lines between own accounts and books the transfer JE on accept.

## Problem Statement

With Phase 1 alone, a controller must log into each bank portal, download OFX/CSV files, and upload them — weekly at best, so unrecorded fees, duplicate ACHs, and failed deposits hide for days or weeks, and the reconcile workspace is only as fresh as the last upload. Concretely: a $12,400 customer wire lands Monday; nobody uploads a statement until Friday; the part shipment waiting on "payment received" sits five days. Meanwhile "how much cash do we have right now, and do the books agree?" still requires opening three bank portals and a trial balance side by side. Transfers between own accounts (operating → payroll) appear as two unmatched lines in two workspaces with no linkage, and each must be hand-coded as a JE.

NetSuite ships bank feeds through aggregators (Salt Edge named for Europe; US partner unnamed) on top of the same two-stage flow Carbon built in Phase 1; Xero/QBO treat feeds as the default and file upload as the fallback. Plaid is the natural aggregator for Carbon's mid-market US customer base, and the parent spec already resolved the decisions (Plaid SDK server-side, script-tag Link, Vault-backed tokens, 90-day default backfill).

## Proposed Solution

### Integration registration (Xero pattern, verbatim)

- `packages/ee/src/plaid/config.tsx`: registry entry (id `plaid`, category Banking, logo, description); hidden unless `PLAID_CLIENT_ID` + `PLAID_SECRET` env vars are set. Added to the `integrations` array in `packages/ee/src/index.ts`.
- `packages/ee/src/plaid/hooks.server.ts` registered in `packages/ee/src/hooks.server.ts`: `onInstall` (no event-system subscriptions needed — the feed is inbound-only), `onUninstall` (remove webhooks is a no-op — Plaid webhook URL is per-Item; mark Items disconnected, clear connection status on mapped bank accounts, delete stored tokens), `onHealthcheck` (per Item: `/accounts/get`; any `ITEM_LOGIN_REQUIRED` → unhealthy).
- `packages/ee/src/plaid/client.ts`: thin wrapper over the `plaid` Node SDK (new production dependency in `@carbon/ee`, resolved in the parent spec), constructed from `PLAID_CLIENT_ID`/`PLAID_SECRET`/`PLAID_ENV` (`sandbox` | `production`).
- If the `integration` registry table requires a seeded row (verify how Xero's row exists), a one-line idempotent migration seeds `plaid`.

### Connect flow

1. **Start** (settings → integrations → Plaid, or "Connect bank" on the bank accounts page): action route `api+/integrations.plaid.link-token.ts` calls `/link/token/create` with `products: ["transactions"]`, `webhook: <app URL>/api/webhook/plaid`, `transactions.days_requested` from the user's backfill choice (**90 default / 180 / 365 / 730** — immutable per Item after link, so it is chosen here), `user.client_user_id = userId`.
2. **Link** (client): Plaid Link loaded via script tag (no npm client dep); on success posts `public_token` + institution metadata to `api+/integrations.plaid.exchange.ts`.
3. **Exchange** (server): `/item/public_token/exchange` → `access_token` + `item_id`. Token goes to secret storage (below); `companyIntegration('plaid', companyId).metadata.items[]` gains `{ itemId, tokenRef, institutionId, institutionName, daysRequested, cursor: null, status: "Connected", connectedBy, connectedAt }`. The row is upserted `active: true` on first connect.
4. **Map accounts**: the exchange response lists the Item's accounts (`/accounts/get`); a mapping step shows each Plaid account (name, mask, type, currency) with three choices per account: create a new `bankAccount` (prefilled name/mask/type/currency — GL account picked by the user), link to an existing unmapped `bankAccount` (currency must match), or skip (not synced). Mapped accounts get `plaidItemId`/`plaidAccountId`/`source = 'Plaid'`/`connectionStatus = 'Connected'`.
5. **Prime**: fire `bank-feed-sync` for the Item immediately — `SYNC_UPDATES_AVAILABLE` only starts firing after the first `/transactions/sync` call on an Item (verified), so priming is mandatory, and it also delivers the initial backfill without waiting for a webhook.

### Token storage (Vault, with a probed fallback)

Parent-spec decision: Supabase Vault. **Unverified in this stack** (no `vault`/`pgsodium` anywhere in migrations or `config.toml`) — so:

- Implementation Task 1 probes `SELECT 1 FROM vault.secrets LIMIT 0` on the local stack and the Docker/cloud deploy targets.
- **If present**: `tokenRef = { kind: "vault", secretId }` via `vault.create_secret(access_token)`; reads happen server-side only (service role) through `vault.decrypted_secrets`.
- **If absent anywhere we deploy**: fallback is app-layer **AES-256-GCM** with a required `PLAID_TOKEN_ENCRYPTION_KEY` env secret (32 bytes, base64); `tokenRef = { kind: "aes", ciphertext, iv, tag }` stored in the metadata JSON. Same interface (`getItemAccessToken(companyId, itemId)` in `packages/ee/src/plaid/tokens.server.ts`), so the storage backend is swappable and the Xero-token migration can follow either way.
- Never the Xero plaintext pattern for bank credentials (fallback pre-approved; see resolved Open Question 1).

### Sync job — `bank-feed-sync`

Inngest function (`carbon/bank-feed-sync`, registered in `packages/lib/src/trigger.ts` + `events.ts`), payload `{ companyId, itemId, trigger: "webhook" | "manual" | "scheduled" | "connect" }`, concurrency-keyed on `companyId:itemId` so one Item never syncs twice concurrently:

1. Load Item (metadata + token), resolve mapped `bankAccount`s by `plaidAccountId`.
2. **Cursor loop**: `/transactions/sync` from the stored cursor until `has_more = false`, buffering pages. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, restart the whole loop from the stored cursor (verified requirement). Only after a complete loop: apply changes + persist `next_cursor` to metadata.
3. **Apply** per mapped account (unmapped accounts' transactions are skipped):
   - `added`: insert `bankTransaction` (`source: 'Plaid'`, `externalId = transaction_id`, **amount = −plaid.amount**, `status = pending ? 'Pending' : 'Unmatched'`, `pendingExternalId = pending_transaction_id`, `counterparty` from `merchant_name ?? name`, `raw` = trimmed payload) with `ON CONFLICT (bankAccountId, externalId) DO NOTHING`.
   - `modified`: update the same columns by `externalId` **only when the row is still Pending/Unmatched**; a modified-but-Matched line gets `needsReview = true` instead of silent mutation.
   - `removed`: delete Pending/Unmatched rows; a removed-but-Matched/Reconciled row gets `needsReview = true` (never deleted).
   - Pending→posted swap: when an `added` posted row carries `pendingTransactionId`, delete the matching Pending row (by `externalId = pending_transaction_id`) in the same transaction.
4. **Balances**: `/accounts/balance/get` → upsert `bankAccountBalance` (`date = today`, `source = 'Plaid'`, `balance = current`, sign flipped for credit accounts so the stored balance is in Carbon's convention) — one snapshot per account per day (existing unique index).
5. **Match**: `run_bank_matching(bankAccountId, companyId, userId)` per affected account (userId = the job's acting user: the Item's `connectedBy`).
6. Stamp `bankAccount.lastSyncedAt`; clear `connectionStatus` to `Connected` on success.

**Scheduled catch-up**: a daily Inngest cron iterates all active plaid `companyIntegration` rows and fires `bank-feed-sync` per Item (webhook-loss insurance + keeps dev environments fresh where webhooks can't reach). "Sync now" button fires the same event with `trigger: "manual"`.

### Webhook route — `api+/webhook.plaid.ts`

Pure verify-and-dispatch (Xero webhook precedent):

1. Verify the `Plaid-Verification` header JWT: `alg` must be ES256; fetch the public key from `/webhook_verification_key/get` by the JWT's `kid` (cache keys by `kid` in module scope); reject `iat` older than 5 minutes; compare the `request_body_sha256` claim to the SHA-256 of the **raw** body with a constant-time comparison. Any failure → 401, no processing.
2. Route by `webhook_type`/`webhook_code`:
   - `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE` → `trigger("bank-feed-sync", { companyId, itemId, trigger: "webhook" })` (company resolved by scanning `companyIntegration` metadata for the `item_id` — add a small `getCompanyByPlaidItemId(serviceRole, itemId)` helper).
   - `ITEM` / `ERROR` with `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT` → set the Item's metadata `status: "Requires Reauth"` and `connectionStatus = 'Requires Reauth'` on its mapped bank accounts.
   - `ITEM` / `USER_PERMISSION_REVOKED` → Item `status: "Error"`, accounts `connectionStatus = 'Error'` (bank account rows and history are always kept — resolved: keep-and-relink).
   - Everything else (legacy `INITIAL_UPDATE`/`HISTORICAL_UPDATE`/`DEFAULT_UPDATE`/`TRANSACTIONS_REMOVED`) → 200, ignored (sync handles state).
3. Always 200 fast; never do sync work inline.

### Re-auth (Link update mode)

- Requires-Reauth banner on the bank accounts page and Cash Position (existing Phase 1 banner slot) with a "Reconnect" button → `api+/integrations.plaid.link-token.ts` with the Item's `access_token` (update mode — no products); on Link success, no re-exchange is needed (verified: the access token is unchanged) — just reset Item + account statuses to Connected and fire a sync.

### Cash Position page (Banking landing)

Route `x+/accounting+/banking.tsx`, sidebar "Cash Position" atop the Banking group. Per active bank account:

- **Bank balance**: latest `bankAccountBalance` (badge shows source + as-of date).
- **GL balance**: sum of posted journal lines on `glAccountId` (reuses the trial-balance query path).
- **Drift decomposition** (all as of the balance date, sign convention positive = inflow):
  `residual = bankBalance − glBalance + Σ(unmatched GL lines) − Σ(unmatched/pending bank lines)`
  Displayed as: bank balance, GL balance, "explained by *n* statement lines awaiting match (Σx) and *m* outstanding GL items (Σy)", and **Residual** — green at 0, red otherwise (the misstatement signal).
- Unmatched count (links to the reconcile workspace), days since last completed reconciliation, connection badge, last synced, 30-day balance sparkline from `bankAccountBalance` (simple inline SVG — no charting dep).
- Company-total header (base-currency accounts summed; foreign-currency accounts listed separately, unconverted, in v1).

### Transfer detection

- `detectBankTransfers(client, companyId)`: pairs of **Unmatched** lines across two *different* active bank accounts with equal absolute amount, opposite signs, same currency, dates within ±3 days; excludes pairs where either line already has a pending proposal; returns proposals ranked by date proximity.
- Surfaced as banners in the reconcile workspace (both sides) and a card on Cash Position. Accept → new server fn `createBankTransferFromTransactions` (accounting.server.ts, Kysely tx): one posted `journal` (sourceType `Manual`, description "Transfer {from} → {to}") with two lines (debit receiving GL, credit sending GL, base currency — both accounts must be base-currency in v1, matching quick-create's FX restriction), plus **two match groups**, each pairing one bank line with its own journal line. Dismiss → records nothing (recomputed proposals naturally drop pairs whose lines got matched elsewhere).

### Sandbox & testing strategy

- `PLAID_ENV=sandbox` for local/dev; credentials `user_good`/`pass_good`.
- Automated tests bypass the Link UI entirely with `/sandbox/public_token/create` → exchange → prime sync (no browser needed); `/sandbox/item/reset_login` drives the re-auth path; `/sandbox/item/fire_webhook` exercises the webhook route **against a deployed environment** — local `*.dev` is unreachable from Plaid, so the local dev loop is "Sync now" + the scheduled catch-up, by design.
- Sandbox Items auto-enter `ITEM_LOGIN_REQUIRED` after 30 days — dev banners appearing after a month are expected behavior, not a bug.

### Non-goals (Phase 2)

Money movement of any kind (Plaid Auth/Transfer), investments/liabilities products, non-Plaid aggregators (Salt Edge etc.), cash-flow forecasting, converting foreign-currency balances in the Cash Position totals, and auto-accepting transfer proposals.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New tables | **None** — Phase 1 schema carries everything (`bankAccount` linkage columns, `bankTransaction.pendingExternalId`/`needsReview`, `bankAccountBalance`); possible one-row `integration` registry seed | Feed state (tokens, cursors, Item status) is integration state → `companyIntegration.metadata`, per Xero precedent |
| Multi-tenancy / RLS / service shape / forms | Inherited — no new tables, services follow `(client, ...) → {data, error}`, connect-flow routes under `api+` use the Xero permission pattern, Cash Position under `view: "accounting"` | Heuristics 1–6 satisfied by Phase 1 surfaces + Xero-precedent routes |
| Permission scoping | Connect/disconnect: `update: "settings"` (integration management, Xero precedent); sync-now / transfer-accept / re-auth: `update: "accounting"`; Cash Position: `view: "accounting"` | Connecting a bank is company-integration admin; day-to-day feed actions are accounting work |
| Token storage | Vault-backed `tokenRef` with probed AES-256-GCM env-key fallback behind one `getItemAccessToken` interface | Parent-spec decision, adapted to the fact Vault is unverified in this stack; interface makes the backend swappable |
| Cursor persistence | Buffer full loop, persist cursor only on loop completion; restart from stored cursor on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` | Verified Plaid requirement; partial-loop cursors lose data permanently |
| Sign & balance convention | Amount = −plaid.amount at ingest; credit-account balances flipped at snapshot | One inversion point per direction; everything downstream stays in Carbon's positive-=-inflow convention |
| Modified/removed on matched lines | `needsReview = true`, never mutate or delete | Phase 1 lifecycle rule; evidential integrity of matched/reconciled lines |
| Webhook handling | Verify-and-dispatch route (ES256 JWT, body hash, 5-min replay window, key cache); all work in Inngest | Xero precedent; keeps the route fast and idempotent |
| Backfill window | Connect-time choice 90/180/365/730 days, stored per Item | `days_requested` is immutable per Item (verified) — must be chosen up front |
| Priming | Immediate sync on connect | `SYNC_UPDATES_AVAILABLE` never fires before the first sync call (verified) |
| Sync concurrency | Inngest concurrency key `companyId:itemId`, limit 1 | Cursor loops must not interleave per Item |
| Job identity | `run_bank_matching` + row stamps use the Item's `connectedBy` user | Deterministic attribution without a synthetic system user |
| Transfer accept | One JE + two match groups in one Kysely tx; base-currency accounts only | Reuses Phase 1 primitives; FX transfers deferred with quick-create's restriction |
| Sparkline | Inline SVG from `bankAccountBalance` | No charting dependency for 30 points |

## Data Model Changes

None, except (verify at implementation) a seed row if the `integration` registry table is migration-seeded:

```sql
-- Only if integration rows are seeded by migration (mirror however 'xero' exists):
INSERT INTO "integration" ("id", "name", "active")
VALUES ('plaid', 'Plaid', TRUE)
ON CONFLICT ("id") DO NOTHING;
```

`companyIntegration('plaid').metadata` documented shape (JSON, not schema):

```jsonc
{
  "items": [{
    "itemId": "item-abc",
    "tokenRef": { "kind": "vault", "secretId": "..." }, // or { "kind": "aes", "ciphertext", "iv", "tag" }
    "institutionId": "ins_109508",
    "institutionName": "First Platypus Bank",
    "daysRequested": 90,
    "cursor": "AAAA...",           // null until first completed loop
    "status": "Connected",          // Connected | Requires Reauth | Error
    "connectedBy": "user_x",
    "connectedAt": "2026-07-02T..."
  }]
}
```

## API / Service Changes

- **`packages/ee/src/plaid/`**: `config.tsx`, `hooks.server.ts`, `client.ts` (SDK wrapper), `tokens.server.ts` (`storeItemAccessToken`, `getItemAccessToken`), `sync.server.ts` (the cursor-loop + apply logic, shared by job and connect-prime), `index.ts`.
- **Env** (`packages/env/src/index.ts`): `PLAID_CLIENT_ID` (public), `PLAID_SECRET` (secret), `PLAID_ENV` (default `sandbox`), `PLAID_TOKEN_ENCRYPTION_KEY` (secret; required only in AES fallback mode). `.env.example` updated.
- **Routes** (`apps/erp/app/routes/`):
  - `api+/integrations.plaid.link-token.ts` — action; `update: "settings"` for connect, or `update: "accounting"` when `itemId` present (update mode); returns `{ linkToken }`.
  - `api+/integrations.plaid.exchange.ts` — action; exchanges token, stores secret, upserts metadata item, returns the Item's accounts for the mapping step.
  - `api+/integrations.plaid.map-accounts.ts` — action; applies the account mapping (create/link/skip per Plaid account), then fires the priming sync.
  - `api+/webhook.plaid.ts` — the verify-and-dispatch webhook (public, JWT-gated).
  - `x+/accounting+/banking.tsx` — Cash Position loader (`view: "accounting"`) + actions (`intent: "sync" | "accept-transfer" | "dismiss-transfer"`).
- **Services** (`accounting.service.ts`): `getCashPosition(client, companyId)` (balances + GL sums + drift terms per account), `detectBankTransfers(client, companyId)`; (`accounting.server.ts`): `createBankTransferFromTransactions(db, args)`.
- **Jobs** (`packages/jobs/src/inngest/functions/integrations/`): `bank-feed-sync.ts` (event `carbon/bank-feed-sync`) + `bank-feed-scheduled.ts` (daily cron fan-out). Registered in `packages/lib/src/trigger.ts` / `events.ts` / the jobs index.

## UI Changes

- **Integrations page**: Plaid card (logo, description, Connected-items summary, Connect/Disconnect) — Xero card precedent.
- **Connect modal**: backfill-window select (90/180/365/730 days with "cannot be changed later" helper text) → Link (script-tag) → account-mapping step (per Plaid account: create new / link existing / skip, with currency-mismatch rows disabled) → done state showing the priming sync kicked off.
- **Bank accounts page** (Phase 1): "Connect bank" button goes live; Plaid rows show connection badge + "Sync now" + relink action when Requires Reauth; reauth banner wired to update-mode Link.
- **Cash Position** (`/x/accounting/banking`, new sidebar entry "Cash Position"): per-account rows/cards with bank balance (as-of), GL balance, drift decomposition with green/red residual, unmatched-count link into the workspace, sparkline; transfer-proposal card with Accept/Dismiss; company-total header. ERP `size="md"`, plain numbers, Lingui throughout.
- **Reconcile workspace** (Phase 1): transfer-proposal banner on lines that are one side of a detected pair.

## Acceptance Criteria

- [ ] With `PLAID_*` env unset, the Plaid card is absent and all Plaid routes 404/no-op; with sandbox env set, connect → Link (`user_good`/`pass_good`) → mapping step creates/links bank accounts with `plaidItemId`/`plaidAccountId` and fires a priming sync that lands the backfilled lines (sign inverted: a Plaid-positive debit stores negative).
- [ ] `SYNC_UPDATES_AVAILABLE` delivered to `api+/webhook.plaid.ts` with a valid ES256 JWT triggers an incremental sync; an invalid signature, wrong `alg`, body-hash mismatch, or `iat` >5 min old each return 401 and trigger nothing.
- [ ] A sync interrupted by `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` restarts from the stored cursor and applies the update exactly once (no duplicate `bankTransaction` rows — unique `(bankAccountId, externalId)` holds).
- [ ] A pending line shows status Pending and is unmatchable; when its posted version arrives with `pending_transaction_id`, the Pending row is gone and the posted row is Unmatched; a feed `removed` on a Matched line sets `needsReview` and the workspace surfaces it.
- [ ] `/sandbox/item/reset_login` flips the Item and its accounts to Requires Reauth with a banner; completing update-mode Link restores Connected without re-mapping accounts, and the same access token keeps syncing.
- [ ] Daily scheduled catch-up syncs every active Item without webhooks; "Sync now" does the same on demand; two concurrent triggers for one Item never interleave (concurrency key).
- [ ] After each sync, balances land in `bankAccountBalance` (one row per account/day) and `run_bank_matching` has run — a payment posted before the sync auto-matches its feed line with no user action.
- [ ] Cash Position shows, per account, bank balance vs GL balance with residual = bankBalance − glBalance + Σ(unmatched GL) − Σ(unmatched+pending bank lines); residual is 0 (green) on a fully explained account and red otherwise; sparkline renders 30 days of snapshots.
- [ ] Two opposite $5,000 Unmatched lines in two base-currency accounts within 3 days produce a transfer proposal; Accept books one JE and both lines flip to Matched (each in its own group); Dismiss leaves both Unmatched and the pair is not re-proposed while unchanged.
- [ ] Token storage: access tokens are never present in `companyIntegration.metadata` plaintext (only `tokenRef`); with Vault available, secrets live in `vault.secrets`; in fallback mode, ciphertext decrypts only server-side with `PLAID_TOKEN_ENCRYPTION_KEY`.
- [ ] `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/ee --filter=@carbon/jobs` and `pnpm run lint` pass.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Vault absent in self-hosted/Docker deploys → token-storage decision blocked | Med | Probe first; AES-GCM env-key fallback pre-approved behind the same interface — the probe cannot block |
| Webhook endpoint is public and attacker-reachable | Med | Full verification chain (ES256 + `kid` key fetch + body hash constant-time + 5-min replay window); route does nothing but dispatch |
| Cursor loss/corruption in metadata JSON → re-ingest storm | Low | Unique `(bankAccountId, externalId)` makes re-ingest idempotent (duplicates skipped); worst case is wasted API calls |
| Item webhook → company resolution scans metadata JSON | Low | Items per company are few; add a `metadata->items` GIN index only if it ever shows up in traces |
| Plaid production approval/pricing not in place when Phase 2 lands | Med | Resolved: account created now, approval runs in parallel; sandbox works end-to-end without approval, so build/test isn't blocked |
| Local dev can't receive webhooks → devs think feeds are broken | Low | Scheduled catch-up + "Sync now" keep dev fresh; documented in the integration card copy and the research notes |
| `modified` rewrites of Unmatched lines fight a user mid-match | Low | Updates only touch Pending/Unmatched rows; Matched+ rows go to `needsReview` |
| Balance snapshot sign errors on credit accounts | Med | One flip point at snapshot write + acceptance criterion; class-aware convention already established in Phase 1 |

## Open Questions

> ✅ All resolved 2026-07-02 — recommendations accepted verbatim by Brad ("let's go with the recommendations"). Implementation may proceed.

- [x] **Vault probe outcome & fallback approval** — the parent spec chose Supabase Vault, but `vault`/`pgsodium` appear nowhere in this stack's migrations/config. If the probe finds Vault missing in any deploy target, is the AES-256-GCM + `PLAID_TOKEN_ENCRYPTION_KEY` fallback approved as the v1 storage (same interface, swappable later)? Matters because it gates the token-storage implementation and the Xero-migration follow-up. **Answer: approved — if the probe finds Vault missing in any deploy target, ship the AES-256-GCM + `PLAID_TOKEN_ENCRYPTION_KEY` fallback behind the same `getItemAccessToken` interface.**
- [x] **Webhook URL / environment reachability** — webhooks need a public HTTPS URL per Item. Production uses the app URL; what should *deployed dev/staging* Items use, and do we accept "no webhooks locally, scheduled+manual sync only" as the permanent local-dev story? Matters for how the webhook path gets exercised before production. **Answer: accepted — local dev is scheduled + manual sync only; the webhook path is verified on the deployed dev environment via `/sandbox/item/fire_webhook`.**
- [x] **Plaid account ownership & production approval** — who owns the Plaid dashboard account, and when do we start production access approval (it gates real banks + pricing)? Matters for launch sequencing, not build. **Answer: Brad creates the Plaid dashboard account now and starts production approval in parallel; implementation proceeds entirely on sandbox.**
- [x] **Retention on revocation** — when `USER_PERMISSION_REVOKED` arrives (user cut access at the bank), keep the `bankAccount` + all transactions and allow relinking a future Item to the same account (history preserved), never auto-delete? Matters because deletion would destroy reconciliation history. **Answer: keep-and-relink, always — bank accounts and transaction history are never auto-deleted on revocation.**
- [x] **Scheduled catch-up cadence** — daily (06:00 UTC) per Item, or twice daily? Plaid bills per connected account, not per API call, so frequency is about freshness vs job noise. Matters little; setting it once avoids churn. **Answer: daily; webhooks are the real-time channel.**

## Changelog

- 2026-07-02: Created — Phase 2 of `.ai/specs/2026-07-02-bank-reconciliation.md`. Plaid mechanics verified directly against plaid.com/docs (sync cursor/mutation-restart, webhook JWT verification chain, update mode, `days_requested` immutability, sandbox endpoints) after the Phase-1 research pass's verification outage; Vault availability flagged unverified in this stack. See `.ai/research/plaid-bank-feeds.md`.
- 2026-07-02: All open questions resolved — recommendations accepted verbatim ("let's go with the recommendations"): AES-GCM fallback pre-approved pending the Vault probe; local-dev webhook story accepted; Plaid account + production approval started in parallel; keep-and-relink on revocation; daily catch-up cadence. Status → in-progress; ready for `/plan`.
