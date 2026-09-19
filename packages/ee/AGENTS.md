# @carbon/ee

Enterprise edition — integrations registry (incl. Ramp), accounting sync (Xero, QuickBooks Online, Rillet), plan gating, Slack, email, Jira, Linear, Onshape, the shared rules layer (storage + sales rules), the planning engines (MRP + finite scheduling), and SAML SSO. (Exchange rates are no longer an integration — the platform-global feed lives in @carbon/jobs `update-exchange-rates`.)

## Always

- MUST wrap provider-originated database writes in `withTriggersDisabled()` so SYNC subscriptions cannot echo them back to the provider.
- MUST link external ids through `createMappingService()` and `externalIntegrationMapping`; do not add per-entity external-id columns.
- MUST register server lifecycle hooks in `src/hooks.server.ts`; integration config files are shared with browser bundles.
- MUST use the operation-specific helpers from `@carbon/ee/ramp.server` for Ramp state. `patchRampSettings`, `patchRampOAuthCredentials`, `patchRampRefreshedTokens`, `patchRampConnection`, `patchRampWebhook`, and `patchRampCursor` own disjoint paths and delegate to the atomic `patchIntegrationState()` RPC boundary.
- MUST use `FEATURE_PLANS` for client and server plan gating. `companyHasPlan()` and `requirePlan()` intentionally allow non-Cloud editions and bypass-listed companies.
- MUST pass caller-created Supabase/Kysely clients into `runMrp()`, `runLocationSchedule()`, `runExpediteWhatIf()`, and other planning entry points.

## Ask First

- Adding a sync entity or provider — it requires an `AccountingEntityType`, provider syncer registration in `SyncFactory`, direction policy, subscriptions, and reconciler coverage.
- Adding an integration to `integrations`, changing `FEATURE_PLANS`, or changing `INTEGRATION_WHITELIST`.
- Changing Ramp state ownership or replacing `upsert_company_integration_patch`; concurrent settings, OAuth, webhook, token, and cursor writers depend on path-level composition.

## Never

- Never import `*.server` modules from integration config files; `config.tsx` is client-bundled.
- Never full-replace Ramp metadata or Vault bags. Use `src/ramp/lib/state.ts`; stale read/merge/write loses concurrent sibling updates.
- Never implement provider DELETE as a generic assumption. Entity adapters must explicitly support and verify their remote lifecycle.
- Never hand-edit generated database types.

## Validation Commands

```bash
pnpm --filter @carbon/ee test
pnpm --filter @carbon/ee typecheck
```

## Key Exports

| Subpath | Provides |
|---------|----------|
| `.` | Integration descriptors/registry, `defineIntegration`, and secret-resolution helpers |
| `./accounting` | `SyncFactory`, provider adapters, mappings, posting policy, reconciliation helpers |
| `./planning` | MRP and finite-scheduling entry points; server-only in practice because they import DB code |
| `./integrations/secrets` | `patchIntegrationState`, Vault split/persist/resolve helpers, `SECRET_KEYS` |
| `./ramp.server` | Ramp client, schemas, service operations, money/coding helpers, and key-owned state patches |
| `./ramp/hooks.server` | `rampOnInstall`, `rampOnUpdate`, `rampOnUninstall`, `rampHealthcheck` |
| `./hooks.server` | `getIntegrationServerHooks()` registry |
| `./plan`, `./plan.server` | Client/server edition and feature-plan gates |
| `./sso.server` | SAML connection, domain verification, session, and provisioning helpers |
| `./storage-rules`, `./storage-rules.server` | Storage-rule schemas and server operations |
| `./jira`, `./jira.server`, `./linear`, `./linear.server`, `./onshape`, `./paperless-parts` | Integration client/server seams |
| `./slack.server`, `./stripe-connect.server`, `./xero/hooks.server`, `./quickbooks/hooks.server`, `./rillet/hooks.server` | Integration-specific server seams |

## Key Patterns

- **Planning** (`./planning`, `src/planning/`): the two planning engines, relocated from the Supabase edge runtime to run **in-process in Node**. `runMrp(client, db, payload)` — Material Requirements Planning (formerly the `mrp` edge function; `src/planning/mrp/mrp.ts`). `runLocationSchedule` / `runExpediteWhatIf` + the window resolvers (`resolveLocationWindows` / `resolveWorkCenterWindows` / `subtractIntervals`) — finite scheduling (formerly reached via `@carbon/database/scheduling`; `src/planning/scheduling/`). Every entry point is **dependency-injected**: a `Kysely` handle (and, for MRP, a service-role Supabase client) supplied by the caller, which authenticates first. **Server-only** — pulls in `pg`/Kysely + `@logtape`, so import from route actions, `*.service.ts`, `*.server.ts`, or `@carbon/jobs` handlers, never client code. Shared edge-lib deps are reached through `@carbon/database` subpath barrels (types → `@carbon/database`, postgres → `@carbon/database/client`, `explodeBom` → `@carbon/database/mrp-engine`).
- **Accounting sync**: class-per-entity syncers in `accounting/providers/{xero,quickbooks-online,rillet}/entities/`; `SyncFactory.getSyncer()` dispatches
- **Subscriptions are code-derived**: `accounting/core/subscriptions.ts` — `REQUIRED_SYNC_SUBSCRIPTIONS` + idempotent `ensureProviderSubscriptions()` (exported from `./accounting`), converged from the install/`onUpdate` hooks and the outbound sweep — never a write-once install artifact, never a migration backfill
- **Card charges represented once**: `accounting/core/posting.ts` and every charge syncer's `shouldSync()` must agree on `isChargeBackedCardTransaction()` so a Ramp card spend pushes as either a native charge object OR a journal entry, never both
- **60s cooldown**: `SYNC_OPERATION_COOLDOWN_MS` (`accounting/core/operations.ts`) — a just-Completed ledger op absorbs `event`/`webhook` re-enqueues for 60s. Status-transition events bypass it via the non-cooldown `posting` trigger: a state change is never dropped by the cooldown
- **Truthful ledger**: a drain no-op with no remote copy closes `Skipped` via `skipOperation()` (reason in `errorMessage`), never `Completed`; `Skipped → Pending` retry is allowed
- **Rillet idempotency keys are entity-scoped**: `buildRilletIdempotencyKey({companyId, operation, localId})` — the payload is deliberately NOT hashed, so a crash-retry with a drifted payload cannot double-create the remote document
- **Tie-out remote reads**: `accounting/core/remote-journal.ts` `fetchRemoteJournalTotals()` — provider-agnostic debit-signed per-account journal totals for the reconciliation tie-out
- **Dependency sync**: transaction syncers use `ensureDependencySynced()` for JIT deps (e.g. push customer before invoice)
- **Rillet contact import**: the `actions` entry in `src/rillet/config.tsx` posts to `/api/integrations/rillet/import-contacts`, which fires `rillet-import-contacts` (`@carbon/jobs`). It is the only on-demand PULL of master data — `buildRilletSyncConfig` still forces customer/vendor `push-to-accounting`, and the job enqueues `pull-from-accounting` ledger rows by hand. `RilletCustomerSyncer`/`RilletVendorSyncer` implement `mapToLocal`/`upsertLocal` for it and extend `RilletEntitySyncer`; the pull rejections now live in `RilletPushOnlyEntitySyncer` (item + every transaction syncer). Importing exists to write the mapping row: `upsertRemote` reads `getRemoteId(localId)` first, so a Carbon sales invoice for an imported customer PUTs the original Rillet customer instead of creating a duplicate
- **Ramp state helpers**: `src/ramp/lib/service.ts` is a compatibility facade. Put connection/auth in `connection.ts`, coding masters in `chart-of-accounts.ts`/`cost-centers.ts`, parties in `suppliers.ts`, PO/bill transport in `spend.ts`, confirms in `sync-confirmation.ts`, remote webhook lifecycle in `webhooks.ts`, and metadata/Vault writes in `state.ts`; `@carbon/ee/ramp.server` remains stable
- **Integration pattern**: `defineIntegration()` → config with id, name, settings, OAuth, actions
- **SAML SSO** (`./sso.server`, `src/sso/`): `isSsoEnabled()` (`gate.ts` — Enterprise edition AND `sso` in `AUTH_PROVIDERS`) is the ONE flag; the connection lookups and admin mutations self-gate on it. `provider.server.ts` = GoTrue admin API wrappers + `getSamlSpUrls`; `connections.server.ts` = `ssoConnection` lookups (each attaches a computed `domains: string[]` of VERIFIED `ssoDomain` claims), `isSsoRequiredForEmail`, `getSsoAwareInviteLink`, upsert/requireSso/deactivate mutations, and the domain-claim flows `addSsoDomain`/`verifySsoDomain`/`removeSsoDomain`; `verification.server.ts` = the DNS TXT ownership challenge (`_carbon-challenge.<domain>` → `carbon-domain-verification=<token>`, `checkDomainVerification` with pinned public resolvers, one-shot manual verify — no polling or re-verification); `session.server.ts` = amr-based session classification (`getSsoProviderIdFromSession` for enforcement, never `getSsoProviderIdFromUser`); `provisioning.server.ts` = identity linking + invite-first migration + `deleteJitSsoUser` (full removal of a rejected throwaway JIT user — auth user AND its trigger-created `user`/`userPermission` rows, guarded on zero memberships; takes a `Kysely<KyselyDatabase>` param — callers pass their own db client) + the **pre-seed** helpers `seedSsoIdentityForUser` / `backfillSsoIdentitiesForDomain` / `removeSsoIdentitiesForDomain` (+ pure `emailDomain` / `ssoProviderColumn`). Pre-seeding is the account-linking fix under `GOTRUE_DISABLE_SIGNUP=true`: a row in `auth.identities` with `identity_data.email = lower(email)` makes GoTrue link a SAML sign-in to the existing user via its **email-column** fallback — provider-agnostic (works for any IdP: Okta/Entra/OneLogin/Ping/…, whose NameID shapes differ), keyed on the generated `email` column NOT `provider_id`. `verifySsoDomain` backfills every existing on-domain user when a domain is verified; the three account-creation flows (`apps/erp/.../users.server.ts`) seed newly-invited users; `removeSsoDomain` tears the domain's identities down. A DB guard trigger on `auth.sso_domains` (migration `…_sso-domain-guard.sql`, `ssoReservedDomain` table) blocks registering an unclaimed/reserved domain. Only verified domains ever reach GoTrue. Full architecture + the provider-agnostic linking rationale: `.claude/rules/authentication-system.md` (Enterprise SAML SSO section); design: `.ai/specs/2026-08-29-saml-sso-account-linking.md`
- **Exports**: `./accounting`, `./planning`, `./plan`, `./plan.server`, `./rules` (client-safe storage + sales rule services/UI), `./rules.server` (both evaluators), `./slack.server`, `./hooks.server`, `./sso.server`, `./jira`, `./linear`, `./rillet/hooks.server`, `./xero/hooks.server`, `./ramp.server`, `./ramp/hooks.server`, etc.

## Cross-References

- `.claude/rules/ramp-integration.md` — Ramp OAuth, state ownership, sync families, and card posting.
- `.claude/rules/accounting-sync-handlers.md` — provider sync/reconciliation architecture.
- `.claude/rules/authentication-system.md` — SAML SSO and account-linking rationale.
- `.claude/rules/billing-system.md` — plan and edition gating.
- `packages/jobs/src/inngest/functions/integrations/` — durable integration entry points.
