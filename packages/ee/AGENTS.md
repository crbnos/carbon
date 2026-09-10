# @carbon/ee

Enterprise edition — integrations registry, accounting sync (Xero, QuickBooks Online, Rillet), plan gating, Slack, email, Jira, Linear, Onshape, storage rules, the planning engines (MRP + finite scheduling), and SAML SSO. (Exchange rates are no longer an integration — the platform-global feed lives in @carbon/jobs `update-exchange-rates`.)

## Always

- **Wrap sync DB writes in `withTriggersDisabled()`** — prevents sync loops (sync writes DB → event trigger → sync again)
- **Use `FEATURE_PLANS` as the single source of truth for plan gating** — both client (`usePlanGate`) and server (`plan.server.ts`) read from it
- **All external ID linking goes through `externalIntegrationMapping` table** — use `createMappingService()`, not per-entity `externalId` columns (deprecated)
- **Gating is a no-op off Cloud** — `companyHasPlan`/`requirePlan` short-circuit true when `CarbonEdition !== Edition.Cloud` or company is bypass-listed
- **Register server hooks in `hooks.server.ts`** — integration lifecycle hooks (healthcheck, install, update, uninstall) that need server-only imports go here, not in config files. `onUpdate` fires on every settings save of an installed integration; the accounting providers use it to re-converge event subscriptions (QBO's hooks are real now — install/update converge, uninstall cleans up)

## Ask First

- Adding a new accounting entity syncer (must implement `BaseEntitySyncer`, register in `SyncFactory`)
- Adding a new integration to the `integrations` array (needs config + optional server hooks)
- Changing `FEATURE_PLANS` gates or `INTEGRATION_WHITELIST`

## Never

- Implement DELETE sync (not implemented yet — log and skip)
- Hand-edit generated DB types — read the newest migration for schema truth
- Import server-only modules from integration config files (configs are bundled for both client and server)

## Validation Commands

```bash
pnpm --filter @carbon/ee test        # vitest
pnpm --filter @carbon/ee typecheck   # tsgo --noEmit
```

## Key Patterns

- **Planning** (`./planning`, `src/planning/`): the two planning engines, relocated from the Supabase edge runtime to run **in-process in Node**. `runMrp(client, db, payload)` — Material Requirements Planning (formerly the `mrp` edge function; `src/planning/mrp/mrp.ts`). `runLocationSchedule` / `runExpediteWhatIf` + the window resolvers (`resolveLocationWindows` / `resolveWorkCenterWindows` / `subtractIntervals`) — finite scheduling (formerly reached via `@carbon/database/scheduling`; `src/planning/scheduling/`). Every entry point is **dependency-injected**: a `Kysely` handle (and, for MRP, a service-role Supabase client) supplied by the caller, which authenticates first. **Server-only** — pulls in `pg`/Kysely + `@logtape`, so import from route actions, `*.service.ts`, `*.server.ts`, or `@carbon/jobs` handlers, never client code. Shared edge-lib deps are reached through `@carbon/database` subpath barrels (types → `@carbon/database`, postgres → `@carbon/database/client`, `explodeBom` → `@carbon/database/mrp-engine`).
- **Accounting sync**: class-per-entity syncers in `accounting/providers/{xero,quickbooks-online,rillet}/entities/`; `SyncFactory.getSyncer()` dispatches
- **Subscriptions are code-derived**: `accounting/core/subscriptions.ts` — `REQUIRED_SYNC_SUBSCRIPTIONS` + idempotent `ensureProviderSubscriptions()` (exported from `./accounting`), converged from the install/`onUpdate` hooks and the outbound sweep — never a write-once install artifact, never a migration backfill
- **60s cooldown**: `SYNC_OPERATION_COOLDOWN_MS` (`accounting/core/operations.ts`) — a just-Completed ledger op absorbs `event`/`webhook` re-enqueues for 60s. Status-transition events bypass it via the non-cooldown `posting` trigger: a state change is never dropped by the cooldown
- **Truthful ledger**: a drain no-op with no remote copy closes `Skipped` via `skipOperation()` (reason in `errorMessage`), never `Completed`; `Skipped → Pending` retry is allowed
- **Rillet idempotency keys are entity-scoped**: `buildRilletIdempotencyKey({companyId, operation, localId})` — the payload is deliberately NOT hashed, so a crash-retry with a drifted payload cannot double-create the remote document
- **Tie-out remote reads**: `accounting/core/remote-journal.ts` `fetchRemoteJournalTotals()` — provider-agnostic debit-signed per-account journal totals for the reconciliation tie-out
- **Dependency sync**: transaction syncers use `ensureDependencySynced()` for JIT deps (e.g. push customer before invoice)
- **Integration pattern**: `defineIntegration()` → config with id, name, settings, OAuth, actions
- **SAML SSO** (`./sso.server`, `src/sso/`): `isSsoEnabled()` (`gate.ts` — Enterprise edition AND `sso` in `AUTH_PROVIDERS`) is the ONE flag; the connection lookups and admin mutations self-gate on it. `provider.server.ts` = GoTrue admin API wrappers + `getSamlSpUrls`; `connections.server.ts` = `ssoConnection` lookups (each attaches a computed `domains: string[]` of VERIFIED `ssoDomain` claims), `isSsoRequiredForEmail`, `getSsoAwareInviteLink`, upsert/requireSso/deactivate mutations, and the domain-claim flows `addSsoDomain`/`verifySsoDomain`/`removeSsoDomain`; `verification.server.ts` = the DNS TXT ownership challenge (`_carbon-challenge.<domain>` → `carbon-domain-verification=<token>`, `checkDomainVerification` with pinned public resolvers, one-shot manual verify — no polling or re-verification); `session.server.ts` = amr-based session classification (`getSsoProviderIdFromSession` for enforcement, never `getSsoProviderIdFromUser`); `provisioning.server.ts` = identity linking + invite-first migration + `deleteJitSsoUser` (full removal of a rejected throwaway JIT user — auth user AND its trigger-created `user`/`userPermission` rows, guarded on zero memberships; takes a `Kysely<KyselyDatabase>` param — callers pass their own db client) + the **pre-seed** helpers `seedSsoIdentityForUser` / `backfillSsoIdentitiesForDomain` / `removeSsoIdentitiesForDomain` (+ pure `emailDomain` / `ssoProviderColumn`). Pre-seeding is the account-linking fix under `GOTRUE_DISABLE_SIGNUP=true`: a row in `auth.identities` with `identity_data.email = lower(email)` makes GoTrue link a SAML sign-in to the existing user via its **email-column** fallback — provider-agnostic (works for any IdP: Okta/Entra/OneLogin/Ping/…, whose NameID shapes differ), keyed on the generated `email` column NOT `provider_id`. `verifySsoDomain` backfills every existing on-domain user when a domain is verified; the three account-creation flows (`apps/erp/.../users.server.ts`) seed newly-invited users; `removeSsoDomain` tears the domain's identities down. A DB guard trigger on `auth.sso_domains` (migration `…_sso-domain-guard.sql`, `ssoReservedDomain` table) blocks registering an unclaimed/reserved domain. Only verified domains ever reach GoTrue. Full architecture + the provider-agnostic linking rationale: `.claude/rules/authentication-system.md` (Enterprise SAML SSO section); design: `.ai/specs/2026-08-29-saml-sso-account-linking.md`
- **Exports**: `./accounting`, `./planning`, `./plan`, `./plan.server`, `./slack.server`, `./hooks.server`, `./sso.server`, `./jira`, `./linear`, `./rillet/hooks.server`, `./xero/hooks.server`, etc.

## Cross-References

- `.claude/rules/accounting-sync-handlers.md` — full sync architecture
- `.claude/rules/billing-system.md` — plan/edition gating details
- `packages/stripe/` — Stripe billing (Cloud only)
- `packages/lib/src/trigger.ts` — `trigger("sync-external-accounting", ...)` dispatch
- `packages/jobs/src/inngest/functions/integrations/` — Inngest sync entry points
