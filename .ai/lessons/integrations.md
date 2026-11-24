# Integrations lessons

Ramp, Onshape, Jira and Linear, Stripe, OAuth, webhooks, Activepieces pieces, Slack, email providers.

## A live sandbox pass finds what unit tests cannot: the wire contract

```scope
id: a-live-sandbox-pass-finds-what-unit-tests-cannot-the-wire-co
paths: ["packages/ee/src/ramp/**"]
triggers: ["toRampGlAccountPayload","buildSyncConfirmBody","successful_syncs","ensureRampConnection"]
```

**Context:** The Ramp Part C run (2026-09-10) on a fresh worktree DB against the demo sandbox, after Parts A/B were unit-tested and typecheck-clean.

**Problem:** Three things only the real API surfaced: (1) the batch account push sent a new Carbon-side `visible` flag inside the POST items → Ramp 422 "Unknown field" failed the whole chart push; (2) every sync confirm had been failing for weeks — `successful_syncs`/`failed_syncs` have `minItems: 1` (an empty `[]` is a 422) and a failed item is `{ id, error: { message } }` — and the failure was only `console.error`'d, so Ramp kept every synced transaction `SYNC_READY`; (3) `ensureRampConnection` only creates, so a fresh DB against a business that already has a Carbon connection cannot install.

**Rule:** Keep wire payloads behind pure, exported builders (`toRampGlAccountPayload`, `buildSyncConfirmBody`) with tests pinning the exact shape, never spread an internal object onto a request; put every caught provider error on the Inngest step OUTPUT (`error` / `confirmError`), not just the console — the run record is the only thing an operator can read; and when a verification note says "pushed", check the provider's own status field (`sync_status`, `synced_at`) rather than the HTTP code.

**Applies to:** every Ramp push/confirm, the accounting providers' adapters, and any integration verified only by "the request returned 2xx".

## Compare OAuth scopes the way the vendor REPORTS them, not the way you asked

```scope
id: compare-oauth-scopes-the-way-the-vendor-reports-them-not-the
paths: ["packages/jobs/src/workflows/integrations/allowlist.ts","packages/ee/src/integrations/connections.ts"]
triggers: ["missingScopes","requiredScopesFor"]
```

**Context:** The Gmail allowlist row requested `["…/auth/gmail.send", "email"]`, the spelling
the Activepieces piece uses. Google's token response came back with
`openid …/auth/gmail.send …/auth/userinfo.email` — the alias canonicalised, an unrequested
`openid` added. `missingScopes(granted, required)` reported `email` missing and the account
showed "Reconnect needed" the second it connected. Google Calendar's piece has the same alias
and was never caught only because its first connections predate scope recording.

**Rule:** Every scope in an allowlist row (and anything else that feeds `requiredScopesFor`)
is spelled exactly as the vendor echoes it in the token response — for Google the full
`https://www.googleapis.com/auth/…` URL. When a piece's own list uses an alias, override
`oauth.scope` with the canonical form (same set of permissions). `oauth.test.ts` refuses
`email` / `profile` / `openid` on any row. When a "reconnect needed" appears on a freshly
connected account, diff `metadata.scopes` against `requiredScopesFor` before anything else.

**Applies to:** `packages/jobs/src/workflows/integrations/allowlist.ts` `oauth.scope`,
`packages/ee/src/integrations/connections.ts` `missingScopes`, any future vendor whose token
response normalises scope names (Microsoft returns short names for Graph scopes too).

## Dev response caches must allow-list, never blanket-cache GETs

```scope
id: dev-response-caches-must-allow-list-never-blanket-cache-gets
paths: ["packages/ee/src/onshape/lib/client.ts"]
triggers: ["DEV_CACHEABLE_PATHS","ONSHAPE_DEV_CACHE"]
```

**Context:** Caching Onshape API GETs in Redis during development (`ONSHAPE_DEV_CACHE=1`) to protect the annual API quota.

**Problem:** Caching every GET poisoned the translation poll loop: `GET /translations/{id}` was cached while `requestState` was still `ACTIVE`, so `waitForTranslation` saw the same in-flight state forever and the export never completed. The failure looks like a hung job, not a cache bug.

**Rule:** A dev-mode response cache must be an explicit allow-list of stable content reads (`DEV_CACHEABLE_PATHS` in `packages/ee/src/onshape/lib/client.ts`). Never add a polling or status endpoint. When adding a cacheable path, ask: can two reads of this URL legitimately differ within the TTL?

**Applies to:** `packages/ee/src/onshape/lib/client.ts`, any dev-mode HTTP cache in front of a third-party API.

## One OAuth state mechanism: the cookie helper, consumed by value for a shared callback

```scope
id: one-oauth-state-mechanism-the-cookie-helper-consumed-by-valu
paths: ["apps/erp/app/routes/api+/integrations.connections.$piece.connect.ts","apps/erp/app/routes/api+/integrations.connections.callback.ts","apps/erp/app/routes/api+/integrations.$id.connect.ts"]
triggers: ["issueOAuthState","consumeOAuthStateByValue","oauth-state.server","createHmac"]
```

**Context:** The workflow pieces (Slack, Gmail, Google Calendar) signed their own OAuth state with an HMAC helper in `settings.service.ts`, beside the cookie-bound state that every other integration uses (`@carbon/auth/oauth-state.server`).

**Problem:** Two mechanisms meant two sets of binding, expiry and single-use rules to keep correct, and a review had to check both. The pieces share one callback route, so that route cannot know which integration's entry to consume before it reads the state.

**Rule:** Issue every OAuth state with `issueOAuthState`. Carry extra facts (`mode`, `name`, `connectionId`) as `OAuthStateExtras`, never in the query string. Pass the request, so the other integrations' pending entries survive the Set-Cookie. A callback that serves several integrations calls `consumeOAuthStateByValue`; it finds the entry that holds the value and takes the integration id from that entry. Do not add a second signer.

**Applies to:** `api+/integrations.connections.$piece.connect.ts`, `api+/integrations.connections.callback.ts`, `api+/integrations.$id.connect.ts`, and any new OAuth connect or callback route.

## Open an OAuth popup in the click, before you fetch its URL

```scope
id: open-an-oauth-popup-in-the-click-before-you-fetch-its-url
paths: ["packages/ee/src/oauth-popup.ts","packages/ee/src/integrations/connect.ts"]
triggers: ["beginOAuthPopup","startIntegrationConnect","window.open"]
```

**Context:** Install and Add account on a workflow piece card (`startIntegrationConnect`, `packages/ee/src/integrations/connect.ts`) fetch the consent URL from the connect route, then open it in a popup.

**Problem:** The old code awaited the fetch and then called `window.open`. The await can outlive the click's transient user activation, so Chrome blocked the popup without an error, and Install looked like it did nothing.

**Rule:** Call `beginOAuthPopup()` (`packages/ee/src/oauth-popup.ts`) synchronously in the click handler, before any await. Then fetch the URL and call `navigate(url)` on the handle. If the fetch fails, call `close()`. If the browser blocked the popup anyway, `navigate` falls back to the current window.

**Applies to:** every consent or payment flow that opens a window after a request: the piece cards, the Onshape connect, any new OAuth integration.

## Provider errors are not confirmation of the desired remote state

```scope
id: provider-errors-are-not-confirmation-of-the-desired-remote-s
paths: ["packages/ee/src/ramp/entities/*.ts"]
triggers: ["RampApiError","externalIntegrationMapping"]
```

**Context:** Carbon retracts a pushed Ramp bill after its local invoice settles, then marks the external mapping archived so the action does not repeat.

**Problem:** The archive helper swallowed every provider error—including authentication, rate-limit, server, and not-found failures—and permanently marked the mapping archived even though no response proved the bill was gone.

**Rule:** Persist completion metadata only after a successful provider response or a specifically documented idempotent response contract. Error text, status guesses, and hoped-for remote state are not confirmation; propagate unknown failures so the workflow remains retryable.

**Applies to:** Ramp bill archival and every external integration that records a local completion flag after a remote mutation.

## Financial discriminators require explicit verified allowlists

```scope
id: financial-discriminators-require-explicit-verified-allowlist
paths: ["packages/jobs/src/inngest/functions/integrations/ramp-sync-*.ts"]
triggers: ["rampBillPaymentRoute","payment_method"]
```

**Context:** Ramp payment methods, reimbursement states, and repayment funding values determine whether Carbon creates a bank settlement, skips a card-funded payment, or leaves an invoice open.

**Problem:** Unknown values fell through to financially meaningful defaults, so new or misunderstood provider enums could debit the statement bank account or mark a reimbursement paid without a verified basis.

**Rule:** Route financial side effects only from an explicit allowlist grounded in the provider contract. Unsupported, missing, or ambiguous discriminator values must fail before mapping or posting; expanding the allowlist requires contract evidence and positive routing tests.

**Applies to:** Ramp bills, reimbursements, repayments, and every integration enum that selects accounts, settlement state, or document type.

## Integration money shapes are contracts, not interchangeable numbers

```scope
id: integration-money-shapes-are-contracts-not-interchangeable-n
paths: ["packages/ee/src/ramp/**"]
triggers: ["fromMinorUnits","currency_code","entity_amount"]
```

**Context:** Ramp returns signed `{ value, currency }` and `{ amount, currency_code }` values in minor units, while its deprecated transaction `amount` fallback is a major-unit decimal. Several inbound families also still expose unverified bare-number fields.

**Problem:** One generic converter treated every number as minor units, understating a `$123.45` fallback to `$1.23`; missing values became zero, unknown currency precision became two decimals, and unresolved foreign exchange rates became one. Those defaults turned malformed or incomplete provider payloads into apparently valid financial documents.

**Rule:** Normalize each provider money field through a helper tied to its verified wire shape. Reject missing, non-finite, fractional-minor, currency-mismatched, or unverified bare-number values per item. Currency precision and exchange rates are required accounting facts; never guess them or silently post foreign currency at par.

**Applies to:** Ramp charges, transfers, cashbacks, bills, bill payments, reimbursements, repayments, and future provider payloads with multiple monetary representations.

## One-shot stores: peek for validation, take only for the write

```scope
id: one-shot-stores-peek-for-validation-take-only-for-the-write
paths: ["packages/ee/src/onshape/lib/panel-plan-store.ts"]
triggers: ["GETDEL","getdel"]
```

**Context:** The Onshape panel's plan/apply split stores a reviewed plan in Redis and consumes it with GETDEL so a double-submitted apply cannot write twice.

**Problem:** Taking the plan before validating the user's edits meant a 422 (one bad field) destroyed the review; the corrected retry hit 410 and forced a fresh Onshape read. The one-shot guarantee and the validation step were fighting over the same read.

**Rule:** For any GETDEL-style one-shot record, validate against a peek (plain GET) and take the record only immediately before the first write. A rejected request must leave the record exactly as it was.

**Applies to:** `packages/ee/src/onshape/lib/panel-plan-store.ts`, any Redis-backed one-shot token/plan/challenge consumed by a request that also validates input.

## Unbounded mapping sets require bounded status reads

```scope
id: unbounded-mapping-sets-require-bounded-status-reads
paths: ["packages/ee/src/ramp/**"]
triggers: ["chunk(","archivePurchaseOrder"]
```

**Context:** Ramp archive-on-settlement loads every unarchived external mapping, then reads the corresponding Carbon invoice statuses through PostgREST.

**Problem:** One `.in()` request could exceed both URL limits and the API's 1,000-row response cap. A settled invoice after the cap could be omitted on every sweep, while lookup and archive errors were not fully reflected in the family result.

**Rule:** Chunk unbounded identifier sets below transport and response limits, finish all prerequisite reads before remote writes, and count every failed remote mutation in the owning family result.

**Applies to:** Ramp settlement archival and any integration that joins unbounded mappings to API-backed status reads before external side effects.

## Unverified write contracts need a code-level release gate

```scope
id: unverified-write-contracts-need-a-code-level-release-gate
paths: ["packages/ee/src/ramp/entities/bill.ts"]
triggers: ["createDraftBill"]
```

**Context:** Ramp invoice export had complete-looking draft-bill and submit code, while its monetary units, coding fields, PDF shape, and returned bill identity had not been proven against the provider.

**Problem:** A customer setting could enable a financial write path whose payload contract was still explicitly speculative, allowing production data to exercise guesses.

**Rule:** Gate an unverified external write at its lowest shared entry point before any local or remote side effect. Do not expose a customer or environment bypass; enable it only in code after contract tests pin the real request and response shapes.

**Applies to:** Ramp draft-bill export and any external financial mutation implemented ahead of live contract verification.

## A Ramp custom accounting field is typed OTHER — match it by external id, never by the type enum

```scope
id: a-ramp-custom-accounting-field-is-typed-other-match-it-by-ex
paths: ["packages/ee/src/ramp/lib/coding.ts","packages/ee/src/ramp/lib/custom-single-choice-field.ts"]
triggers: ["pushCostCenters","pushChartOfAccounts","codeSelections","category_info","carbon-cost-center"]
```

**Context:** Carbon pushes cost centers to Ramp as a custom `SINGLE_CHOICE` accounting field (`POST /accounting/fields`, `id: "carbon-cost-center"`) so a card holder can tag a charge with a project. The read-back in `ramp-sync` matched a selection's `category_info.type === "COST_CENTER"` to recover the cost center.

**Problem:** The custom-field create body has no `type` property, so Ramp reports its selections as `OTHER`; `COST_CENTER` is Ramp's native enum for its own cost-center concept. The match never fired, `costCenterId` stayed null, and every project tag was silently dropped — while the GL-account leg (a native `GL_ACCOUNT` field) worked, so the sandbox verification of "a coded transaction" proved nothing about the custom field. Three more breaks hid behind it: the push sent `external_id` where Ramp wants `id` (and the string id as `field_id`, which wants the `ramp_id` UUID), `POST /field-options` is all-or-nothing and rejects existing options so every second converge threw into a swallowed `catch`, and the posting function needs a `CostCenter` `dimension` row that nothing seeds for company groups created after the `20260228024512` backfill.

**Rule:** Identify a custom Ramp field by `category_info.external_id` (the `id` Carbon created it with), and keep that constant in one pure, unit-tested module (`packages/ee/src/ramp/lib/coding.ts`). Treat every Carbon → Ramp push as a converge (list, diff by fingerprint, create/PATCH/hide) and verify the *inbound* leg of a custom field on the sandbox separately from the native GL account. A tag the customer typed must fail loudly if it cannot be kept — never post a balanced journal that lost it.

**Applies to:** `pushCostCenters` / `pushChartOfAccounts` and any future Ramp coding field (departments, locations); `codeSelections`; `post-charge`'s dimension write; and, generally, any integration where a provider echoes an ERP-created object under a different classification than the ERP's own.

## An external mapping must be committed with the Draft it makes idempotent

```scope
id: an-external-mapping-must-be-committed-with-the-draft-it-make
paths: ["packages/ee/src/ramp/**"]
triggers: ["externalIntegrationMapping","pg_advisory_xact_lock"]
```

**Context:** Ramp reimbursement sync created a supplier interaction, purchase-invoice Draft, delivery, and lines through separate Supabase requests, then wrote the external mapping last.

**Problem:** A crash before the mapping left a complete but untracked Draft, so the next provider retry could create a duplicate. A transaction alone also leaves same-key concurrent workers racing until the final unique mapping write.

**Rule:** Create the local Draft structure and its external mapping in one Kysely transaction. Serialize the tenant-scoped external key before the initial mapping read (for example with a transaction advisory lock), and provide a narrowly constrained legacy-adoption path for Drafts created by the old writer. Prove create/resume, two-connection convergence, and mid-write rollback against real Postgres.

**Applies to:** inbound provider document/payment staging and any retryable workflow whose idempotency anchor is `externalIntegrationMapping`.

## An incremental pull-sweep cursor must advance on the SAME field the query filters on

```scope
id: an-incremental-pull-sweep-cursor-must-advance-on-the-same-fi
paths: ["packages/jobs/src/inngest/functions/integrations/*-pull-sweep*.ts"]
triggers: ["pullWindowStart","CURSOR_LOOKBACK_SECONDS"]
```

**Context:** The Stripe Connect payment pull sweep (`stripe-connect-pull-sweep.ts`) queried Stripe with `invoices.list({ status: "paid", created: { gte: since } })` but advanced the cursor to `latest status_transitions.paid_at + 1`. An invoice created before the cursor but paid after it (a normal case — invoices are created, then paid later) would never be returned by a future `created`-filtered query once the cursor passed its `paid_at`, so it was permanently skipped with no error, no log, and no retry.

**Problem:** The query filters on one field (`created`) while the cursor tracks a different field (`paid_at`) that moves independently of it. Any record whose "when it changed" timestamp and "when it was created" timestamp can diverge — which is true of nearly all incremental-sync designs (a row's `updated_at` also isn't its `created_at`) — silently falls outside the next window once the cursor advances past its create time but the record itself hasn't changed since.

**Rule:** An incremental cursor MUST advance on the exact field the list query filters on, never a related-but-different timestamp. When the two are genuinely different concerns (created vs. paid, created vs. updated), either filter on the field you actually care about, or carry a trailing lookback window (`pullWindowStart` re-scans `since - CURSOR_LOOKBACK_SECONDS`) so a bounded re-scan catches what a pure cursor would miss — cheap when the record-processing step is idempotent (here, `recordStripeConnectPayment` is idempotent on the Stripe invoice id via a partial unique index, so re-scanning already-recorded invoices is a free no-op). Extract cursor arithmetic into an import-light pure module (`stripe-connect-pull-sweep-cursor.ts`) so the regression is unit-testable without booting Stripe/Inngest/DB.

**Applies to:** `packages/jobs/src/inngest/functions/integrations/*-pull-sweep.ts`, any incremental sync reading `since`/cursor state against an external API's list filter.

## Authenticate webhook challenges before acting on them

```scope
id: authenticate-webhook-challenges-before-acting-on-them
paths: ["packages/ee/src/ramp/lib/webhook.ts","apps/erp/app/routes/api+/webhook.*.ts"]
triggers: ["verifyRampWebhookSignature","createHmac","timingSafeEqual"]
```

**Context:** Ramp webhook ownership challenges can trigger a provider callback and echo a challenge value from a tenant-addressed public endpoint.

**Problem:** Challenge extraction ran before HMAC verification and accepted an unsigned query parameter, allowing unauthenticated callers to invoke the callback path and receive an echo.

**Rule:** Verify the stored secret and signature over the raw body before handling any webhook delivery, including ownership challenges. Only authenticated bytes may supply challenge data; unsigned query parameters must never alter it.

**Applies to:** Ramp webhook verification and all provider handshakes sharing an endpoint with signed event deliveries.

## Idempotent mappings do not make mutable Drafts immutable

```scope
id: idempotent-mappings-do-not-make-mutable-drafts-immutable
paths: ["packages/ee/src/ramp/**"]
triggers: ["externalIntegrationMapping"]
```

**Context:** Ramp retries find an existing external mapping before staging and posting a charge.

**Problem:** Treating every mapping as completed caused a corrected provider record to post the stale Carbon Draft left by an earlier failed attempt. The mapping proved identity, not finalization.

**Rule:** Branch retry behavior on the mapped entity's lifecycle state. Refresh a mutable Draft and its lines atomically under the same lock used for posting; only a finalized, observably Posted entity may bypass source normalization and be reconfirmed unchanged.

**Applies to:** Ramp charges, transfers, cashback, and any mapped inbound document whose provider data can change before local finalization.

## Legacy adoption must prove the entire document identity

```scope
id: legacy-adoption-must-prove-the-entire-document-identity
paths: ["packages/jobs/src/inngest/functions/integrations/ramp-sync-reimbursement*.ts"]
triggers: ["RampReimbursementDraft"]
```

**Context:** Ramp reimbursement retries may encounter an untracked purchase-invoice Draft created by the older non-transactional writer before its external mapping was saved.

**Problem:** A supplier/reference match alone could adopt a user document, a finalized invoice, an incomplete Draft, or a document already linked to another Ramp source; silently repairing it could overwrite ambiguous business data.

**Rule:** Legacy adoption is a narrow compatibility proof, not a fuzzy lookup. Require one unposted system Draft with the canonical external reference, matching dates/currency, intact supporting rows, exact financial/coding/provenance lines, and no conflicting mapping. Reject mismatches without mutation.

**Applies to:** Ramp reimbursement Draft adoption and any retry migration that links pre-idempotency records by business keys.

## Onshape individual release assets need the complete source identity

```scope
id: onshape-individual-release-assets-need-the-complete-source-i
paths: ["packages/jobs/src/inngest/functions/integrations/onshape-*.ts"]
triggers: ["partIds"]
```

**Context:** Syncing a released part from a multi-part Part Studio to an existing Carbon item.

**Problem:** Omitting `partIds` and `configuration` exports the whole studio; `getElementThumbnail` also depicts the entire element. Refreshing raw data under the same model ID leaves successful optimized artifacts in place and allows old background jobs to overwrite repaired assets.

**Rule:** Resolve one exact released document/version/element/revision and propagate its part ID and configuration. Never fall back to a version-only match or unselected Part Studio export. Render the selected model's thumbnail after optimization. Give corrected individual-part sources deterministic immutable model generations, preserving item IDs and manufacturing records; repeat repairs reuse that generation. Repair existing items with explicit per-release events, not a company-wide backfill or new CAD releases.

**Applies to:** Onshape revision sync, backfill, model export and attachment helpers in `packages/jobs/src/inngest/functions/integrations/`.

## Prerequisite lookup failures must hold outbound cursors

```scope
id: prerequisite-lookup-failures-must-hold-outbound-cursors
paths: ["packages/jobs/src/inngest/functions/integrations/ramp-sync-outbound.ts"]
triggers: ["isEmployeeParty","RampCursors"]
```

**Context:** Ramp outbound purchase-order and invoice families batch-load suppliers and supplier types before deciding whether and how to export each document.

**Problem:** Query errors were treated like empty results. The workflow could skip documents, misclassify an Employee reimbursement as a vendor bill, and still advance the family cursor beyond the unread data.

**Rule:** Distinguish an empty successful lookup from a failed lookup. If data required for eligibility or payload construction cannot be read, fail the family before remote effects and keep its cursor unchanged so the same page replays after recovery.

**Applies to:** Ramp outbound suppliers and classifications, and every cursor-based exporter with prerequisite database reads.
