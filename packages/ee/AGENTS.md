# @carbon/ee

Enterprise features: integrations, accounting-provider sync, plan gates, planning engines, storage rules, notifications, and SAML SSO.

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

- `src/accounting/core/subscriptions.ts` owns `REQUIRED_SYNC_SUBSCRIPTIONS`; install/update hooks and `accounting-outbound-sweep` reconverge them.
- `src/accounting/core/posting.ts` and every charge syncer's `shouldSync()` must agree on `isChargeBackedCardTransaction()` so a card spend is represented once.
- `src/accounting/core/operations.ts` owns the durable ledger transitions and cooldown rules; a no-remote no-op closes `Skipped`, not `Completed`.
- `src/ramp/lib/service.ts` is a compatibility facade. Put connection/auth in `connection.ts`, coding masters in `chart-of-accounts.ts`/`cost-centers.ts`, parties in `suppliers.ts`, PO/bill transport in `spend.ts`, confirms in `sync-confirmation.ts`, remote webhook lifecycle in `webhooks.ts`, and metadata/Vault writes in `state.ts`; `@carbon/ee/ramp.server` remains stable.
- `src/planning/` is server-only, dependency-injected code; callers authenticate and construct clients.
- SSO uses `isSsoEnabled()` as its gate. Verified domains are pre-seeded into `auth.identities` by `seedSsoIdentityForUser()`/`backfillSsoIdentitiesForDomain()` so GoTrue links existing users while signup is disabled; enforcement classifies sessions with `getSsoProviderIdFromSession()`.

## Cross-References

- `.claude/rules/ramp-integration.md` — Ramp OAuth, state ownership, sync families, and card posting.
- `.claude/rules/accounting-sync-handlers.md` — provider sync/reconciliation architecture.
- `.claude/rules/authentication-system.md` — SAML SSO and account-linking rationale.
- `.claude/rules/billing-system.md` — plan and edition gating.
- `packages/jobs/src/inngest/functions/integrations/` — durable integration entry points.
